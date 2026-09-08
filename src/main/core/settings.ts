/**
 * 设置持久化：userData/settings.json
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../../shared/types'
import { carouselImages, carouselTiming } from '../../shared/appearancePolicy'
import { DEFAULT_DOWNLOAD_LIMITS, downloadLimiter, validateDownloadLimits } from './downloadLimits'
import {
  DEFAULT_BACKGROUND,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_HOME_LAYOUT,
  DEFAULT_LAUNCH_THUMBNAIL,
  DEFAULT_MS_CLIENT_ID,
  normalizeThemeName
} from '../../shared/types'
import {
  assertValidResolution,
  normalizeStoredResolution,
  resolutionValidationError
} from './gameWindow'
import {
  ensureGlobalImage,
  importGlobalImage,
  removeGlobalImage
} from './appearanceAssets'

let cached: Settings | null = null

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function defaults(): Settings {
  const gameDir = path.join(app.getPath('appData'), '.kamucl')
  return {
    gameDir,
    folders: [{ path: gameDir, name: '默认文件夹', isDefault: true }],
    activeFolder: gameDir,
    javaPath: '',
    javaAuto: true,
    javaCustom: [],
    javaHidden: [],
    memoryMB: 4096,
    memoryAuto: false,
    jvmArgs: '',
    resolution: { width: 854, height: 480, mode: 'windowed', fullscreen: false },
    mirror: 'bmclapi',
    ...DEFAULT_DOWNLOAD_LIMITS,
    defaultIsolation: true,
    msClientId: DEFAULT_MS_CLIENT_ID,
    theme: 'transparent',
    custom: structuredClone(DEFAULT_CUSTOM_THEME),
    disabledFeatures: [],
    favoriteVersions: [],
    homeLayout: structuredClone(DEFAULT_HOME_LAYOUT),
    background: structuredClone(DEFAULT_BACKGROUND),
    launchThumbnail: structuredClone(DEFAULT_LAUNCH_THUMBNAIL),
    closeAfterLaunch: false
  }
}

/** 读取设置（带内存缓存），文件不存在/损坏时返回默认值 */
export function getSettings(): Settings {
  if (cached) return cached
  const def = defaults()
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')) as Partial<Settings>
    cached = {
      ...def,
      ...raw,
      resolution: { ...def.resolution, ...(raw.resolution ?? {}) },
      custom: {
        colors: { ...def.custom.colors, ...(raw.custom?.colors ?? {}) },
        layout: { ...def.custom.layout, ...(raw.custom?.layout ?? {}) }
      },
      homeLayout: {
        main: Array.isArray(raw.homeLayout?.main) ? raw.homeLayout.main : def.homeLayout.main,
        side: Array.isArray(raw.homeLayout?.side) ? raw.homeLayout.side : def.homeLayout.side
      },
      background: { ...def.background, ...(raw.background ?? {}) },
      launchThumbnail: { ...def.launchThumbnail, ...(raw.launchThumbnail ?? {}) },
      // 兼容旧配置：无 folders 时由 gameDir 迁移为唯一默认文件夹
      folders:
        Array.isArray(raw.folders) && raw.folders.length
          ? raw.folders
          : def.folders,
      activeFolder:
        raw.activeFolder ||
        raw.gameDir ||
        def.activeFolder
    }
    const c = cached
    try { validateDownloadLimits(c) } catch { Object.assign(c, DEFAULT_DOWNLOAD_LIMITS) }
    downloadLimiter.configure(c)
    c.theme = normalizeThemeName(raw.theme)
    c.background.fit = ['fill', 'fit', 'crop'].includes(c.background.fit)
      ? c.background.fit
      : 'crop'
    c.launchThumbnail.fit = ['fill', 'fit', 'crop'].includes(c.launchThumbnail.fit)
      ? c.launchThumbnail.fit
      : 'crop'
    const storedBackground = c.background.image
    const storedThumbnail = c.launchThumbnail.image
    c.background.image = ensureGlobalImage(storedBackground, 'background', true)
    c.launchThumbnail.images = carouselImages(c.launchThumbnail).map(image => ensureGlobalImage(image, 'launch-thumbnail', true)).filter(Boolean)
    c.launchThumbnail.image = c.launchThumbnail.images[0] ?? ''
    Object.assign(c.launchThumbnail, carouselTiming(c.launchThumbnail))
    if (c.background.mode === 'image' && !c.background.image) c.background.mode = 'none'
    const migratedResolution = normalizeStoredResolution(c.resolution, def.resolution)
    c.resolution = resolutionValidationError(migratedResolution)
      ? def.resolution
      : migratedResolution
    // 迁移：旧版默认 client_id（Mojang legacy 应用，不支持 device code）→ 新默认
    if (c.msClientId === '00000000402b5328') c.msClientId = def.msClientId
    // 保证 activeFolder 指向已登记文件夹；gameDir 与 activeFolder 保持一致语义
    if (!c.folders.some((f) => f.path === c.activeFolder)) {
      c.activeFolder = c.folders.find((f) => f.isDefault)?.path ?? c.folders[0].path
    }
    c.gameDir = c.activeFolder
    cached = c
    // 将旧主题 key、旧外部背景路径和损坏资源回退一次性落盘，避免每次启动重复迁移。
    if (
      c.theme !== raw.theme ||
      c.background.image !== storedBackground ||
      c.launchThumbnail.image !== storedThumbnail
    ) {
      try {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
        fs.writeFileSync(settingsFile(), JSON.stringify(c, null, 2), 'utf-8')
      } catch (error) {
        console.error('[KAMUCL] 旧外观设置迁移写入失败:', error)
      }
    }
  } catch {
    cached = def
  }
  return cached
}

