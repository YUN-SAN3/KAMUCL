/* Offline, redacted security inventory. It never executes project hooks or tests credentials. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { execFileSync, spawn } = require('node:child_process')
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const MAX_BUFFER = 128 * 1024 * 1024
const git = (root, args, input) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input, maxBuffer: MAX_BUFFER, windowsHide: true })
const fixturePath = value => /(?:^|[/:])(?:tests?|fixtures?|__tests__)(?:\/|[-.])|(?:^|[/:])[^/]*(?:-tests?\.|-proof\.)|docs\/validation-|scripts\/(?:qa-|verify-|harness-|benchmark-|resource-)/i.test(value.replaceAll('\\', '/'))
const placeholder = value => /(?:example|placeholder|fixture|synthetic|dummy|redacted|test[-_]?token|fake[-_]?|mock[-_]?|secret[-_]?one|secret[-_]?two|YOUR_|<|\$\{)/i.test(value) || /^(?:x+|a+|0+|1+|2+|3+)$/i.test(value)

/** No raw match, surrounding text, URL query or credential prefix is returned. */
function scanBytes(bytes, location, { binary = bytes.includes(0) } = {}) {
  const text = binary ? bytes.toString('latin1') : bytes.toString('utf8')
  const findings = [], keys = new Set()
  const record = (kind, match, value, classification, index = match.index) => {
    const fingerprint = sha256(Buffer.from(value)).slice(0, 16)
    const key = `${kind}:${fingerprint}:${index}`
    if (keys.has(key)) return
    keys.add(key)
    findings.push({ kind, classification, location, line: binary ? null : text.slice(0, index).split('\n').length,
      byteOffset: binary ? index : Buffer.byteLength(text.slice(0, index)), fingerprint, valueLength: value.length })
  }
  const rules = [
    ['github-token', /(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{40,255})/g],
    ['aws-access-key-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,80}\b/g],
    ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/g],
    ['stripe-secret', /\bsk_(?:live|test)_[A-Za-z0-9]{16,255}\b/g],
    ['private-key-block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]{0,16384}?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
    ['url-user-password', /https?:\/\/[^\s/@:"']{1,100}:[^\s/@"']{1,200}@[^\s/"']+/g]
  ]
  for (const [kind, pattern] of rules) for (const match of text.matchAll(pattern)) {
    const value = match[0], mocked = fixturePath(location) || placeholder(value)
    record(kind, match, value, mocked ? 'synthetic-or-fixture-needs-review' : kind === 'aws-access-key-id' ? 'public-key-id-needs-associated-secret-review' : 'potential-secret-needs-review')
  }
  for (const match of text.matchAll(/\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|app[_-]?secret|webhook[_-]?secret|password|secret[_-]?access[_-]?key)\s*["']?\s*[:=]\s*(["'])([^\r\n"']{12,256})\1/gi)) {
    const value = match[2]
    if (/^(?:Bearer\s*|https?:\/\/|[A-Za-z_$][\w.$()\[\]{} ;:+?]+)$/.test(value) && !/^[A-Za-z0-9_./+=-]{24,}$/.test(value)) continue
    const classification = fixturePath(location) || placeholder(value) ? 'synthetic-or-fixture-needs-review' : 'literal-credential-candidate-needs-review'
    record('credential-literal', match, value, classification)
  }
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g)) {
    try {
      const header = JSON.parse(Buffer.from(match[0].split('.')[0], 'base64url').toString())
      if (!header.alg && !header.typ) continue
      record('jwt-literal', match, match[0], fixturePath(location) ? 'synthetic-or-fixture-needs-review' : 'potential-secret-needs-review')
    } catch { /* Not a parseable JWT header. */ }
  }
  for (const match of text.matchAll(/(?:client[_-]?id|application[_-]?id|DEFAULT_MS_CLIENT_ID)["']?\s*[:=]\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|00000000[0-9a-f]{8})["']/gi)) {
    record('oauth-public-application-id', match, match[1], 'public-identifier-not-a-secret')
  }
  for (const match of text.matchAll(/\$2[aby]\$\d\d\$[A-Za-z0-9./]{53}/g)) {
    record('bcrypt-shaped-api-key-or-password-hash', match, match[0], 'opaque-application-key-or-password-hash-needs-context')
  }
  // Windows PE user strings are UTF-16; an ASCII-only detector would miss them.
  if (binary && bytes.subarray(0, 2).toString() === 'MZ') {
    const wide = bytes.toString('utf16le')
    const rows = scanBytes(Buffer.from(wide, 'utf8'), `${location}#utf16le`, { binary: false })
    for (const row of rows) findings.push({ ...row, line: null, byteOffset: null, representation: 'utf16le-strings' })
  }
  return findings
}

async function historyScan(root) {
  const objectRows = git(root, ['rev-list', '--objects', '--all']).trim().split('\n').filter(Boolean)
  const paths = new Map(objectRows.map(row => { const space = row.indexOf(' '); return space < 0 ? [row, null] : [row.slice(0, space), row.slice(space + 1)] }))
  const metadata = git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], objectRows.map(row => row.split(' ')[0]).join('\n') + '\n')
  const blobs = metadata.trim().split('\n').map(row => { const [oid, type, size] = row.split(' '); return { oid, type, size: Number(size), path: paths.get(oid) } }).filter(row => row.type === 'blob')
  const coverage = { commits: Number(git(root, ['rev-list', '--all', '--count']).trim()), objects: objectRows.length,
    uniqueBlobs: blobs.length, uniqueBlobBytes: blobs.reduce((n, row) => n + row.size, 0), scannedBlobs: 0, scannedBytes: 0, binaryBlobs: 0, textBlobs: 0,
    excludedBlobs: [], scope: 'All unique blobs reachable from every local Git ref; no dangling objects, reflog-only unreachable objects or un-fetched remote refs.' }
  const child = spawn('git', ['-C', root, 'cat-file', '--batch'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.end(blobs.map(row => row.oid).join('\n') + '\n')
  let pending = Buffer.alloc(0), cursor = 0, header = null, errorBytes = ''
  const findings = [], blobsWithFindings = []
  child.stderr.on('data', chunk => { errorBytes += chunk.toString() })
  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk])
    while (true) {
      if (!header) { const newline = pending.indexOf(10); if (newline < 0) break; const [oid, type, size] = pending.subarray(0, newline).toString().split(' '); header = { oid, type, size: Number(size) }; pending = pending.subarray(newline + 1) }
      if (pending.length < header.size + 1) break
      const row = blobs[cursor++]
      if (header.oid !== row.oid || header.type !== 'blob' || header.size !== row.size || pending[header.size] !== 10) throw new Error('Git batch inventory/readback differs')
      const bytes = pending.subarray(0, header.size), binary = bytes.includes(0)
      const hits = scanBytes(bytes, row.path || '(unassociated-reachable-blob)', { binary })
      coverage.scannedBlobs++; coverage.scannedBytes += bytes.length; coverage[binary ? 'binaryBlobs' : 'textBlobs']++
      if (hits.length) { blobsWithFindings.push({ oid: row.oid, representativePath: row.path, bytes: row.size, sha256: sha256(bytes), hits: hits.length }); findings.push(...hits.map(hit => ({ ...hit, gitBlob: row.oid }))) }
      pending = pending.subarray(header.size + 1); header = null
    }
  }
  const exit = await new Promise((resolve, reject) => { if (child.exitCode !== null) resolve(child.exitCode); else { child.once('exit', resolve); child.once('error', reject) } })
  if (exit !== 0 || cursor !== blobs.length || pending.length || header) throw new Error(`Git scan incomplete (${exit}; ${cursor}/${blobs.length}; stderr present ${!!errorBytes})`)
  return { coverage, blobsWithFindings, findings }
}

