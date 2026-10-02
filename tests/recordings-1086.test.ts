import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import Zip from 'adm-zip'
import { copyRecording, validateRecording } from '../src/main/core/recordingFiles'
import { resolveRecordingDependencies, compatibleRecordingMod } from '../src/shared/recordingMods'
import type { CommunityFile } from '../src/shared/types'

test('recording archives distinguish complete Replay and Flashback from unrelated ZIP and incomplete recordings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-recording-test-'))
  try {
    const make = (name: string, entries: Record<string, string>) => { const zip = new Zip(); for (const [n, value] of Object.entries(entries)) zip.addFile(n, Buffer.from(value)); const f = path.join(root, name); zip.writeZip(f); return f }
    await validateRecording(make('one.mcpr', { 'metaData.json': '{}', 'recording.tmcpr': 'packets' }), 'replaymod')
    await validateRecording(make('two.zip', { 'metadata.json': JSON.stringify({ uuid: 'test', chunks: { 'c0.flashback': {} } }), 'c0.flashback': 'packets' }), 'flashback')
    await assert.rejects(validateRecording(make('mod.zip', { 'fabric.mod.json': '{}' }), 'flashback'), /完整/)
    await assert.rejects(validateRecording(make('partial.zip', { 'metadata.json': JSON.stringify({ uuid: 'test', chunks: { missing: {} } }) }), 'flashback'), /完整/)
    await assert.rejects(validateRecording(make('oversize.mcpr', { 'metaData.json': ' '.repeat(1024 * 1024 + 1), 'recording.tmcpr': 'data' }), 'replaymod'), /过大/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('recording copies preserve originals and same-name destinations, cancel cleanly, reject links and changing sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-recording-test-'))
  try {
    const input = path.join(root, '中文.mcpr'), dest = path.join(root, 'library'); await fs.mkdir(dest); await fs.writeFile(input, 'recording'); await fs.writeFile(path.join(dest, '中文.mcpr'), 'original destination')
    const copied = await copyRecording(input, dest); assert.equal(path.basename(copied), '中文 (1).mcpr'); assert.equal(await fs.readFile(copied, 'utf8'), 'recording'); assert.equal(await fs.readFile(input, 'utf8'), 'recording'); assert.equal(await fs.readFile(path.join(dest, '中文.mcpr'), 'utf8'), 'original destination')
    const controller = new AbortController(); controller.abort(); await assert.rejects(copyRecording(input, dest, controller.signal)); assert(!(await fs.readdir(dest)).some(n => n.endsWith('.part')))
    const changing = path.join(root, 'change.mcpr'); await fs.writeFile(changing, Buffer.alloc(100000)); let changed = false
    await assert.rejects(copyRecording(changing, dest, undefined, () => { if (!changed) { changed = true; require('node:fs').appendFileSync(changing, 'changed') } }), /变化/)
    const link = path.join(root, 'link'); await fs.symlink(dest, link, process.platform === 'win32' ? 'junction' : 'dir'); await assert.rejects(copyRecording(input, link), /链接/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
const file = (projectId: string, fileId = projectId): CommunityFile => ({ source: 'modrinth', projectId, fileId, fileName: projectId + '.jar', version: fileId, gameVersions: ['1.21.1'], loaders: ['fabric'], sha1: 'a'.repeat(40), url: 'https://cdn.modrinth.com/test.jar', size: 2, releaseType: 'release', date: '' })
test('recording mod plan honors exact versions, required dependencies, cycles and rejects incompatible or conflicting dependencies', async () => {
  const a = file('a'), b = file('b'); a.dependencies = [{ projectId: 'b', fileId: 'b', required: true }, { projectId: 'optional', required: false }]; b.dependencies = [{ projectId: 'a', required: true }]
  let calls = 0
  const plan = await resolveRecordingDependencies([a], '1.21.1', 'fabric', async (p, v) => { calls++; assert.equal(p, 'b'); assert.equal(v, 'b'); return b }); assert.equal(plan.length, 2); assert.equal(calls, 1)
  assert(!compatibleRecordingMod(a, '26.3', 'fabric')); assert(!compatibleRecordingMod(a, '1.21.1', 'forge'))
  await assert.rejects(resolveRecordingDependencies([a], '1.21.1', 'fabric', async () => ({ ...b, loaders: ['neoforge'] })), /兼容/)
  await assert.rejects(resolveRecordingDependencies([a, file('b', 'other')], '1.21.1', 'fabric', async () => b), /冲突/)
})
