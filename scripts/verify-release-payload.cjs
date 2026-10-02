// Prove lossless packaging of every runtime file, not just the application ASAR.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), Zip = require('adm-zip')
const version = require('../package.json').version
const proof = JSON.parse(fs.readFileSync(`out/release-${version}-proof.json`, 'utf8'))
const packed = path.dirname(proof.portable.results[0].cache)
const root = path.resolve('release/win-unpacked')
const zip = new Zip(`release/KAMUCL-${version}-windows-x64.zip`)
const entries = new Map(zip.getEntries().filter(e => !e.isDirectory).map(e => [e.entryName.replaceAll('\\', '/'), e]))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const files = []
function visit(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name)
    if (item.isDirectory()) visit(file)
    else {
      assert(item.isFile(), 'Unexpected link or special file')
      const relative = path.relative(root, file).replaceAll('\\', '/')
      const sha256 = hash(fs.readFileSync(file)), entry = entries.get(relative)
      // electron-builder adds its NSIS elevation helper only to the portable
      // payload, after the independent ZIP target has already been archived.
      assert(entry || relative === 'resources/elevate.exe', 'ZIP missing ' + relative)
      if (entry) assert.equal(hash(entry.getData()), sha256, 'ZIP changed ' + relative)
      assert.equal(hash(fs.readFileSync(path.join(packed, relative))), sha256, 'EXE extraction changed ' + relative)
      files.push({ path: relative, size: fs.statSync(file).size, sha256 })
    }
  }
}
visit(root)
assert.equal(files.filter(f => f.path !== 'resources/elevate.exe').length, entries.size)
// All prior runtime capabilities and license notices must still be present.
const previous = new Zip('release/final-1.0.58/KAMUCL-1.0.58-windows-x64.zip')
const before = previous.getEntries().filter(e => !e.isDirectory)
assert.deepEqual([...entries.keys()].sort(), before.map(e => e.entryName.replaceAll('\\', '/')).sort())
for (const entry of before) {
  // ASAR (version/code), exe ASAR integrity resource, compiled C# helpers may change.
  if (entry.entryName.endsWith('.exe') || entry.entryName.endsWith('.asar')) continue
  assert.equal(hash(entry.getData()), files.find(f => f.path === entry.entryName)?.sha256, 'Runtime resource changed ' + entry.entryName)
}
const report = { version, files, previousVersion: '1.0.58', complete: true }
fs.writeFileSync(`out/release-${version}-payload.json`, JSON.stringify(report, null, 2))
console.log(`Verified all ${files.length} runtime files in portable EXE and ZIP; previous codecs, visual resources and notices preserved.`)
