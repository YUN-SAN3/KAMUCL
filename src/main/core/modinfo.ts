import { scanModDirectory } from './modScan'
import { resolveResourceDirectory } from './resourceDirectory'
import { folderOfVersion } from './paths'
/**
 * MOD 元数据解析：读取 jar 内 fabric.mod.json / quilt.mod.json /
 * neoforge.mods.toml / mods.toml / mcmod.info，提取名称、版本、
 * 加载器类型、MC 版本范围、前置依赖与图标。
 */
import { parseModArchive } from './modMetadata'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { LoaderName, ModCrossDuplicate, ModDuplicateGroup, ModInfo } from '../../shared/types'
import { readVersionJson } from './versions'
import { instanceDirectoryState } from './instances'

export { compareVersions as compareMcVersion, matchesVersionRange as matchMcRange } from '../../shared/modCompatibility'

export function rangeLowerBound(range: string): string {
  return /^[\[(]([^,]+),/.exec(range.trim())?.[1] ?? /^>=(.+)$/.exec(range.trim())?.[1] ?? ''
}

export function parseModFile(filePath: string): ModInfo {
  try { return parseModArchive(new AdmZip(filePath), filePath, path.basename(filePath)) }
  catch {
    return { filePath, fileName: path.basename(filePath), id: '', name: '', version: '', loader: null, mcRange: '', dependencies: [], error: '文件损坏或不是有效的 jar 文件' }
  }
}

/** 展开路径（文件/文件夹）为 .jar 文件列表；文件夹非递归只取一层 */
export function expandJarPaths(paths: string[]): { files: string[]; skipped: string[] } {
  const files: string[] = []
  const skipped: string[] = []
  for (const p of paths) {
    try {
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        const jars = fs
          .readdirSync(p)
          .filter((n) => n.toLowerCase().endsWith('.jar'))
          .map((n) => path.join(p, n))
        if (jars.length) files.push(...jars)
        else skipped.push(`${path.basename(p)}（文件夹内无 .jar）`)
      } else if (p.toLowerCase().endsWith('.jar')) {
        files.push(p)
      } else {
        skipped.push(path.basename(p))
      }
    } catch {
      skipped.push(path.basename(p))
    }
  }
  return { files, skipped }
}

// ---------------- �ظ� MOD ���� ----------------

/** �汾 mods Ŀ¼����ѭ�汾���룩 */
function modsDirOf(versionId: string): Promise<string> {
  return resolveResourceDirectory(folderOfVersion(versionId), versionId, 'mods')
}

/** MOD �汾�űȽϣ����ֶαȽϣ����Ժ�׺�� */
function compareModVersion(a: string, b: string): number {
  const norm = (s: string): number[] =>
    s
      .replace(/[+_].*$/, '')
      .split(/[.-]/)
      .map((x) => parseInt(x, 10) || 0)
  const pa = norm(a)
  const pb = norm(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** ���汾���أ�ͬ mod id ���ļ����棬���汾�����������°� */
export async function findDuplicates(versionId: string): Promise<ModDuplicateGroup[]> {
  const infos = await scanModDirectory(await modsDirOf(versionId))
  const groups = new Map<string, ModDuplicateGroup>()
  for (const info of infos) {
    if (info.error || !info.id) continue
    const key = info.id.toLowerCase()
    if (!groups.has(key)) {
      groups.set(key, { modId: info.id, name: info.name || info.id, files: [] })
    }
    groups.get(key)!.files.push({ fileName: info.fileName, version: info.version, latest: false })
  }
  const out: ModDuplicateGroup[] = []
  for (const g of groups.values()) {
    if (g.files.length < 2) continue
    g.files.sort((a, b) => compareModVersion(b.version, a.version))
    g.files.forEach((f, i) => (f.latest = i === 0))
    out.push(g)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** ��汾���أ�ͬһ mod id ͬʱ�����ڶ����ѡ�汾 */
export async function findCrossDuplicates(versionIds: string[]): Promise<ModCrossDuplicate[]> {
  const map = new Map<string, ModCrossDuplicate>()
  for (const vid of versionIds) {
    const infos = await scanModDirectory(await modsDirOf(vid))
    for (const info of infos) {
      if (info.error || !info.id) continue
      const key = info.id.toLowerCase()
      if (!map.has(key)) {
        map.set(key, { modId: info.id, name: info.name || info.id, presentIn: [] })
      }
      const g = map.get(key)!
      if (!g.presentIn.some((p) => p.versionId === vid)) {
        g.presentIn.push({ versionId: vid, fileName: info.fileName })
      }
    }
  }
  return [...map.values()]
    .filter((g) => g.presentIn.length >= 2)
    .sort((a, b) => b.presentIn.length - a.presentIn.length)
}
