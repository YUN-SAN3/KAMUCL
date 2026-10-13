// Preserve the actual platform/runtime notices before signing the final APP.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const notices = [['LICENSE', 'LICENSE.electron.txt'], ['LICENSES.chromium.html', 'LICENSES.chromium.html']]
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function preserveRuntimeNotices(runtimeDirectory, resourcesDirectory) {
  fs.mkdirSync(resourcesDirectory, { recursive: true })
  return notices.map(([original, name]) => {
    const source = path.join(runtimeDirectory, original), target = path.join(resourcesDirectory, name)
    const stat = fs.lstatSync(source)
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, 'Missing original Electron notice: ' + original)
    fs.copyFileSync(source, target)
    assert.equal(digest(target), digest(source), 'Runtime notice copy changed: ' + name)
    return { name, bytes: stat.size, sha256: digest(target) }
  })
}
function verifyRuntimeNotices(resourcesDirectory, expected) {
  assert.equal(expected.length, notices.length)
  assert.deepEqual(expected.map(row => row.name).sort(), notices.map(row => row[1]).sort())
  for (const row of expected) {
    const file = path.join(resourcesDirectory, row.name), stat = fs.lstatSync(file)
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === row.bytes && stat.size > 0, 'Missing runtime notice: ' + row.name)
    assert.equal(digest(file), row.sha256, 'Packaged runtime notice changed: ' + row.name)
  }
  return true
}
module.exports = { preserveRuntimeNotices, verifyRuntimeNotices }
