// Static archive/byte audit only. Never execute the distributed EXE, DLLs or a discovered key.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { scanZip, scanBytes } = require('./audit-security122.cjs')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const sensitive = name => /(?:^|\/)(?:accounts|settings|auth|credentials)\.json$|(?:^|\/)(?:profile|userData)(?:\/|$)|(?:^|\/)\.env$|\.(?:pfx|p12|jks|keystore)$/i.test(name)
function classify(finding) {
  if (finding.classification === 'public-identifier-not-a-secret') return { ...finding, status: 'public-identifier', reason: 'Public application identifier; identity ownership and actual active request routing are separately verified.' }
  if (finding.kind === 'bcrypt-shaped-api-key-or-password-hash' && finding.fingerprint === 'f0fe1a77e3852628' && /app\.asar(?:!|$)/.test(finding.location)) return { ...finding, status: 'opaque-application-key-ownership-pending', reason: 'Same built-in application-key value in the verified application ASAR as the reviewed source/baseline bundle. No independent ownership/distribution authorization established; value not disclosed or tested.' }
  if (finding.kind === 'url-user-password' && finding.fingerprint === 'ae7c9f95165aff0b' && /(?:KAMUCL\.exe|#utf16le|Electron Framework\.framework\/.+\/Electron Framework$)/.test(finding.location)) return { ...finding, status: 'false-positive-chromium-example', reason: 'Exact reviewed Chromium embedded-credential example in the shared Electron runtime; matching original native bytes/context, not an account.' }
  if (finding.kind === 'credential-literal' && ['35cef3ee281eadc0', 'cd7a894b7eaaac6b'].includes(finding.fingerprint) && /app\.asar(?:!|$)/.test(finding.location)) return { ...finding, status: 'false-positive-ui-prose', reason: 'Exact reviewed Chinese password-input UI prose in the verified application ASAR; no actual credential. Both text and raw-container encodings are identified.' }
  return { ...finding, status: 'pending-context-review', reason: 'New value/context must be independently inspected; not automatically cleared by a test/fixture path.' }
}
async function zipFileHashes(file) {
  const yauzl = require('yauzl'), zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)))
  const rows = []
  try { await new Promise((resolve, reject) => {
    zip.on('error', reject); zip.on('end', resolve)
    zip.on('entry', entry => {
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { reject(error); return }; const digest = crypto.createHash('sha256'); let bytes = 0
        stream.on('data', chunk => { digest.update(chunk); bytes += chunk.length }); stream.on('error', reject)
        stream.on('end', () => { try { assert.equal(bytes, entry.uncompressedSize); rows.push({ path: entry.fileName, bytes, sha256: digest.digest('hex') }); zip.readEntry() } catch (caught) { reject(caught) } })
      })
    }); zip.readEntry()
  }) } finally { zip.close() }
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}
function archiveMembers(listing) {
  const marker = listing.indexOf('----------'); assert(marker >= 0, 'Archive member inventory separator missing')
  return listing.slice(marker + 10).trim().split(/\r?\n\s*\r?\n/).map(block => {
    const values = Object.fromEntries(block.split(/\r?\n/).map(line => { const index = line.indexOf(' = '); return index < 0 ? null : [line.slice(0, index), line.slice(index + 3)] }).filter(Boolean))
    const name = String(values.Path || '').replaceAll('\\', '/')
    assert(name && !path.isAbsolute(name) && !/^[A-Za-z]:|^\//.test(name) && !name.split('/').some(part => part === '..' || part === '.'), 'Unsafe native payload member')
    assert(!/^.*[Ll].*$/.test(values.Attributes || ''), 'Native payload symlink is unsupported')
    return { path: name, directory: /D/.test(values.Attributes || ''), bytes: Number(values.Size) }
  })
}
async function main() {
  const root = path.resolve(__dirname, '..'), exe = path.join(root, 'release/KAMUCL-1.1.22.exe'), seven = 'C:/Program Files/7-Zip/7z.exe'
  const originalReceiptFile = path.join(root, 'out/compliance122-final-windows-package.json'), originalBytes = fs.readFileSync(originalReceiptFile), original = JSON.parse(originalBytes)
  const output = path.join(root, 'out/security122-final-windows-artifacts.json'), privateRoot = fs.mkdtempSync(path.join(root, 'out/security122-static-extract-'))
  const receipt = { schemaVersion: 1, version: '1.1.22', classification: 'Static complete final Windows archive/byte security inspection; no application, native component or credential execution',
    observedAt: new Date().toISOString(), sourceHeadObserved: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim(),
    scannerSHA256: hash(fs.readFileSync(path.join(root, 'scripts/audit-security122.cjs'))), driverSHA256: hash(fs.readFileSync(__filename)), originalComplianceReceiptSHA256: hash(originalBytes), complete: false, artifacts: [],
    limits: ['Regex/byte scanning cannot prove absence of unknown secrets, encrypted payloads or credentials hidden as image pixels.', 'Runtime source archives inside license materials are hashed and byte-scanned, not recursively decoded by this task. Actual ASAR and every packaged JAR are explicitly decoded.', 'No real player files or private profiles outside actual release artifacts were accessed.', 'No discovered credential was submitted to any service.'] }
  const save = () => fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n')
  try {
    assert.equal(hash(fs.readFileSync(seven)), original.tools.sevenZipFileSHA256); const exeBytes = fs.readFileSync(exe)
    assert.equal(exeBytes.length, original.actualEXE.bytes); assert.equal(hash(exeBytes), original.actualEXE.sha256)
    const read = args => execFileSync(seven, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
    const listing = read(['l', '-slt', exe]); assert(listing.includes('Type = Nsis'))
    const exeResult = { coverage: { name: path.basename(exe), bytes: exeBytes.length, sha256: hash(exeBytes), scannedRawBytes: exeBytes.length, staticNSISExtraction: true, plugins: [], payload: null }, findings: scanBytes(exeBytes, 'final-1.1.22-exe:raw-NSIS') }
    for (const plugin of original.actualEXE.plugins) {
      const bytes = execFileSync(seven, ['e', '-so', exe, '$PLUGINSDIR\\' + plugin.file], { encoding: null, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
      assert.equal(bytes.length, plugin.bytes); assert.equal(hash(bytes), plugin.sha256); exeResult.coverage.plugins.push(plugin)
      exeResult.findings.push(...scanBytes(bytes, 'final-1.1.22-exe:NSIS-plugin/' + plugin.file))
    }
    const payload = path.join(privateRoot, 'actual-payload.7z'), fd = fs.openSync(payload, 'wx')
    try { execFileSync(seven, ['e', '-so', exe, '$PLUGINSDIR\\app-64.7z'], { stdio: ['ignore', fd, 'pipe'], windowsHide: true }); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    assert.equal(fs.statSync(payload).size, original.actualEXE.payloadBytes)
    const members = archiveMembers(read(['l', '-slt', payload])), names = members.map(row => row.path); assert.equal(new Set(names).size, names.length, 'Duplicate native payload member')
    const directory = path.join(privateRoot, 'payload'); fs.mkdirSync(directory)
    read(['x', '-y', payload, '-o' + directory])
    const files = [], payloadNames = []
    const walk = current => {
      for (const row of fs.readdirSync(current, { withFileTypes: true })) {
        const file = path.join(current, row.name); assert(!row.isSymbolicLink(), 'Actual native payload has a symbolic link')
        if (row.isDirectory()) walk(file)
        else { assert(row.isFile()); const name = path.relative(directory, file).replaceAll('\\', '/'), bytes = fs.readFileSync(file); assert(bytes.length <= 512 * 1024 * 1024, 'Required native payload file exceeds documented scanner bound')
          files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) }); if (sensitive(name)) payloadNames.push(name)
          exeResult.findings.push(...scanBytes(bytes, 'final-1.1.22-exe:decoded-payload/' + name))
        }
      }
    }; walk(directory); files.sort((a, b) => a.path.localeCompare(b.path))
    assert.deepEqual(files.map(row => [row.path, row.bytes]).sort(), members.filter(row => !row.directory).map(row => [row.path, row.bytes]).sort(), 'Static extraction is incomplete')
    const asarPath = 'resources/app.asar', actualASAR = files.find(row => row.path === asarPath); assert(actualASAR)
    assert.equal(actualASAR.sha256, original.actualEXE.actualASAR.sha256)
    exeResult.coverage.payload = { bytes: fs.statSync(payload).size, sha256: hash(fs.readFileSync(payload)), files, decompressedBytes: files.reduce((sum, row) => sum + row.bytes, 0), sensitiveStateFileNames: payloadNames }
    receipt.artifacts.push(exeResult); save()
    for (const [name, label] of [['KAMUCL-1.1.22-windows-x64.zip', 'final-1.1.22-windows-portable'], ['KAMUCL-1.1.22-windows-x64-unpacked.zip', 'final-1.1.22-windows-runtime']]) {
      const result = await scanZip(path.join(root, 'release', name), label, { nestedAsar: true }); assert.deepEqual(result.coverage.excludedEntries, []); assert.deepEqual(result.coverage.sensitiveStateFileNames, [])
      receipt.artifacts.push(result); save()
    }
    const compact = receipt.artifacts[1], runtime = receipt.artifacts[2]
    assert.equal(compact.coverage.sha256, original.compactZIP.sha256); assert.equal(runtime.coverage.sha256, original.unpackedZIP.sha256)
    const zipRows = await zipFileHashes(path.join(root, 'release/KAMUCL-1.1.22-windows-x64-unpacked.zip'))
    assert.deepEqual(files, zipRows, 'Every static EXE payload file must byte-match its unpacked ZIP counterpart')
    assert.equal(runtime.coverage.asar.length, 1); assert.equal(runtime.coverage.asar[0].sha256, actualASAR.sha256)
    assert.equal(runtime.coverage.nestedJars.length, 2, 'Both production JARs must be decoded')
    assert(runtime.coverage.nestedJars.every(row => row.files > 0 && row.scannedBytes === row.decompressedBytes && row.excludedEntries.length === 0))
    assert.deepEqual(payloadNames, []); receipt.everyEXEPayloadFileMatchesUnpackedZIP = true
    receipt.exeDecodedASARAndJARCoverageBoundToRuntimeZIP = true
    for (const artifact of receipt.artifacts) artifact.decisions = artifact.findings.map(classify)
    const unknown = receipt.artifacts.flatMap(row => row.decisions).filter(row => row.status === 'pending-context-review')
    receipt.unknownCandidates = unknown.length; receipt.confirmedPrivateCredentialLeakFound = false; receipt.complete = unknown.length === 0
    if (unknown.length) process.exitCode = 1
    console.log(JSON.stringify({ output: path.relative(root, output), complete: receipt.complete, unknownCandidates: unknown.length, artifacts: receipt.artifacts.map(row => ({ name: row.coverage.name, bytes: row.coverage.bytes, sha256: row.coverage.sha256, candidates: row.findings.length })) }))
  } finally {
    const canonical = fs.realpathSync(privateRoot); assert(canonical.startsWith(fs.realpathSync(path.join(root, 'out')) + path.sep + 'security122-static-extract-')); fs.rmSync(canonical, { recursive: true, force: true })
    receipt.finishedAt = new Date().toISOString(); save()
  }
}
module.exports = { classify, archiveMembers }
if (require.main === module) main().catch(error => { console.error('Final Windows security audit failed: ' + error.message); process.exitCode = 1 })
