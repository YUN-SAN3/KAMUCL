import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { build, buildSync } from 'esbuild'
import Zip from 'adm-zip'
import { curseFingerprint } from '../src/main/core/modIconIdentity'
import { parseModArchive } from '../src/main/core/modMetadata'
import { ModPlanStore } from '../src/main/core/modPlanStore'

const req = createRequire(import.meta.url)
/** The 1.1.12 algorithm, kept here as an independent exact-output oracle. */
export function previousFingerprint(input: Buffer): number {
  const data = Buffer.allocUnsafe(input.length)
  let length = 0
  for (const byte of input) if (byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32) data[length++] = byte
  const m = 0x5bd1e995
  let h = (1 ^ length) >>> 0, at = 0
  while (length - at >= 4) {
    let k = data.readUInt32LE(at)
    k = Math.imul(k, m); k ^= k >>> 24; k = Math.imul(k, m)
    h = Math.imul(h, m) ^ k; at += 4
  }
  const tail = length - at
  if (tail >= 3) h ^= data[at + 2] << 16
  if (tail >= 2) h ^= data[at + 1] << 8
  if (tail >= 1) { h ^= data[at]; h = Math.imul(h, m) }
  h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15
  return h >>> 0
}

test('1113 CurseForge fingerprint exactly matches the previous algorithm without allocating a file copy', () => {
  let seed = 0x113a92f
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0 }
  const inputs = [Buffer.alloc(0), Buffer.from([9, 10, 13, 32]), Buffer.from([0, 255, 128]), Buffer.from('a \n\rb\tc')]
  for (let n = 0; n < 700; n++) {
    const input = Buffer.alloc(random() % 8192)
    for (let i = 0; i < input.length; i++) input[i] = random() & 255
    inputs.push(input)
  }
  for (const input of inputs) {
    const snapshot = Buffer.from(input)
    assert.equal(curseFingerprint(input), previousFingerprint(input), `length ${input.length}`)
    assert.deepEqual(input, snapshot, 'Input bytes must remain untouched for ZIP/hash consumers')
  }
  const input = Buffer.alloc(4 * 1024 * 1024, 0xd7), allocate = Buffer.allocUnsafe
  const allocations: number[] = []
  try {
    Buffer.allocUnsafe = ((size: number) => { allocations.push(size); return allocate(size) }) as typeof Buffer.allocUnsafe
    const expected = previousFingerprint(input)
    assert.deepEqual(allocations, [input.length])
    allocations.length = 0
    assert.equal(curseFingerprint(input), expected)
    assert.deepEqual(allocations, [])
  } finally { Buffer.allocUnsafe = allocate }
})

function clock() {
  let now = 0, next = 0
  const jobs = new Map<number, { at: number; callback: () => void }>()
  return {
    now: () => now,
    setTimeout: (callback: () => void, delay: number) => { const id = ++next; jobs.set(id, { at: now + delay, callback }); return id as unknown as ReturnType<typeof setTimeout> },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => { jobs.delete(id as unknown as number) },
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at; jobs.delete(due[0]); due[1].callback()
      }
      now = until
    },
    timers: () => jobs.size
  }
}

test('1113 mod snapshots expire without another request and only one expiry timer is retained', () => {
  const time = clock(), store = new ModPlanStore<{ payload: string[] }>(30 * 60_000, time, 1000)
  for (let n = 0; n < 1000; n++) store.set(String(n), { payload: Array(100).fill(`mod-${n}`) })
  assert.equal(store.size, 1000); assert.equal(time.timers(), 1)
  time.advance(30 * 60_000)
  assert.equal(store.size, 0); assert.equal(time.timers(), 0)
  store.set('new', { payload: ['still available'] })
  assert.deepEqual(store.get('new')?.payload, ['still available'])
})

test('1113 discard and expiry protect active transactions until their last lease is released', () => {
  const time = clock(), store = new ModPlanStore<{ group: string; value: string }>(100, time)
  store.set('active', { group: 'list', value: 'snapshot' }); store.set('unused', { group: 'list', value: 'unused' })
  const first = store.lease('active')!, second = store.lease('active')!
  store.deleteMatching(value => value.group === 'list')
  assert.equal(store.size, 1); assert.equal(store.get('active'), undefined)
  assert.equal(first.value.value, 'snapshot')
  first.release(); first.release(); assert.equal(store.size, 1)
  second.release(); assert.equal(store.size, 0)
  store.set('expire-active', { group: 'other', value: 'expiry snapshot' })
  const held = store.lease('expire-active')!
  time.advance(100)
  assert.equal(store.size, 1); assert.equal(store.get('expire-active'), undefined)
  assert.equal(held.value.value, 'expiry snapshot')
  held.release(); assert.equal(store.size, 0); assert.equal(time.timers(), 0)
})