/** 合并 patch 并写盘，返回合并后的完整 Settings */
export function saveSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings()
  validateDownloadLimits({ ...cur, ...patch })
  if (
    patch.background?.fit !== undefined &&
    !['fill', 'fit', 'crop'].includes(patch.background.fit)
  ) {
    throw new Error('非法的背景显示方式')
  }
  if (
    patch.launchThumbnail?.fit !== undefined &&
    !['fill', 'fit', 'crop'].includes(patch.launchThumbnail.fit)
  ) {
    throw new Error('非法的启动卡显示方式')
  }
  let nextResolution = cur.resolution
  if (patch.resolution) {
    const requested = { ...cur.resolution, ...patch.resolution }
    assertValidResolution(requested)
    nextResolution = normalizeStoredResolution(
      requested,
      cur.resolution
    )
  }
  const merged: Settings = {
    ...cur,
    ...patch,
    resolution: nextResolution,
    custom: {
      colors: { ...cur.custom.colors, ...(patch.custom?.colors ?? {}) },
      layout: { ...cur.custom.layout, ...(patch.custom?.layout ?? {}) }
    },
    homeLayout: {
      main: Array.isArray(patch.homeLayout?.main) ? patch.homeLayout.main : cur.homeLayout.main,
      side: Array.isArray(patch.homeLayout?.side) ? patch.homeLayout.side : cur.homeLayout.side
    },
    background: { ...cur.background, ...(patch.background ?? {}) },
    launchThumbnail: { ...cur.launchThumbnail, ...(patch.launchThumbnail ?? {}) }
  }
  if (patch.background?.image !== undefined) {
    merged.background.image = ensureGlobalImage(patch.background.image, 'background')
  }
  if (patch.launchThumbnail) {
    const requested = patch.launchThumbnail.images !== undefined ? patch.launchThumbnail :
      patch.launchThumbnail.image !== undefined ? { image: patch.launchThumbnail.image } : merged.launchThumbnail
    merged.launchThumbnail.images = carouselImages(requested).map(image => ensureGlobalImage(image, 'launch-thumbnail')).filter(Boolean)
    Object.assign(merged.launchThumbnail, carouselTiming(merged.launchThumbnail))
    merged.launchThumbnail.image = merged.launchThumbnail.images[0] ?? ''
  }
  // activeFolder 与 gameDir 语义一致：改其一跟随另一个
  if (patch.activeFolder && merged.folders.some((f) => f.path === patch.activeFolder)) {
    merged.gameDir = patch.activeFolder
  } else if (patch.gameDir) {
    merged.activeFolder = patch.gameDir
    if (!merged.folders.some((f) => f.path === patch.gameDir)) {
      merged.folders = [
        ...merged.folders,
        { path: patch.gameDir, name: path.basename(patch.gameDir), isDefault: false }
      ]
    }
  }
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), 'utf-8')
  } catch (error) {
    throw new Error(`设置写入失败：${error instanceof Error ? error.message : String(error)}`)
  }
  cached = merged
  if (patch.downloadThreads !== undefined || patch.downloadSpeedKBps !== undefined) downloadLimiter.configure(merged)
  if (patch.launchThumbnail) {
    const retained = new Set(carouselImages(merged.launchThumbnail))
    for (const image of carouselImages(cur.launchThumbnail)) {
      if (!retained.has(image)) removeGlobalImage(image, 'launch-thumbnail')
    }
  }
  return merged
}

/** 将旧版保存的外部图片复制到 KAMUCL 目录；原文件永不删除。 */
export async function migrateLegacyAppearanceAssets(): Promise<void> {
  const current = getSettings()
  const imported: Array<{ path: string; purpose: 'background' | 'launch-thumbnail' }> = []
  const background = { ...current.background }
  const launchThumbnail = { ...current.launchThumbnail }
  let changed = false

  if (background.image && !ensureGlobalImage(background.image, 'background')) {
    changed = true
    try {
      const image = await importGlobalImage(background.image, 'background')
      background.image = image.path
      imported.push({ path: image.path, purpose: 'background' })
    } catch {
      background.image = ''
      background.mode = 'none'
    }
  }
  const migrated: string[] = []
  for (const source of carouselImages(launchThumbnail)) {
    if (ensureGlobalImage(source, 'launch-thumbnail')) { migrated.push(source); continue }
    changed = true
    try {
      const image = await importGlobalImage(source, 'launch-thumbnail')
      migrated.push(image.path)
      imported.push({ path: image.path, purpose: 'launch-thumbnail' })
    } catch { /* omit damaged legacy image, retain other slides */ }
  }
  launchThumbnail.images = migrated
  launchThumbnail.image = migrated[0] ?? ''
  if (!changed) return

  try {
    saveSettings({ background, launchThumbnail })
  } catch (error) {
    for (const image of imported) removeGlobalImage(image.path, image.purpose)
    throw error
  }
}
