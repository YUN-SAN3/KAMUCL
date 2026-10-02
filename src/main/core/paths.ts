/**
 * 目录拼接工具（多游戏文件夹体系）：
 * - versions 按「版本所属文件夹」寻址（versionFolderMap 由 listInstalled 扫描时填充，
 *   新安装版本经 registerVersionFolder 注册）
 * - libraries / assets / runtimes 共享，统一放在「默认文件夹」下
 */
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { getSettings } from './settings'
const launchFolder = new AsyncLocalStorage<{ active: string; shared: string }>()
/** Freeze an accepted launch's directory across async authentication/downloads and UI folder changes. */
export function withGameFolder<T>(folder: string, action: () => T): T {
  const shared = launchFolder.getStore()?.shared ?? getSettings().folders.find(f => f.isDefault)?.path ?? folder
  return launchFolder.run({ active: folder, shared }, action)
}

/** 当前活动游戏文件夹（新安装版本与常规寻址目标） */
export function gameDir(): string {
  return launchFolder.getStore()?.active ?? (getSettings().activeFolder || getSettings().gameDir)
}

/** 默认文件夹（libraries/assets/runtimes 的共享位置） */
export function defaultFolderPath(): string {
  if (launchFolder.getStore()) return launchFolder.getStore()!.shared
  const s = getSettings()
  return s.folders.find((f) => f.isDefault)?.path ?? gameDir()
}

/** 全部已登记的游戏文件夹路径 */
export function allFolders(): string[] {
  const s = getSettings()
  const list = s.folders.map((f) => f.path)
  return list.length ? list : [gameDir()]
}

// ---------------- 版本 → 文件夹 映射 ----------------

const versionFolderMap = new Map<string, string>()

/** 注册版本所属文件夹（安装时与 listInstalled 扫描时调用） */
export function registerVersionFolder(id: string, folder: string): void {
  versionFolderMap.set(id, folder)
}

/** 版本所属文件夹（未注册时回退为当前活动文件夹） */
export function folderOfVersion(id: string): string {
  return launchFolder.getStore()?.active ?? versionFolderMap.get(id) ?? gameDir()
}

// ---------------- versions ----------------

/** 当前活动文件夹的 versions 目录（新安装与安装器输出位置） */
export function versionsDir(): string {
  return path.join(gameDir(), 'versions')
}

/** 全部文件夹的 versions 目录（listInstalled 扫描用） */
export function allVersionsDirs(): Array<{ folder: string; dir: string }> {
  return allFolders().map((folder) => ({ folder, dir: path.join(folder, 'versions') }))
}

export function versionDir(id: string): string {
  return path.join(folderOfVersion(id), 'versions', id)
}

export function versionJsonPath(id: string): string {
  return path.join(versionDir(id), `${id}.json`)
}

export function versionJarPath(id: string): string {
  return path.join(versionDir(id), `${id}.jar`)
}

export function nativesDir(id: string): string {
  return path.join(versionDir(id), 'natives')
}

/** 安装事务标记文件路径（存在 = 安装未完成/失败） */
export function installMarkPath(id: string): string {
  return path.join(versionDir(id), '.installing')
}

// ---------------- 共享库 / 资源 / 运行时（默认文件夹下） ----------------

export function librariesDir(): string {
  return path.join(defaultFolderPath(), 'libraries')
}

/** rel 为 maven 风格的相对路径（正斜杠），Windows 下混合分隔符也可正常使用 */
export function libraryPath(rel: string): string {
  return path.join(librariesDir(), rel)
}

export function assetsDir(): string {
  return path.join(defaultFolderPath(), 'assets')
}

export function assetIndexPath(indexId: string): string {
  return path.join(assetsDir(), 'indexes', `${indexId}.json`)
}

export function assetObjectPath(hash: string): string {
  return path.join(assetsDir(), 'objects', hash.slice(0, 2), hash)
}

/** legacy 版本的虚拟资源目录（assets/virtual/legacy） */
export function virtualLegacyDir(): string {
  return path.join(assetsDir(), 'virtual', 'legacy')
}

export function runtimesDir(): string {
  return path.join(defaultFolderPath(), 'runtimes')
}

// ---------------- 依赖原版区（.kamucl/base，不进入版本列表） ----------------
// 加载器实例依赖的原版 json/jar 统一放这里（默认文件夹下共享），
// 不再在 versions/ 生成独立原版条目

/** 依赖原版目录：<默认文件夹>/.kamucl/base/<id> */
export function baseVersionDir(id: string): string {
  return path.join(defaultFolderPath(), '.kamucl', 'base', id)
}

export function baseVersionJsonPath(id: string): string {
  return path.join(baseVersionDir(id), `${id}.json`)
}

export function baseVersionJarPath(id: string): string {
  return path.join(baseVersionDir(id), `${id}.jar`)
}

/** 自定义实例图标目录：<默认文件夹>/.kamucl/icons（文件名随机，版本 json 以 file:<名> 引用） */
export function instanceIconsDir(): string {
  return path.join(defaultFolderPath(), '.kamucl', 'icons')
}