test('1113 at most eight unused mod snapshots are kept and active leases cannot be evicted', () => {
  const time = clock(), store = new ModPlanStore<{ index: number }>(1000, time)
  store.set('active', { index: -1 }); const active = store.lease('active')!
  for (let i = 0; i < 1000; i++) store.set(String(i), { index: i })
  assert.equal(store.size, 9); assert.equal(store.get('0'), undefined)
  assert.equal(store.get('active'), active.value); assert.equal(store.get('999')?.index, 999)
  active.release(); assert.equal(store.size, 8); assert.equal(store.get('active'), undefined)
  for (let i = 992; i < 1000; i++) store.delete(String(i))
  assert.equal(store.size, 0); assert.equal(time.timers(), 0)
})

test('1113 catalog parsing skips unused icon decompression while nested dependency providers remain exact', () => {
  const child = new Zip(); child.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'bundled', version: '1', icon: 'child.png' }))); child.addFile('child.png', Buffer.alloc(2000, 7))
  const zip = new Zip(); zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'parent', name: 'Parent', version: '2', icon: 'icon.png', jars: [{ file: 'child.jar' }] }))); zip.addFile('icon.png', Buffer.alloc(4000, 5)); zip.addFile('child.jar', child.toBuffer())
  const full = parseModArchive(new Zip(zip.toBuffer()), 'parent.jar', 'parent.jar')
  const { iconDataUrl, ...expected } = full
  assert(iconDataUrl)
  const archive = new Zip(zip.toBuffer()), read = archive.readFile.bind(archive), readIcons: string[] = []
  archive.readFile = ((entry: any, ...args: any[]) => { if ((typeof entry === 'string' ? entry : entry.entryName) === 'icon.png') readIcons.push('icon'); return (read as any)(entry, ...args) }) as typeof archive.readFile
  const catalog = parseModArchive(archive, 'parent.jar', 'parent.jar', 0, false)
  assert.deepEqual(catalog, expected); assert.deepEqual(readIcons, [])
  assert(catalog.provides?.some(mod => mod.id === 'bundled'))
})

