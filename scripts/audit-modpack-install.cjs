// Independent post-install audit. Metadata is fetched separately from the install
// and is never counted toward the measured installation time or used as a cache.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const Zip = require('adm-zip')
const hash = (bytes, algorithm = 'sha1') => crypto.createHash(algorithm).update(bytes).digest('hex')
async function audit(proofFile, metadataFile) {
  const proof = JSON.parse(fs.readFileSync(proofFile)), events = proof.events, game = proof.game
  const manifest = JSON.parse(new Zip(proof.pack).readAsText('manifest.json'))
  let metadata
  if (metadataFile) metadata = JSON.parse(fs.readFileSync(metadataFile))
  else {
    const response = await fetch('https://mod.mcimirror.top/curseforge/v1/mods/files', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileIds: manifest.files.map(f => f.fileID) }), signal: AbortSignal.timeout(15000) })
    assert(response.ok, 'Independent CurseForge metadata unavailable: HTTP ' + response.status)
    metadata = await response.json()
  }
  const dirs = fs.readdirSync(path.join(game, 'versions'))
  const instance = proof.instanceId || dirs.find(name => {
    const file = path.join(game, 'versions', name, name + '.json')
    return fs.existsSync(file) && JSON.parse(fs.readFileSync(file))._modpackName === manifest.name
  })
  assert(instance, 'Installed modpack instance missing')
  const directory = path.join(game, 'versions', instance), json = JSON.parse(fs.readFileSync(path.join(directory, instance + '.json')))
  const managed = JSON.parse(fs.readFileSync(path.join(directory, '.kamucl-modpack.json'))).managedFiles
  const candidates = managed.filter(rel => /^(?:mods|resourcepacks|shaderpacks|datapacks|global_packs\/(?:both|datapacks|resourcepacks|required_data|optional_data|required_resources|optional_resources)|(?:config\/)?openloader\/(?:data|resources)|config\/paxi\/(?:datapacks|resourcepacks))\/[^/]+\.(?:jar|zip)(?:\.disabled)?$/i.test(rel))
  const identities = new Map(), locations = []
  for (const rel of candidates) {
    assert(!rel.split('/').includes('..'))
    const bytes = fs.readFileSync(path.join(directory, rel))
    identities.set(bytes.length + ':' + hash(bytes), rel)
  }
  let modBytes = 0
  for (const entry of manifest.files) {
    const m = metadata.data?.find(f => f.id === entry.fileID && f.modId === entry.projectID)
    assert(m, 'File identity missing: ' + entry.fileID)
    assert(!/[/\\]/.test(m.fileName))
    const sha1 = m.hashes.find(h => h.algo === 1).value.toLowerCase()
    const installedPath = identities.get(m.fileLength + ':' + sha1)
    assert(installedPath, 'Exact manifest file missing from installed resources: ' + m.fileName)
    locations.push({ fileID: m.id, projectID: m.modId, fileName: m.fileName, installedPath, size: m.fileLength, sha1 })
    modBytes += m.fileLength
  }
  const verify = (file, expected) => {
    const bytes = fs.readFileSync(file); assert.equal(hash(bytes), expected.sha1)
    if (expected.size != null) assert.equal(bytes.length, expected.size)
    return bytes.length
  }
  const clientBytes = verify(path.join(directory, instance + '.jar'), json.downloads.client)
  verify(path.join(game, 'assets/indexes', json.assetIndex.id + '.json'), json.assetIndex)
  const objects = JSON.parse(fs.readFileSync(path.join(game, 'assets/indexes', json.assetIndex.id + '.json'))).objects
  const assets = new Map(Object.values(objects).map(o => [o.hash, o]))
  let assetBytes = 0, libraryBytes = 0, libraries = 0
  for (const [sha1, asset] of assets) assetBytes += verify(path.join(game, 'assets/objects', sha1.slice(0, 2), sha1), { sha1, size: asset.size })
  const libraryFiles = new Set()
  for (const lib of json.libraries ?? []) {
    for (const artifact of [lib.downloads?.artifact, ...Object.values(lib.downloads?.classifiers ?? {})]) {
      if (!artifact?.path || !artifact.sha1 || libraryFiles.has(artifact.path)) continue
      const file = path.join(game, 'libraries', artifact.path)
      if (!fs.existsSync(file)) continue // Other platforms' optional native libraries.
      libraryFiles.add(artifact.path); libraryBytes += verify(file, artifact); libraries++
    }
  }
  assert(fs.readFileSync(path.join(game, 'kamucl-logs/installer.log'), 'utf8').includes('[退出码 0]'))
  const start = proof.startedAt ?? events[0].at, timeline = {}
  for (const event of events) for (const lane of event.parallelStages ?? []) {
    const key = lane.id + ':' + lane.state
    timeline[key] ??= (event.at - start) / 1000
  }
  const report = { complete: true, packSHA256: hash(fs.readFileSync(proof.pack), 'sha256'), mods: manifest.files.length, modBytes,
    uniqueAssets: assets.size, assetBytes, clientBytes, verifiedLibraries: libraries, libraryBytes,
    minimumPayloadBytes: modBytes + assetBytes + clientBytes + libraryBytes, installSeconds: proof.installSeconds,
    observedPeakBytesPerSecond: Math.max(...events.map(e => e.speed ?? 0)), timeline,
    manualSupplementRequested: events.some(e => !!e.manualFiles?.files?.length), locations }
  fs.writeFileSync(proofFile.replace(/\.json$/, '-audit.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, locations: locations.length }, null, 2))
}
if (require.main === module) audit(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { audit }
