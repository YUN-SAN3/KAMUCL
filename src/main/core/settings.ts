import { cleanDesign } from '../../shared/visualDesign'
import { normalizeVersionCategoryState } from '../../shared/versionCategories'
import { storedUpdateMirrorUrls, validateUpdateMirrorUrls } from '../../shared/updateMirrors'
import { defaultGameFolder, ensureDefaultGameFolder } from './defaultGameFolder'
import { assertMicrosoftIdentityPatch } from './microsoftIdentity'
/**
 * 设置持久化：userData/settings.json
 */
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SettingsCredentials, publicSettingsFields, rejectSettingsCredentialInjection } from './settingsCredentials'
import type { SettingsCredentialSnapshot } from './settingsCredentials'
import type { Settings } from '../../shared/types'
import { carouselImages, carouselSelection, carouselTiming } from '../../shared/appearancePolicy'
import { normalizeSkinPalettePreferences } from '../../shared/skinPalettePreferences'
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
let settingsReadFailed = false
const settingsCredentials = new SettingsCredentials(safeStorage)

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

/** Only this main-process getter exposes a custom service credential. */
export function getCurseforgeApiKey(): string {
  getSettings()
  return settingsCredentials.read()
}

function storedSettings(settings: Settings, credentials: SettingsCredentialSnapshot): Record<string, unknown> {
  if (credentials.legacy) throw new Error('自定义密钥尚未安全迁移，原设置文件未改动。')
  return { ...publicSettingsFields(settings as unknown as Record<string, unknown>),
    ...(credentials.ciphertext ? { secureCredentials: { curseforgeApiKey: credentials.ciphertext } } : {}) }
}

/** Exclusive sibling file + flush + replacement; cache/credentials commit only afterwards. */
function writeSettingsFile(settings: Settings, credentials: SettingsCredentialSnapshot, file = settingsFile()): void {
  const content = JSON.stringify(storedSettings(settings, credentials), null, 2)
  const temporary = file + '.tmp'
  let descriptor: number | undefined, owned = false
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    descriptor = fs.openSync(temporary, 'wx', 0o600); owned = true
    fs.writeFileSync(descriptor, content, 'utf-8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor); descriptor = undefined
    fs.renameSync(temporary, file)
  } catch { throw new Error('设置写入失败：无法安全替换文件；原设置已保留。') }
  finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor) } catch { /* preserve primary failure */ } }
    if (owned) { try { fs.unlinkSync(temporary) } catch { /* absent after successful replacement */ } }
  }
}

function defaults(): Settings {
  const gameDir = defaultGameFolder(app.getPath('appData'))
  return {
    gameDir,
    folders: [{ path: gameDir, name: '默认文件夹', isDefault: true }],
    activeFolder: gameDir,
    javaPath: '',
    javaAuto: true,
    javaCustom: [],
    javaHidden: [],
    memoryMB: 4096,
    memoryAuto: true,
    jvmArgs: '',
    resolution: { width: 854, height: 480, mode: 'windowed', fullscreen: false },
    rememberGameWindowSize: false,
    mirror: 'bmclapi',
    ...DEFAULT_DOWNLOAD_LIMITS,
    defaultIsolation: true,
    reduceMotion: false,
    uiWindowAutoFit: false,
    updateMirrorUrls: [],
    msClientId: DEFAULT_MS_CLIENT_ID,
    theme: 'transparent',
    custom: structuredClone(DEFAULT_CUSTOM_THEME),
    disabledFeatures: [],
    favoriteVersions: [],
    versionCategories: [],
    versionCategoryAssignments: {},
    homeLayout: structuredClone(DEFAULT_HOME_LAYOUT),
    background: structuredClone(DEFAULT_BACKGROUND),
    launchThumbnail: structuredClone(DEFAULT_LAUNCH_THUMBNAIL),
    skinEditorPalette: normalizeSkinPalettePreferences(undefined),
    closeAfterLaunch: false,
    configVersion: 1
  }
}

