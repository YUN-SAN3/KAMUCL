/** Read-only checks against the real providers, with private launcher settings. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { versionInstallHarness } from '../tests/helpers/version-install-harness'
import type { CommunityKind } from '../src/shared/types'

async function main() {
  const root = fs.mkdtempSync(path.resolve('out/community-live-'))
  const runtime = await versionInstallHarness(root)
  const evidence: unknown[] = []
  try {
    for (const kind of ['resourcepack', 'shader', 'datapack', 'mod'] as CommunityKind[]) {
      for (const source of ['modrinth', 'curseforge'] as const) {
        const page = await runtime.communitySearchPage({ kind, source, keyword: '', mcVersion: '26.2', loader: 'fabric', offset: 0, limit: 3 })
        assert(page.total >= page.items.length)
        assert(page.items.length, `${source}/${kind}: no live results`)
        const files = await runtime.communityFiles(source, page.items[0].projectId, { kind, mcVersion: '26.2', loader: 'fabric' })
        assert(files.length, `${source}/${kind}: first result has no compatible files`)
        assert(files.every(f => f.gameVersions.includes('26.2')))
        if (kind === 'mod') assert(files.every(f => f.loaders.includes('fabric')))
        if (kind === 'datapack' && source === 'modrinth') assert(files.every(f => f.loaders.includes('datapack') && f.fileName.endsWith('.zip')))
        const item = { source, kind, total: page.total, first: page.items[0].title, compatibleFiles: files.length, file: files[0].fileName }
        evidence.push(item); console.log(JSON.stringify(item))
      }
    }
    const fresh = await runtime.communitySearchPage({ source: 'curseforge', kind: 'resourcepack', keyword: 'Fresh Animations', mcVersion: '26.2', loader: 'fabric', offset: 0, limit: 20 })
    const project = fresh.items.find(i => i.slug === 'fresh-animations')
    assert(project, 'Fresh Animations should appear as a resource pack')
    const files = await runtime.communityFiles('curseforge', project.projectId, { kind: 'resourcepack', mcVersion: '26.2', loader: 'fabric' })
    assert(files.length, 'Reported Fresh Animations case must offer compatible files')
    evidence.push({ reportedCase: project.title, files: files.map(f => f.fileName) })
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2))
    console.log('PASS live community filters: ' + root)
  } finally { await runtime.closeHttpClient() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
