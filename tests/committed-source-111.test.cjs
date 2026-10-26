const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readCommittedSource } = require('../scripts/committed-source.cjs')

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-source 中文 '))
  t.after(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert(path.basename(root).startsWith('kamucl-source 中文 '))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Source fixture']); git(['config', 'user.email', 'fixture@invalid.test']); git(['config', 'core.autocrlf', 'false'])
  fs.writeFileSync(path.join(root, '源码 §.txt'), 'first\nsecond\n')
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 10, 13, 255]))
  git(['add', '--', '.']); git(['commit', '-qm', 'Synthetic source fixture'])
  return { root, git }
}

test('source distribution reads exact Git blobs despite CRLF checkout and excludes untracked private files', t => {
  const { root, git } = repository(t)
  git(['config', 'core.autocrlf', 'true'])
  fs.unlinkSync(path.join(root, '源码 §.txt')); git(['checkout', '--', '源码 §.txt'])
  assert.equal(fs.readFileSync(path.join(root, '源码 §.txt'), 'utf8'), 'first\r\nsecond\r\n')
  fs.writeFileSync(path.join(root, 'accounts.json'), '{"private":"synthetic"}')
  const result = readCommittedSource(root)
  assert.equal(result.commit, git(['rev-parse', 'HEAD']))
  assert.deepEqual(result.files.map(f => f.path), ['binary.bin', '源码 §.txt'])
  assert.equal(result.files[1].bytes.toString(), 'first\nsecond\n')
  assert.deepEqual(result.files[0].bytes, Buffer.from([0, 10, 13, 255]))
})

test('source distribution rejects both staged and unstaged changes rather than silently shipping an older commit', t => {
  const { root, git } = repository(t)
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([1]))
  assert.throws(() => readCommittedSource(root), /Commit tracked source/)
  git(['add', '--', 'binary.bin'])
  assert.throws(() => readCommittedSource(root), /Commit tracked source/)
})

test('source distribution rejects committed symbolic link entries even without a local symlink', t => {
  const { root, git } = repository(t)
  const oid = git(['rev-parse', 'HEAD:binary.bin'])
  git(['update-index', '--add', '--cacheinfo', '120000,' + oid + ',link'])
  git(['commit', '-qm', 'Synthetic forbidden link'])
  // The checkout must be clean so the test reaches the authoritative tree mode guard.
  fs.writeFileSync(path.join(root, 'link'), Buffer.from([0, 10, 13, 255]))
  git(['update-index', '--assume-unchanged', '--', 'link'])
  assert.throws(() => readCommittedSource(root), /committed ordinary file/)
})
