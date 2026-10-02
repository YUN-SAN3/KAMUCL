import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { dragResourceFiles } from '../src/main/core/resourceDragPaths'

test('native drag resolves literal resource entries, deduplicates, and rejects traversal, missing files and links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-drag-'))
  try {
    const dir = path.join(root, 'mods'); await fs.mkdir(dir)
    for (const name of ['中文.jar', 'disabled.jar.disabled', '材质.zip']) await fs.writeFile(path.join(dir, name), 'fixture')
    await fs.mkdir(path.join(dir, '目录材质'))
    assert.deepEqual(await dragResourceFiles(dir, ['中文.jar', '中文.jar', 'disabled.jar.disabled', '目录材质']), ['中文.jar', 'disabled.jar.disabled', '目录材质'].map(n => path.join(dir, n)))
    for (const names of [[], ['../outside'], ['..\\outside'], ['sub/file'], ['C:secret'], ['missing.jar'], [null]]) await assert.rejects(dragResourceFiles(dir, names))
    await fs.symlink(root, path.join(dir, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(dragResourceFiles(dir, ['external']), /链接/)
    await fs.symlink(dir, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(dragResourceFiles(path.join(root, 'linked'), ['中文.jar']), /普通目录/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