function currentScan(root) {
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  const authorizedNew = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(file => /^(?:src|scripts|tests|licenses|audit-reports|\.github|docs)\//.test(file))
  const generatedSelf = new Set(['audit-reports/SECURITY_SCAN_COVERAGE.json', 'audit-reports/SECURITY_REVIEW_CLASSIFICATION.json'])
  const paths = [...new Set([...tracked, ...authorizedNew])].filter(file => !generatedSelf.has(file))
  const coverage = { trackedPaths: tracked.length, additionallyIncludedOwnedNewPaths: authorizedNew.filter(file => !generatedSelf.has(file)), excludedGeneratedSelfOutputs: [...generatedSelf],
    untrackedRootFilesExcluded: git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(file => file && !authorizedNew.includes(file)),
    scannedFiles: 0, scannedBytes: 0, textFiles: 0, binaryFiles: 0, missingFiles: [], symlinkMetadataOnly: [],
    readStartUTC: new Date().toISOString(), snapshotSemantics: 'Each complete working-tree file read is individually SHA256 bound. HEAD is the baseline commit, not a claim of a globally atomic or clean working-tree snapshot.',
    dirtyTrackedAtStart: git(root, ['diff', '--name-only']).trim().split('\n').filter(Boolean) }, findings = [], inventory = []
  for (const file of paths) {
    const absolute = path.join(root, file)
    if (!fs.existsSync(absolute)) { coverage.missingFiles.push(file); continue }
    const info = fs.lstatSync(absolute)
    if (info.isSymbolicLink()) { coverage.symlinkMetadataOnly.push(file); continue }
    if (!info.isFile()) continue
    const bytes = fs.readFileSync(absolute), binary = bytes.includes(0)
    coverage.scannedFiles++; coverage.scannedBytes += bytes.length; coverage[binary ? 'binaryFiles' : 'textFiles']++
    inventory.push({ path: file, bytes: bytes.length, sha256: sha256(bytes), binary })
    findings.push(...scanBytes(bytes, file, { binary }))
  }
  coverage.readEndUTC = new Date().toISOString()
  coverage.dirtyTrackedAtEnd = git(root, ['diff', '--name-only']).trim().split('\n').filter(Boolean)
  return { coverage, inventory, findings }
}

function dependencySupplyChain(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const rows = Object.entries(lock.packages || {}).filter(([key]) => key)
  const inventory = rows.map(([location, item]) => ({ location, version: item.version || null, dev: !!item.dev, optional: !!item.optional,
    resolvedOrigin: item.resolved ? (() => { try { const u = new URL(item.resolved); return `${u.protocol}//${u.host}` } catch { return '(local-or-non-URL-source)' } })() : null,
    integrityPresent: !!item.integrity, integrityAlgorithm: item.integrity?.split('-')[0] || null, installScriptDeclared: !!item.hasInstallScript }))
  const installedScriptRows = [], absentManifests = []
  for (const [location, locked] of rows) {
    const file = path.join(root, location, 'package.json')
    if (!fs.existsSync(file)) { absentManifests.push(location); continue }
    const bytes = fs.readFileSync(file), item = JSON.parse(bytes)
    const scripts = Object.entries(item.scripts || {}).filter(([name]) => ['preinstall', 'install', 'postinstall', 'prepare'].includes(name))
    if (scripts.length) installedScriptRows.push({ location, name: item.name, lockedVersion: locked.version, installedVersion: item.version,
      manifestSHA256: sha256(bytes), scripts: scripts.map(([name, command]) => ({ name, command, networkDownloadMarker: /(?:https?:|curl|wget|download|fetch|prebuild)/i.test(command) })) })
  }
  const workflows = fs.readdirSync(path.join(root, '.github/workflows')).filter(name => /\.ya?ml$/.test(name)).map(name => {
    const file = `.github/workflows/${name}`, text = fs.readFileSync(path.join(root, file), 'utf8'), lines = text.split('\n'), uses = []
    lines.forEach((line, index) => { const match = line.match(/\buses:\s*([^\s#]+)/); if (match) { const [repo, ref] = match[1].split('@'); uses.push({ line: index + 1, repo, ref: ref || null, immutableCommit: /^[a-f0-9]{40}$/.test(ref || '') }) } })
    return { path: file, sha256: sha256(Buffer.from(text)), actions: uses, contentsReadPermission: /contents:\s*read/.test(text), contentsWritePermission: /contents:\s*write/.test(text), pullRequestTarget: /pull_request_target/.test(text) }
  })
  const gitModules = fs.existsSync(path.join(root, '.gitmodules')) ? { present: true, sha256: sha256(fs.readFileSync(path.join(root, '.gitmodules'))) } : { present: false }
  const remotes = git(root, ['remote', '-v']).trim().split('\n').filter(Boolean).map(line => {
    const fields = line.split(/\s+/), url = fields[1]
    let address
    try { const u = new URL(url); address = `${u.protocol}//${u.hostname}${u.pathname}` } catch { address = '(non-HTTPS remote; inspect locally)' }
    return { remote: fields[0], address, mode: fields[2], credentialsEmbedded: /https?:\/\/[^/]+@/.test(url) }
  })
  return { lockfileVersion: lock.lockfileVersion, lockSHA256: sha256(fs.readFileSync(path.join(root, 'package-lock.json'))), dependencyEntries: inventory.length,
    inventory, resolvedOrigins: [...new Set(inventory.map(row => row.resolvedOrigin))], missingIntegrity: inventory.filter(row => row.resolvedOrigin && !row.integrityPresent),
    declaredInstallScripts: inventory.filter(row => row.installScriptDeclared).length, installedLifecycleScripts: installedScriptRows, absentInstalledManifests: absentManifests,
    workflows, gitModules, remotes, hooksExecuted: false, installScriptsExecuted: false, credentialsUsed: false }
}

async function scanZip(file, label, { nestedAsar = false } = {}) {
  const yauzl = require('yauzl'), asar = require('asar')
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)))
  const coverage = { label, name: path.basename(file), bytes: fs.statSync(file).size, sha256: await hashFile(file), entries: 0, files: 0, decompressedBytes: 0,
    scannedBytes: 0, sourceTextAndBinaryScope: 'Every regular entry, ASCII text/bytes; PE additionally UTF-16LE strings. Nested ASAR members separately scanned. No Mach-O/PE decompilation or code execution.',
    excludedEntries: [], sensitiveStateFileNames: [], asar: [], nestedJars: [] }, findings = [], nativeMembers = [], jarFiles = []
  const ownTemp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kamucl-audit122-'))
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve)
      zip.on('entry', entry => {
        coverage.entries++
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return }
        if (/\/\.{2}(?:\/|$)|^\.{2}(?:\/|$)|^[A-Za-z]:|^\//.test(entry.fileName)) { reject(new Error('Unsafe archive member')); return }
        if (entry.uncompressedSize > 512 * 1024 * 1024) { coverage.excludedEntries.push({ path: entry.fileName, bytes: entry.uncompressedSize, reason: 'Single member exceeds documented 512MiB audit memory bound' }); zip.readEntry(); return }
        zip.openReadStream(entry, (error, stream) => {
          if (error) { reject(error); return }
          const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject)
          stream.on('end', () => {
            try {
              const bytes = Buffer.concat(chunks)
              if (bytes.length !== entry.uncompressedSize) throw new Error('Archive size differs')
              coverage.files++; coverage.decompressedBytes += bytes.length; coverage.scannedBytes += bytes.length
              if (/(?:^|\/)(?:accounts|settings|auth|credentials)\.json$|(?:^|\/)\.env$|\.(?:pfx|p12|jks|keystore)$/i.test(entry.fileName)) coverage.sensitiveStateFileNames.push(entry.fileName)
              findings.push(...scanBytes(bytes, `${label}:${entry.fileName}`))
              if (/\.(?:exe|dll|dylib|node|jar)$|(?:MacOS\/|Electron Framework$|\/MacGameWindow$)/i.test(entry.fileName)) nativeMembers.push({ path: entry.fileName, bytes: bytes.length, sha256: sha256(bytes) })
              if (nestedAsar && /(?:^|\/)app\.asar$/.test(entry.fileName)) {
                const temporary = path.join(ownTemp, 'app.asar'); fs.writeFileSync(temporary, bytes, { flag: 'wx' })
                const members = asar.listPackage(temporary), summary = { entry: entry.fileName, bytes: bytes.length, sha256: sha256(bytes), members: 0, scannedBytes: 0 }
                for (const member of members) {
                  const relative = member.replace(/^[/\\]/, '')
                  if (!relative) continue
                  const stat = asar.statFile(temporary, relative)
                  if (stat.files || stat.link) continue
                  if (stat.unpacked) { continue /* The real ASAR-unpacked entries are scanned as outer ZIP members. */ }
                  const data = asar.extractFile(temporary, relative)
                  summary.members++; summary.scannedBytes += data.length
                  findings.push(...scanBytes(data, `${label}:${entry.fileName}!${relative}`))
                }
                coverage.asar.push(summary); fs.unlinkSync(temporary)
              }
              if (nestedAsar && /\.jar$/i.test(entry.fileName)) {
                const temporary = path.join(ownTemp, `${crypto.randomUUID()}.jar`); fs.writeFileSync(temporary, bytes, { flag: 'wx' })
                jarFiles.push({ temporary, label: `${label}:${entry.fileName}`, entry: entry.fileName })
              }
              zip.readEntry()
            } catch (caught) { reject(caught) }
          })
        })
      }); zip.readEntry()
    })
    for (const jar of jarFiles) {
      const result = await scanZip(jar.temporary, jar.label)
      result.coverage.name = jar.entry
      coverage.nestedJars.push(result.coverage); findings.push(...result.findings)
    }
  } finally { zip.close(); if (!ownTemp.startsWith(path.join(require('node:os').tmpdir(), 'kamucl-audit122-'))) throw new Error('Audit temp path differs'); fs.rmSync(ownTemp, { recursive: true, force: true }) }
  return { coverage, nativeMembers, findings }
}
async function hashFile(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex') }

async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..')), flags = new Set(process.argv.slice(3)), reportDir = path.join(root, 'audit-reports')
  fs.mkdirSync(reportDir, { recursive: true })
  const current = currentScan(root), supplyChain = dependencySupplyChain(root)
  const history = flags.has('--history') ? await historyScan(root) : { coverage: { executed: false } }
  const artifacts = []
  if (flags.has('--artifacts')) for (const [file, label, nestedAsar] of [
    ['release/KAMUCL-1.1.21-source.zip', 'published-1.1.21-source', false],
    ['release/KAMUCL-1.1.21-windows-x64-unpacked.zip', 'published-1.1.21-windows-runtime', true],
    ['release/KAMUCL-1.1.21-windows-x64.zip', 'published-1.1.21-windows-portable', false],
    ['release/KAMUCL-1.1.21-mac-arm64.zip', 'published-1.1.21-mac-arm64', true]
  ]) { if (!fs.existsSync(path.join(root, file))) throw new Error(`Required artifact absent: ${file}`); artifacts.push(await scanZip(path.join(root, file), label, { nestedAsar })) }
  const snapshot = { schema: 1, version: '1.1.22', sourceHead: git(root, ['rev-parse', 'HEAD']).trim(), generatedAtUTC: new Date().toISOString(),
    tool: { implementation: 'scripts/audit-security122.cjs', sha256: sha256(fs.readFileSync(__filename)), node: process.version, git: git(root, ['--version']).trim(), regexOnly: true,
      limitations: ['No scanner proves absence of unknown/custom/encrypted secrets.', 'No account files outside repository or private player directories were accessed.', 'No credentials were submitted to any service.', 'No dynamic hook/script/credential verification or cloud scanner upload.', 'Patterns and candidate classification require human review; fixtures are not automatically exonerated.', 'Binary ASCII and PE UTF-16 strings do not decompile or decode every packed payload.'] },
    current, history, supplyChain, artifacts }
  const output = path.join(reportDir, 'SECURITY_SCAN_COVERAGE.json')
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(JSON.stringify({ output: path.relative(root, output), current: current.coverage, history: history.coverage,
    currentCandidates: current.findings.length, historyCandidates: history.findings?.length || 0,
    artifactCoverage: artifacts.map(row => row.coverage), dependencyEntries: supplyChain.dependencyEntries }))
}
module.exports = { scanBytes, historyScan, currentScan, dependencySupplyChain, scanZip, fixturePath, placeholder }
if (require.main === module) main().catch(error => { console.error(`Audit failed: ${error.message.replace(/https?:\/\/\S+/g, '[URL redacted]')}`); process.exitCode = 1 })
