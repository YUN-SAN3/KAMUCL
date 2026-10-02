import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { recycleFile } from '../src/main/core/recycleFile'

test('file and directory removal delegates the complete target to the recycle operation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-recycle-'))
  const source = path.join(root, 'resources'), bin = path.join(root, 'bin')
  await fs.mkdir(source); await fs.mkdir(bin)
  try {
    await fs.writeFile(path.join(source, '中文.jar.disabled'), 'original mod')
    await fs.mkdir(path.join(source, 'texture')); await fs.writeFile(path.join(source, 'texture', 'pack.mcmeta'), 'pack')
    for (const name of ['中文.jar.disabled', 'texture']) {
      await recycleFile(source, name, async target => { assert.equal(path.dirname(target), await fs.realpath(source)); await fs.rename(target, path.join(bin, name)) })
      await assert.rejects(fs.stat(path.join(source, name)), { code: 'ENOENT' })
    }
    assert.equal(await fs.readFile(path.join(bin, '中文.jar.disabled'), 'utf8'), 'original mod')
    assert.equal(await fs.readFile(path.join(bin, 'texture', 'pack.mcmeta'), 'utf8'), 'pack')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('recycle failure and native no-op preserve original bytes; invalid names and links never reach the native API', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-recycle-'))
  let calls = 0
  const trash = async () => { calls++; throw new Error('EPERM locked') }
  try {
    await fs.writeFile(path.join(root, 'keep.jar'), 'keep me')
    await assert.rejects(recycleFile(root, 'keep.jar', trash), /未执行永久删除/)
    await assert.rejects(recycleFile(root, 'keep.jar', async () => {}), /系统未移除/)
    assert.equal(await fs.readFile(path.join(root, 'keep.jar'), 'utf8'), 'keep me')
    for (const name of ['', '.', '..', '../keep.jar', 'x/y', 'x\\y', 'C:keep.jar', 'keep.jar ']) await assert.rejects(recycleFile(root, name, trash))
    assert.equal(calls, 1)
    const dir = path.join(root, 'real'); await fs.mkdir(dir)
    await fs.symlink(dir, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(recycleFile(root, 'link', trash), /链接/)
    assert.equal(calls, 1); assert((await fs.stat(dir)).isDirectory())
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
