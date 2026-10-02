import test from 'node:test'
import assert from 'node:assert/strict'
import { renamedServerBindings } from '../src/main/core/serverEditing'
import type { ServerEntry } from '../src/shared/types'

test('cross-folder rename preserves other roots and ambiguous legacy server references', () => {
  const rows: ServerEntry[] = [
    { id: 'a', name: 'A', address: 'localhost', versionId: 'same', folder: 'D:\\Games' },
    { id: 'b', name: 'B', address: 'localhost', versionId: 'same', folder: 'E:\\Games' },
    { id: 'shared', name: 'shared', address: 'localhost', sourceGameDirectory: 'D:/Games', candidateVersionIds: ['same', 'other'] },
    { id: 'prefix', name: 'prefix', address: 'localhost', sourceGameDirectory: 'D:/Games-other', candidateVersionIds: ['same'] },
    { id: 'legacy', name: 'legacy', address: 'localhost', versionId: 'same' }
  ]
  const result = renamedServerBindings(rows, 'same', 'renamed', 'd:/games/', true)
  assert.equal(result[0].versionId, 'renamed')
  assert.equal(result[1].versionId, 'same')
  assert.deepEqual(result[2].candidateVersionIds, ['renamed', 'other'])
  assert.deepEqual(result[3].candidateVersionIds, ['same'])
  assert.equal(result[4].versionId, 'same')
  assert.equal(rows[0].versionId, 'same')
  assert.equal(renamedServerBindings([rows[4]], 'same', 'new', 'D:/Games', false)[0].versionId, 'new')
})
