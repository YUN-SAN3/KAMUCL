// Windows-side byte/archive audit bound to separate actual native Mac evidence; never pretend to mount a DMG here.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { scanZip, scanBytes } = require('./audit-security122.cjs')
const { classify } = require('./audit-windows-artifacts122.cjs')
const { validateUiProof } = require('./mac-auth122-contract.cjs')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function main() {
  const root = path.resolve(__dirname, '..'), nativeRoot = path.join(root, 'out/mac122-final-original/release'), proofRoot = path.join(nativeRoot, 'mac-auth122-proof')
  const readReceipt = relative => { const file = path.join(nativeRoot, relative), bytes = fs.readFileSync(file); return { name: relative.replaceAll('\\', '/'), sha256: hash(bytes), value: JSON.parse(bytes) } }
  const manifestReceipt = readReceipt('mac-package-arm64.json'), nativeReceipt = readReceipt('mac-auth122-proof/receipt.json'), manifest = manifestReceipt.value, native = nativeReceipt.value
  const output = path.join(root, 'out/security122-final-mac-artifacts.json'), receipt = { schemaVersion: 1, version: '1.1.22', observedAt: new Date().toISOString(), executedOn: process.platform,
    classification: 'Original final Mac ZIP complete ASAR/JAR/member byte scan on this host; raw compressed DMG scan bound separately to exact actual native mounted/decoded verification. Not a Windows DMG mount or full Mac qualification.',
    complete: false, scannerSHA256: hash(fs.readFileSync(path.join(root, 'scripts/audit-security122.cjs'))), driverSHA256: hash(fs.readFileSync(__filename)), nativeSourceCommit: manifest.commit,
    nativeReceiptBindings: [manifestReceipt, nativeReceipt].map(({ value, ...row }) => row), artifacts: [], nativeResults: null,
    limits: ['Raw DMG bytes cannot prove its compressed filesystem has no secrets; decoded content and signature come from separately SHA-bound native receipts.', 'Current Mac UI receipts use actual packaged renderer and synthetic IPC; native Keychain uses only an isolated random synthetic value, not a real Microsoft account.', 'No actual player profiles, discovered credentials or distributed application code were executed by this audit.', 'No image OCR, binary disassembly, all unknown packed formats or universal absence of secrets is asserted.'] }
  const save = () => fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n')
  try {
    assert.equal(manifest.version, '1.1.22'); assert.equal(manifest.arch, 'arm64'); assert.equal(manifest.runtimeVersion, '44.3.0'); assert.equal(manifest.minimum, '13.0.0')
    assert.equal(native.complete, true); assert.deepEqual(native.errors, []); assert.equal(native.commit, manifest.commit); assert.deepEqual(native.package, manifest)
    assert.equal(native.packages.length, 2); assert.deepEqual(native.packages.map(row => row.stage).sort(), ['dmg', 'zip'])
    for (const stage of ['zip', 'dmg']) {
      const packaged = native.packages.find(row => row.stage === stage); assert.deepEqual(packaged.identity.identity, manifest.buildIdentity)
      assert.equal(packaged.identity.identity.appAsarSHA256, manifest.appAsarSHA256); assert.equal(packaged.identity.identitySHA256, manifest.buildIdentitySHA256)
      assert.equal(packaged.identity.signature, 'strict deep verification passed'); assert.equal(packaged.identity.nativeArch, 'arm64')
      const ui = readReceipt('mac-auth122-proof/' + stage + '-ui/proof.json'); validateUiProof(ui.value, { version: '1.1.22', runtimeVersion: '44.3.0' })
      receipt.nativeReceiptBindings.push({ name: ui.name, sha256: ui.sha256 })
      assert.deepEqual(ui.value.rendererFiles.map(row => ({ path: row.file, sha256: row.sha256 })).sort((a, b) => a.path.localeCompare(b.path)), packaged.rendererFiles.map(row => ({ path: row.path, sha256: row.sha256 })))
      const smoke = readReceipt('mac-auth122-proof/' + stage + '-smoke/receipt.json'); assert.equal(smoke.value.complete, true)
      assert.equal(smoke.value.observed.platform, 'darwin'); assert.equal(smoke.value.observed.runtime, '44.3.0'); assert.equal(smoke.value.observed.sourceVersion, '1.1.22')
      assert.equal(smoke.value.observed.freshAccounts, true); assert.equal(smoke.value.observed.ownApplicationIdentity, true)
      receipt.nativeReceiptBindings.push({ name: smoke.name, sha256: smoke.sha256 })
    }
    for (const phase of ['write', 'read']) {
      const storage = readReceipt('mac-auth122-proof/safe-storage-' + phase + '.json'); assert.equal(storage.value.complete, true); assert.equal(storage.value.platform, 'darwin'); assert.equal(storage.value.arch, 'arm64'); assert.equal(storage.value.electron, '44.3.0')
      assert.equal(storage.value[phase === 'write' ? 'immediateRoundtrip' : 'restartRoundtrip'], true); receipt.nativeReceiptBindings.push({ name: storage.name, sha256: storage.sha256 })
    }
    const zipAsset = manifest.assets.find(row => row.name.endsWith('.zip')), dmgAsset = manifest.assets.find(row => row.name.endsWith('.dmg'))
    const zipFile = path.join(root, 'release', zipAsset.name), zip = await scanZip(zipFile, 'final-1.1.22-mac-arm64', { nestedAsar: true })
    assert.equal(zip.coverage.bytes, zipAsset.bytes); assert.equal(zip.coverage.sha256, zipAsset.sha256); assert.deepEqual(zip.coverage.excludedEntries, []); assert.deepEqual(zip.coverage.sensitiveStateFileNames, [])
    assert.equal(zip.coverage.asar.length, 1); assert.equal(zip.coverage.asar[0].sha256, manifest.appAsarSHA256)
    assert.equal(zip.coverage.nestedJars.length, 2); assert(zip.coverage.nestedJars.every(row => row.files > 0 && row.scannedBytes === row.decompressedBytes && row.excludedEntries.length === 0))
    const Zip = require('adm-zip'), members = new Zip(zipFile)
    for (const notice of manifest.runtimeNotices) {
      const bytes = members.readFile('KAMUCL.app/Contents/Resources/' + notice.name); assert(bytes); assert.equal(bytes.length, notice.bytes); assert.equal(hash(bytes), notice.sha256)
    }
    zip.decisions = zip.findings.map(classify); receipt.artifacts.push(zip); save()
    const raw = fs.readFileSync(path.join(root, 'release', dmgAsset.name)); assert.equal(raw.length, dmgAsset.bytes); assert.equal(hash(raw), dmgAsset.sha256)
    const dmg = { coverage: { name: dmgAsset.name, bytes: raw.length, sha256: hash(raw), scannedRawBytes: raw.length, compressedFilesystemDecodedOnThisHost: false,
      nativeFilesystemDecodeEvidence: nativeReceipt.sha256, nativeAsarSHA256: manifest.appAsarSHA256, nativeStrictSignatureAndIdentity: true }, findings: scanBytes(raw, 'final-1.1.22-mac-arm64:raw-compressed-DMG') }
    dmg.decisions = dmg.findings.map(classify); receipt.artifacts.push(dmg)
    receipt.nativeResults = { exactOriginalZIPAndDMG: true, sourceCommit: manifest.commit, minimumSystemVersion: manifest.minimum, runtimeVersion: manifest.runtimeVersion,
      signing: manifest.signing, actualAPPStartup: true, accountsCFAndFRPMatrixCountPerStage: [16, 16, 16], keychainTwoProcessSyntheticRoundtrip: true,
      originalRuntimeNotices: manifest.runtimeNotices, wholePlatformGameMicrosoftAndNotarizationPass: false }
    receipt.unknownCandidates = receipt.artifacts.flatMap(row => row.decisions).filter(row => row.status === 'pending-context-review').length
    receipt.confirmedPrivateCredentialLeakFound = false; receipt.complete = receipt.unknownCandidates === 0
    if (receipt.unknownCandidates) process.exitCode = 1
    console.log(JSON.stringify({ output: path.relative(root, output), complete: receipt.complete, unknownCandidates: receipt.unknownCandidates, artifacts: receipt.artifacts.map(row => ({ name: row.coverage.name, bytes: row.coverage.bytes, sha256: row.coverage.sha256, candidates: row.findings.length })) }))
  } finally { receipt.finishedAt = new Date().toISOString(); save() }
}
if (require.main === module) main().catch(error => { console.error('Final Mac byte audit failed: ' + error.message); process.exitCode = 1 })
