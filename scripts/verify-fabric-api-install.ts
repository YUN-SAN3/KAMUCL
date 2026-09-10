/** Live Fabric API download through the real install orchestrator, using a tiny test-only game profile.
 * node node_modules/tsx/dist/cli.mjs scripts/verify-fabric-api-install.ts [MC version]
 * No player settings, accounts, instances, or shared mods are read or changed.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { versionInstallHarness } from '../tests/helpers/version-install-harness'

async function main() {
  const mc = process.argv[2] || '26.2'
  fs.mkdirSync(path.resolve('out'), { recursive: true })
  const root = fs.mkdtempSync(path.resolve('out/fabric-api-verification-'))
  const game = path.join(root, 'test-game')
  const id = 'fabric-api-download-test'
  const runtime = await versionInstallHarness(root, async (input, init) => {
    if (String(input).includes('/profile/json')) {
      // Only skip game/runtime downloads; Fabric API metadata and JAR transport are real.
      return Response.json({ id, inheritsFrom: mc, mainClass: 'test.fixture', libraries: [] })
    }
    return fetch(input, init)
  })
  try {
    Object.assign(runtime.getSettings(), { gameDir: game, activeFolder: game, folders: [{ path: game, isDefault: true }], defaultIsolation: true, mirror: 'official' })
    const baseDir = path.join(game, '.kamucl/base', mc)
    fs.mkdirSync(baseDir, { recursive: true })
    fs.writeFileSync(path.join(baseDir, `${mc}.json`), JSON.stringify({ id: mc, libraries: [] }))
    fs.writeFileSync(path.join(baseDir, `${mc}.jar`), 'TEST FIXTURE — NOT A PLAYABLE GAME')
    const versions = await runtime.listFabricApiVersions(mc)
    assert(versions.length, `No Fabric API for Minecraft ${mc}`)
    const apiVersion = versions[0].version
    console.log(`Downloading real Fabric API ${apiVersion} for Minecraft ${mc}`)
    const installedId = await runtime.installVersion(mc, { loader: 'fabric', loaderVersion: 'fixture', fabricApi: apiVersion, instanceName: id }, e => {
      if (e.stage === 'fabric-api' || e.stage === 'done') console.log(e.text)
    })
    const target = path.join(game, 'versions', installedId, 'mods')
    const files = fs.readdirSync(target).filter(name => name.endsWith('.jar'))
    assert.equal(files.length, 1)
    assert(!fs.existsSync(path.join(game, 'mods')))
    const jar = path.join(target, files[0])
    const bytes = fs.readFileSync(jar)
    assert.equal(bytes.subarray(0, 2).toString(), 'PK')
    const result = {
      minecraft: mc, fabricApi: apiVersion, target: jar, bytes: bytes.length,
      sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      isolated: runtime.listInstalled().find(v => v.id === id)?.isolated,
      note: 'Real Fabric API metadata/JAR download with SHA1 checked by downloadFile; game/runtime use a non-playable test fixture.'
    }
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } finally { await runtime.closeHttpClient() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