/** 配置不兼容时重置为默认（原文件先备份为 settings.backup-时间戳.json，可人工找回） */
export function resetSettingsToDefaults(): void {
  const file = settingsFile()
  const current = getSettings()
  if (settingsReadFailed) throw new Error('原设置文件无法安全读取，重置已中止，请先保留原文件并修复配置。')
  const credentials = settingsCredentials.prepare({})
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    // Backups must not duplicate a legacy plaintext service credential.
    writeSettingsFile(current, credentials, file.replace(/\.json$/, `.backup-${stamp}.json`))
  }
  const def = defaults()
  ensureDefaultGameFolder(app.getPath('appData'), def.folders)
  writeSettingsFile(def, { legacy: false })
  settingsCredentials.commit({ legacy: false })
  cached = def
}

/** 读取设置（带内存缓存），文件不存在/损坏时返回默认值 */
export function getSettings(): Settings {
  if (cached) return cached
  const def = defaults()
  try {
    const stored: unknown = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'))
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('Invalid stored settings')
    settingsCredentials.load(stored as Record<string, unknown>)
    const raw = publicSettingsFields(stored as Record<string, unknown>) as Partial<Settings>
    cached = {
      ...def,
      ...raw,
      // Existing files may contain another launcher's identity; it is never authoritative.
      msClientId: DEFAULT_MS_CLIENT_ID,
      curseforgeApiKeyConfigured: settingsCredentials.configured(),
      uiWindowAutoFit: raw.uiWindowAutoFit === true,
      updateMirrorUrls: storedUpdateMirrorUrls(raw.updateMirrorUrls),
      rememberGameWindowSize: raw.rememberGameWindowSize === true,
      ...normalizeVersionCategoryState(raw),
      visualDesign: cleanDesign(raw.visualDesign),
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
      skinEditorPalette: normalizeSkinPalettePreferences(raw.skinEditorPalette),
      // 兼容旧配置：无 folders 时由 gameDir 迁移为唯一默认文件夹
      folders:
        Array.isArray(raw.folders) && raw.folders.length
          ? raw.folders
          : raw.gameDir
            ? [{ path: raw.gameDir, name: '默认文件夹', isDefault: true }]
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
    Object.assign(c.launchThumbnail, carouselSelection(c.launchThumbnail), carouselTiming(c.launchThumbnail))
    if (c.background.mode === 'image' && !c.background.image) c.background.mode = 'none'
    const migratedResolution = normalizeStoredResolution(c.resolution, def.resolution)
    c.resolution = resolutionValidationError(migratedResolution)
      ? def.resolution
      : migratedResolution
    // 保证 activeFolder 指向已登记文件夹；gameDir 与 activeFolder 保持一致语义
    if (!c.folders.some((f) => f.path === c.activeFolder)) {
      c.activeFolder = c.folders.find((f) => f.isDefault)?.path ?? c.folders[0].path
    }
    c.gameDir = c.activeFolder
    cached = c
    // 将旧主题 key、旧外部背景路径和损坏资源回退一次性落盘，避免每次启动重复迁移。
    if (
      c.theme !== raw.theme ||
      c.msClientId !== raw.msClientId ||
      c.background.image !== storedBackground ||
      c.launchThumbnail.image !== storedThumbnail
      || Object.hasOwn(stored, 'curseforgeApiKey')
    ) {
      try {
        const credentials = settingsCredentials.prepare({})
        writeSettingsFile(c, credentials)
        settingsCredentials.commit(credentials)
      } catch {
        console.error('[KAMUCL] 设置安全迁移未完成，原文件与凭据保持不变。')
      }
    }
  } catch (error) {
    settingsReadFailed = (error as NodeJS.ErrnoException).code !== 'ENOENT'
    cached = def
  }
  try { ensureDefaultGameFolder(app.getPath('appData'), cached.folders) }
  catch (error) { console.error('[KAMUCL] 默认游戏目录创建失败:', error) }
  return cached
}

/** 合并 patch 并写盘，返回合并后的完整 Settings */
export function saveSettings(patch: Partial<Settings>): Settings {
  assertMicrosoftIdentityPatch(patch)
  rejectSettingsCredentialInjection(patch as Record<string, unknown>)
  if (Object.prototype.hasOwnProperty.call(patch, 'updateMirrorUrls')) patch = { ...patch, updateMirrorUrls: validateUpdateMirrorUrls(patch.updateMirrorUrls) }
  if (Object.prototype.hasOwnProperty.call(patch, 'rememberGameWindowSize') && typeof patch.rememberGameWindowSize !== 'boolean') throw new Error('保存游戏窗口大小必须为开启或关闭')
  if (Object.prototype.hasOwnProperty.call(patch, 'uiWindowAutoFit') && typeof patch.uiWindowAutoFit !== 'boolean') throw new Error('UI窗口自适应必须为开启或关闭')
  const cur = getSettings()
  if (settingsReadFailed) throw new Error('设置写入失败：原设置文件无法安全读取，已保留原文件。')
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
  const credentials = settingsCredentials.prepare(patch)
  const merged: Settings = {
    ...cur,
    ...publicSettingsFields(patch as unknown as Record<string, unknown>),
    msClientId: DEFAULT_MS_CLIENT_ID,
    curseforgeApiKeyConfigured: settingsCredentials.configured(credentials),
    visualDesign: cleanDesign(patch.visualDesign ?? cur.visualDesign),
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
    launchThumbnail: { ...cur.launchThumbnail, ...(patch.launchThumbnail ?? {}) },
    skinEditorPalette: normalizeSkinPalettePreferences(patch.skinEditorPalette ?? cur.skinEditorPalette)
  }
  if (patch.background?.image !== undefined) {
    merged.background.image = ensureGlobalImage(patch.background.image, 'background')
  }
  if (patch.launchThumbnail) {
    const requested = patch.launchThumbnail.images !== undefined ? patch.launchThumbnail :
      patch.launchThumbnail.image !== undefined ? { image: patch.launchThumbnail.image } : merged.launchThumbnail
    merged.launchThumbnail.images = carouselImages(requested).map(image => ensureGlobalImage(image, 'launch-thumbnail')).filter(Boolean)
    Object.assign(merged.launchThumbnail, carouselSelection(merged.launchThumbnail), carouselTiming(merged.launchThumbnail))
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
  writeSettingsFile(merged, credentials)
  settingsCredentials.commit(credentials)
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
  const remapped = new Map<string, string>()
  for (const source of carouselImages(launchThumbnail)) {
    if (ensureGlobalImage(source, 'launch-thumbnail')) { migrated.push(source); continue }
    changed = true
    try {
      const image = await importGlobalImage(source, 'launch-thumbnail')
      migrated.push(image.path)
      remapped.set(source, image.path)
      imported.push({ path: image.path, purpose: 'launch-thumbnail' })
    } catch { /* omit damaged legacy image, retain other slides */ }
  }
  launchThumbnail.images = migrated
  launchThumbnail.image = migrated[0] ?? ''
  const key = (source: string) => remapped.get(source) ?? source
  if (launchThumbnail.order) launchThumbnail.order = launchThumbnail.order.map(key)
  if (launchThumbnail.disabled) launchThumbnail.disabled = launchThumbnail.disabled.map(key)
  if (launchThumbnail.durations) launchThumbnail.durations = Object.fromEntries(Object.entries(launchThumbnail.durations).map(([source, seconds]) => [key(source), seconds]))
  if (!changed) return

  try {
    saveSettings({ background, launchThumbnail })
  } catch (error) {
    for (const image of imported) removeGlobalImage(image.path, image.purpose)
    throw error
  }
}
