import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareLaunchAssets, type AssetTransfer } from '../src/main/core/launchAssets'

const sha = (data: string | Buffer) => crypto.createHash('sha1').update(data).digest('hex')
function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-assets-'))
  const own = path.join(temp, 'other-launcher', 'assets'), shared = path.join(temp, 'default', 'assets')
  const game = path.join(temp, 'other-launcher', 'versions', 'renamed')
  const text = Buffer.from('{"language.name":"简体中文","menu.singleplayer":"单人游戏"}')
  const hash = sha(text), entry = { hash, size: text.length }
  const indexText = JSON.stringify({ objects: { 'minecraft/lang/zh_cn.json': entry } })
  const version = { assets: 'obsolete-alias', assetIndex: { id: 'correct-index', url: 'https://fixture/index', sha1: sha(indexText) } }
  const put = (file: string, bytes: string | Buffer) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes) }
  const indexFile = (root: string) => path.join(root, 'indexes', 'correct-index.json')
  const objectFile = (root: string) => path.join(root, 'objects', hash.slice(0, 2), hash)
  return { temp, own, shared, game, text, hash, entry, indexText, version, put, indexFile, objectFile }
}

test('external repository language assets are reused offline with the exact index id and existing options untouched', async () => {
  const f = fixture()
  try {
    f.put(f.indexFile(f.own), f.indexText); f.put(f.objectFile(f.own), f.text)
    const options = 'lang:zh_cn\nfov:0.6\nrenderDistance:18\nkey_key.forward:key.keyboard.up\n'
    f.put(path.join(f.game, 'options.txt'), options)
    const actual = await prepareLaunchAssets(f.version, [f.own, f.shared], f.shared, f.game, async () => { throw Error('must not download') })
    assert.deepEqual(actual, { root: f.own, indexId: 'correct-index', gameAssets: f.own })
    assert.equal(fs.readFileSync(path.join(actual.root, 'indexes', actual.indexId + '.json'), 'utf8'), f.indexText)
    assert.equal(JSON.parse(fs.readFileSync(f.objectFile(actual.root), 'utf8'))['language.name'], '简体中文')
    assert.equal(fs.readFileSync(path.join(f.game, 'options.txt'), 'utf8'), options)
    assert(!fs.existsSync(f.shared))
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }) }
})

test('missing language objects are reused from another cache by hash, including same-size corrupt language repair', async () => {
  const f = fixture()
  try {
    f.put(f.indexFile(f.own), f.indexText); f.put(f.objectFile(f.shared), f.text)
    f.put(f.objectFile(f.own), Buffer.alloc(f.text.length, 32))
    const actual = await prepareLaunchAssets(f.version, [f.own, f.shared], f.shared, f.game, async () => { throw Error('must reuse local object') })
    assert.equal(actual.root, f.own)
    assert.deepEqual(fs.readFileSync(f.objectFile(f.own)), f.text)
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }) }
})

test('absent index and objects are repaired before returning a launchable asset directory', async () => {
  const f = fixture(), calls: AssetTransfer[][] = []
  try {
    const actual = await prepareLaunchAssets(f.version, [f.own, f.shared], f.shared, f.game, async tasks => {
      calls.push(tasks)
      for (const t of tasks) f.put(t.dest, t.url === f.version.assetIndex.url ? f.indexText : f.text)
    })
    assert.equal(actual.root, f.shared); assert.equal(calls.length, 2)
    assert.equal(calls[1][0].sha1, f.hash)
    assert.deepEqual(fs.readFileSync(f.objectFile(f.shared)), f.text)
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }) }
})

test('missing metadata, failed transfer and wrong hash stop launch instead of silently opening with empty languages', async () => {
  const f = fixture()
  try {
    await assert.rejects(prepareLaunchAssets({ assets: 'correct-index' }, [f.own], f.shared, f.game, async () => {}), /缺少游戏资源索引/)
    await assert.rejects(prepareLaunchAssets(f.version, [f.own], f.shared, f.game, async () => { throw Error('offline') }), /offline/)
    f.put(f.indexFile(f.own), f.indexText)
    await assert.rejects(prepareLaunchAssets(f.version, [f.own], f.shared, f.game, async tasks => {
      for (const t of tasks) f.put(t.dest, Buffer.alloc(f.text.length))
    }), /补全失败/)
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }) }
})

test('legacy virtual and map_to_resources directories are materialized without changing modern assets_root', async () => {
  const f = fixture()
  try {
    f.put(f.objectFile(f.own), f.text)
    for (const mode of ['virtual', 'map_to_resources']) {
      f.put(f.indexFile(f.own), JSON.stringify({ objects: { 'lang/zh_CN.lang': f.entry }, [mode]: true }))
      const result = await prepareLaunchAssets({ assets: 'correct-index' }, [f.own], f.shared, f.game, async () => { throw Error('offline cache should suffice') })
      assert.equal(result.root, f.own)
      assert.equal(result.gameAssets, mode === 'virtual' ? path.join(f.own, 'virtual', 'correct-index') : path.join(f.game, 'resources'))
      assert.deepEqual(fs.readFileSync(path.join(result.gameAssets, 'lang', 'zh_CN.lang')), f.text)
    }
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }) }
})

test('invalid indexes cannot materialize paths outside the selected asset directory', async () => {
  const f = fixture()
  try {
    f.put(f.indexFile(f.own), JSON.stringify({ objects: { '../outside.txt': f.entry }, virtual: true }))
    await assert.rejects(prepareLaunchAssets({ assets: 'correct-index' }, [f.own], f.shared, f.game, async () => {}), /缺少游戏资源索引/)
    await assert.rejects(prepareLaunchAssets({ assets: '../escape' }, [f.own], f.shared, f.game, async () => {}), /名称无效/)
    assert(!fs.existsSync(path.join(f.temp, 'outside.txt')))
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }) }
})
