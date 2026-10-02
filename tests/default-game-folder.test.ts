import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensureDefaultGameFolder } from '../src/main/core/defaultGameFolder'

test('首次运行创建内置目录，可重复调用且保留现有文件', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-first-run-'))
  try {
    const root = path.join(temp, '.kamucl')
    ensureDefaultGameFolder(temp, [{ path: root }])
    assert(fs.statSync(root).isDirectory())
    fs.writeFileSync(path.join(root, 'keep.txt'), 'saved')
    ensureDefaultGameFolder(temp, [{ path: root }])
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'saved')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('不创建或替换用户缺失的外置目录，真实错误保持可见', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-external-'))
  try {
    const external = path.join(temp, 'missing-disk')
    ensureDefaultGameFolder(temp, [{ path: external }])
    assert.equal(fs.existsSync(external), false)
    assert.equal(fs.existsSync(path.join(temp, '.kamucl')), false)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