test('1113 scan deduplication separates catalog and icon results while retaining hashes and disabled files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-mod-resources-1113-'))
  try {
    const zip = new Zip(); zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'fixture', name: 'Fixture', version: '1', icon: 'icon.png' }))); zip.addFile('icon.png', Buffer.alloc(4096, 3))
    const bytes = zip.toBuffer(); fs.writeFileSync(path.join(root, 'a.jar.disabled'), bytes)
    buildSync({ entryPoints: ['src/main/core/modScanWorker.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'modScanWorker.cjs') })
    const output = await build({ entryPoints: ['src/main/core/modScan.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'quiet-log', setup(builder) { builder.onResolve({ filter: /^\.\/launcherLog$/ }, () => ({ path: 'log', namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const logScope=()=>({info:()=>{}})' })) } }] })
    let workers = 0
    class CountedWorker extends Worker { constructor(...args: ConstructorParameters<typeof Worker>) { workers++; super(...args) } }
    const mod = { exports: {} as any }
    new Function('require', 'module', 'exports', '__dirname', output.outputFiles[0].text)((id: string) => id === 'node:worker_threads' ? { Worker: CountedWorker } : req(id), mod, mod.exports, root)
    const names = ['a.jar.disabled'], catalog = mod.exports.scanModDirectory(root, true, names, 'catalog')
    // Consumers now own separate cancellation subscriptions. The work and
    // resolved snapshot remain shared, without sharing the caller's Promise.
    const sameCatalog = mod.exports.scanModDirectory(root, true, names, 'catalog')
    const icons = mod.exports.scanModDirectory(root, true, names, 'icons')
    const [metadata, repeatedMetadata, illustrated] = await Promise.all([catalog, sameCatalog, icons])
    assert.equal(workers, 2)
    assert.equal(repeatedMetadata, metadata)
    assert.equal(metadata[0].iconDataUrl, undefined); assert(illustrated[0].iconDataUrl)
    const { iconDataUrl, ...illustratedMetadata } = illustrated[0]
    assert.deepEqual(metadata[0], illustratedMetadata)
    assert.equal(metadata[0].sha1, crypto.createHash('sha1').update(bytes).digest('hex'))
    assert.equal(metadata[0].fingerprint, previousFingerprint(bytes))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('1113 icon serialization retains completion only and survives a failed request without losing caller results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-icons-queue-1113-'))
  try {
    for (const name of ['a.jar', 'b.jar', 'c.jar']) fs.writeFileSync(path.join(root, name), 'fixture')
    const source = fs.readFileSync('src/main/core/modIcons.ts', 'utf8') + '\nexport const inspectQueue=()=>queue'
    const output = await build({ stdin: { contents: source, loader: 'ts', resolveDir: path.resolve('src/main/core') }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'queue-fixture', setup(builder) {
      const mocks: Record<string, string> = { electron: 'export const app={getPath:()=>__h.root}', './modScan': 'export const scanModDirectory=(...args)=>__h.scan(...args)', './resourceDirectory': 'export const resolveResourceDirectory=async()=>__h.root', './community': 'export const cfChannel=()=>({base:"https://fixture",key:""})', './httpClient': 'export const httpFetch=async()=>{throw Error("offline")}' }
      builder.onResolve({ filter: /^(electron|\.\/modScan|\.\/resourceDirectory|\.\/community|\.\/httpClient)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }))
    } }] })
    let wake!: () => void, finish!: () => void, active = 0, maximum = 0
    const started = new Promise<void>(resolve => wake = resolve), paused = new Promise<void>(resolve => finish = resolve)
    const calls: string[][] = [], icon = 'data:image/png;base64,' + Buffer.alloc(512 * 1024, 3).toString('base64')
    const h = { root, scan: async (_dir: string, _hash: boolean, names: string[], purpose: string) => {
      assert.equal(purpose, 'icons'); calls.push(names); active++; maximum = Math.max(maximum, active)
      try { if (names[0] === 'a.jar') { wake(); await paused }; if (names[0] === 'b.jar') throw Error('failed scan'); return names.map(fileName => ({ fileName, sha1: '1'.repeat(40), iconDataUrl: icon })) }
      finally { active-- }
    } }
    const mod = { exports: {} as any }
    new Function('require', 'module', 'exports', '__h', output.outputFiles[0].text)(req, mod, mod.exports, h)
    const a = mod.exports.getModIcons('instance', root, ['a.jar']); await started
    const b = mod.exports.getModIcons('instance', root, ['b.jar']), c = mod.exports.getModIcons('instance', root, ['c.jar'])
    // Register a rejection observer immediately; queue failure stays visible to
    // that caller while the following page can still load.
    const failed = assert.rejects(b, /failed scan/)
    assert.equal(calls.length, 1); finish()
    assert.equal((await a)['a.jar'], icon); await failed; assert.equal((await c)['c.jar'], icon)
    assert.equal(maximum, 1); assert.deepEqual(calls, [['a.jar'], ['b.jar'], ['c.jar']])
    assert.equal(await mod.exports.inspectQueue(), undefined, 'Module tail must not hold the final icon map')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('1113 version modal disposes closed lists and every late or superseded plan response', async () => {
  const script = fs.readFileSync('src/renderer/src/components/ModVersionModal.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const output = await build({ stdin: { contents: script + '\nexport {load,select,choices,plan}', loader: 'ts', resolveDir: path.resolve('src/renderer/src/components') }, bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'ui-fixture', setup(builder) { builder.onResolve({ filter: /^(vue|\.\.\/api)$/ }, args => ({ path: args.path, namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'vue' ? 'export const ref=value=>({value});export const onMounted=()=>{};export const onUnmounted=callback=>__h.unmount=callback' : 'export const errText=error=>error.message' })) } }] })
  const pending: Array<{ channel: string; resolve: (value: any) => void }> = [], discarded: string[] = [], h: any = {}
  const window = { kamucl: { invoke: (channel: string, id: string) => channel === 'mods:versionDiscard' ? (discarded.push(id), Promise.resolve()) : new Promise(resolve => pending.push({ channel, resolve })) } }
  const mod = { exports: {} as any }
  new Function('require', 'module', 'exports', 'window', '__h', 'defineProps', 'defineEmits', output.outputFiles[0].text)(req, mod, mod.exports, window, h, () => ({ source: { id: 'instance', folder: 'folder' }, fileName: 'mod.jar' }), () => () => {})
  const ui = mod.exports
  let load = ui.load(); h.unmount(); pending.shift()!.resolve({ id: 'closed-list' }); await load
  assert.deepEqual(discarded, ['closed-list']); assert.equal(ui.choices.value, undefined)
  // A fresh owner tests rapid choices and closing during a remote plan request.
  const fresh = { exports: {} as any }, h2: any = {}
  new Function('require', 'module', 'exports', 'window', '__h', 'defineProps', 'defineEmits', output.outputFiles[0].text)(req, fresh, fresh.exports, window, h2, () => ({ source: { id: 'instance', folder: 'folder' }, fileName: 'mod.jar' }), () => () => {})
  load = fresh.exports.load(); pending.shift()!.resolve({ id: 'live-list' }); await load
  const earlier = fresh.exports.select('a'), later = fresh.exports.select('b')
  pending.shift()!.resolve({ id: 'older-plan' }); await earlier
  assert(discarded.includes('older-plan')); assert.equal(fresh.exports.plan.value, undefined)
  h2.unmount(); pending.shift()!.resolve({ id: 'after-close' }); await later
  assert(discarded.includes('live-list')); assert(discarded.includes('after-close'))
  assert.equal(fresh.exports.plan.value, undefined)
})
