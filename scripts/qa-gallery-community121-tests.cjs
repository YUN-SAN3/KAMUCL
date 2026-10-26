const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { assertQueueProof } = require('./qa-gallery-community121.cjs')

const proof = () => ({
  classification: 'Real packaged renderer/queue with controlled IPC plan and commit, isolated JAR bytes and disk; no public service or original installer qualification',
  cancelledPreview: { committed: false, discarded: true }, backgroundNavigation: true, dependencyBlocksCommit: true, failedCommitLeavesFilesAbsent: true,
  commits: [{ completed: false, includeDependencies: true, operationId: 'failed', error: '隔离验证：队列写入失败' }, { completed: true, includeDependencies: true, operationId: 'retry', files: ['root0','root1'] }],
  progress: ['failed','retry'].map(operationId => ({ operationId, stage: 'download', overall: .25 })), observedProgress: { ready: true, text: '25%' }, files: Array.from({ length: 2 }, (_, i) => ({ file: 'root'+i, bytes: 123, expectedBytes: 123, sha1: 'a'.repeat(40), expectedSHA1: 'a'.repeat(40), sha256: 'b'.repeat(64) }))
})

test('gallery queue proof rejects missing explicit confirmation, background navigation or plan discard', () => {
  assert.doesNotThrow(() => assertQueueProof(proof()))
  for (const patch of [{ cancelledPreview: { committed: true, discarded: true } }, { cancelledPreview: { committed: false, discarded: false } }, { backgroundNavigation: false }, { dependencyBlocksCommit: false }, { classification: 'Real public installer' }]) assert.throws(() => assertQueueProof({ ...proof(), ...patch }))
})

test('gallery queue rejects uncorrelated progress, swallowed errors or duplicate successful commits', () => {
  for (const patch of [{ progress: [] }, { progress: [{ operationId: 'foreign', stage: 'download', overall: .25 }] }, { commits: proof().commits.map(row => ({ ...row, completed: true })) }, { commits: proof().commits.map(row => ({ ...row, operationId: '' })) }, { commits: proof().commits.map(row => ({ ...row, includeDependencies: false })) }, { failedCommitLeavesFilesAbsent: false }]) assert.throws(() => assertQueueProof({ ...proof(), ...patch }))
})

test('gallery queue disk evidence requires both complete matching JAR sizes and hashes', () => {
  assert.throws(() => assertQueueProof({ ...proof(), files: proof().files.slice(1) }))
  for (const patch of [{ bytes: 122 }, { sha1: 'c'.repeat(40) }, { sha256: '' }]) assert.throws(() => assertQueueProof({ ...proof(), files: [{ ...proof().files[0], ...patch }, proof().files[1]] }))
})

test('extension keeps existing real gallery and favorites persistence contracts and the explicitly controlled queue', () => {
  const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8')
  const extension = read('verify-gallery-favorites-118-ui.cjs'), queue = read('qa-gallery-community121.cjs')
  for (const original of ['assert.equal(hash(managed),beforeHash)', 'validated link merges the duplicate project', 'failed bulk cancellation retains both records and selections', 'bulk retry atomically clears both favorites', 'originalFavorites', 'gallery118Handlers']) assert(extension.includes(original))
  assert(extension.includes("require('./qa-gallery-community121.cjs')"))
  for (const selector of ['.dependency-choice input', '.queue-item[data-state=confirmation]', '.queue-item[data-state=preparing]', '.queue-item[data-state=installing]', '.queue-item[data-state=failed]', '.queue-item[data-state=completed]']) assert(queue.includes(selector))
  assert(queue.includes('gallery121Commits'))
  assert(queue.includes('fs.writeFileSync(file,Buffer.from(j.base64'))
  assert(queue.includes('assertQueueProof(queue)') && queue.includes('fs.readFileSync(paths[i])'))
})
