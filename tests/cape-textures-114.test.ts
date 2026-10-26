import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { downloadTexture, MAX_TEXTURE_BYTES, texturePngSize, textureUrl } from '../src/main/core/skinTexture'
import { SkinProfileCache } from '../src/main/core/skinProfileCache'
import { normalizeCape, renderCape } from '../src/renderer/src/skin-render'
import type { ProfileSkins } from '../src/shared/types'

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
/** A complete, independently generated RGBA PNG, not a fabricated data-URL prefix. */
function png(width = 64, height = 32): Buffer {
  const chunk = (name: string, content: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), content]), size = Buffer.alloc(4), crc = Buffer.alloc(4)
    size.writeUInt32BE(content.length); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([size, body, crc])
  }
  const ihdr = Buffer.alloc(13), rgba = Buffer.alloc((width * 4 + 1) * height)
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 4 + 1) + 1 + x * 4
    rgba.set([x % 256, y % 256, 51, 255], at)
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rgba)), chunk('IEND', Buffer.alloc(0))])
}
const dataUrl = (width = 64, height = 32) => 'data:image/png;base64,' + png(width, height).toString('base64')

test('official HTTP texture URLs upgrade only their exact host; provider URLs and unsafe protocols stay distinct', async () => {
  const suffix = '/texture/' + 'a'.repeat(64)
  assert.equal(textureUrl('http://textures.minecraft.net' + suffix), 'https://textures.minecraft.net' + suffix)
  assert.equal(textureUrl('http://textures.minecraft.net.evil.invalid/cape.png'), 'http://textures.minecraft.net.evil.invalid/cape.png')
  assert.equal(textureUrl('http://skin.example:8080/cape.png'), 'http://skin.example:8080/cape.png')
  for (const value of ['file:///cape.png', 'data:image/png;base64,a', 'https://secret@skin.example/cape.png']) {
    let calls = 0
    const result = await downloadTexture(value, (async () => { calls++; throw Error('must not fetch') }) as typeof fetch)
    assert.equal(calls, 0); assert.equal(result.dataUrl, undefined); assert.match(result.textureError!, /地址无效/)
  }
})

test('PNG download preserves exact bytes and dimensions, retries failure, and reports undecodable/oversized bodies', async () => {
  const bytes = png(128,64), urls: string[] = []
  const result = await downloadTexture('http://textures.minecraft.net/texture/' + 'b'.repeat(64), (async input => {
    urls.push(String(input)); return urls.length === 1 ? new Response('unavailable', { status: 503 }) : new Response(bytes)
  }) as typeof fetch, actual => assert.deepEqual(actual, bytes))
  assert.equal(urls.length, 2); assert(urls.every(url => url.startsWith('https://textures.minecraft.net/')))
  assert.deepEqual(Buffer.from(result.dataUrl!.split(',')[1], 'base64'), bytes)
  assert.deepEqual(texturePngSize(bytes), { width:128, height:64 })
  for (const body of [Buffer.from('<html>error</html>'), Buffer.alloc(MAX_TEXTURE_BYTES + 1), png(4097,1)]) {
    const rejected = await downloadTexture('https://skin.example/cape.png', (async () => new Response(body)) as typeof fetch)
    assert.equal(rejected.dataUrl, undefined); assert.match(rejected.textureError!, /PNG|过大|尺寸/)
  }
  const corrupt = await downloadTexture('https://skin.example/cape.png', (async () => new Response(bytes)) as typeof fetch,
    () => { throw Error('材质 PNG 无法解码') })
  assert.equal(corrupt.dataUrl, undefined); assert.match(corrupt.textureError!, /无法解码/)
})

test('partial cached capes retry after restart and deduplicate; complete cache avoids network and keeps no secrets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-cape-cache-'))
  try {
    const incomplete = { username:'fixture', skins:[{ variant:'classic', url:'https://skin.example/skin.png', dataUrl:dataUrl(64,64) }],
      capes:[{ id:'a', alias:'Aurora', active:true, url:'https://skin.example/a.png', textureError:'HTTP 503，请刷新重试' },
        { id:'p', alias:'Pan', active:false, url:'https://skin.example/p.png', dataUrl:dataUrl() }], accessToken:'NEVER_PERSIST' } as ProfileSkins
    await new SkinProfileCache(() => directory).get('account-A', async () => incomplete)
    const restarted = new SkinProfileCache(() => directory), complete = structuredClone(incomplete)
    complete.capes[0].dataUrl = dataUrl(128,64); delete complete.capes[0].textureError
    let loads = 0
    const load = async () => { loads++; await Promise.resolve(); return complete }
    const [first, second] = await Promise.all([restarted.get('account-A', load), restarted.get('account-A', load)])
    assert.equal(loads, 1); assert.equal(first.capes[0].dataUrl, complete.capes[0].dataUrl); assert.deepEqual(first, second)
    await restarted.get('account-A', async () => { throw Error('complete cache must not fetch') })
    const disk = fs.readdirSync(directory).map(file => fs.readFileSync(path.join(directory,file),'utf8')).join('')
    assert(!disk.includes('NEVER_PERSIST')); assert(disk.includes('Aurora'))
    let isolated = 0
    await restarted.get('account-B', async () => { isolated++; return incomplete })
    assert.equal(isolated, 1)
    const refreshed = structuredClone(complete)
    refreshed.capes[0].active = false; refreshed.capes[0].dataUrl = undefined; refreshed.capes[0].textureError = 'HTTP 503，请刷新重试'
    refreshed.capes[1].active = true; refreshed.capes[1].url = 'https://skin.example/new.png'; refreshed.capes[1].dataUrl = undefined
    const next = await restarted.get('account-A', async () => refreshed, true)
    assert.equal(next.capes[0].dataUrl, complete.capes[0].dataUrl, 'same texture can retain previously downloaded pixels')
    assert.equal(next.capes[0].active, false, 'fresh activation state remains authoritative')
    assert.match(next.capes[0].textureError!, /HTTP 503/, 'retained pixels do not erase the actual refresh failure')
    assert.equal(next.capes[1].dataUrl, undefined, 'changed URLs cannot reuse another texture')
  } finally { fs.rmSync(directory, { recursive:true, force:true }) }
})

test('standard, compact and HD cape atlases share UV-normalization and thumbnail crop without color changes', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document'), draws: any[][] = []
  Object.defineProperty(globalThis, 'document', { configurable:true, value:{ createElement:() => {
    const canvas = { width:0, height:0, getContext:() => ({ clearRect(){}, imageSmoothingEnabled:true,
      drawImage(...args:any[]){ draws.push(args) } }), toDataURL:() => 'data:image/png;base64,fixture' }
    return canvas
  } } })
  try {
    for (const [width,height,scale] of [[64,32,1],[128,64,2],[22,17,1],[44,34,2],[46,22,1],[92,44,2]]) {
      draws.length = 0
      const image = { width,height,naturalWidth:width,naturalHeight:height } as HTMLImageElement
      const atlas = normalizeCape(image)
      assert.equal(atlas.width,64*scale); assert.equal(atlas.height,32*scale)
      assert.deepEqual(draws[0], [image,0,0,width,height], 'original RGBA image is copied without resizing/recoloring')
      draws.length = 0
      assert(await renderCape(image,100,160))
      assert.deepEqual(draws[1].slice(1), [scale,scale,10*scale,16*scale,0,0,100,160])
    }
    assert.equal(await renderCape({ width:32,height:32 } as HTMLImageElement), '')
  } finally { if (original) Object.defineProperty(globalThis,'document',original); else Reflect.deleteProperty(globalThis,'document') }
})

async function skinsFixture(api: Record<string, unknown>) {
  const bundle = await build({ entryPoints:['src/renderer/src/views/SkinsView.vue'], bundle:true, write:false,
    platform:'node', format:'cjs', packages:'external', plugins:[{ name:'cape-view', setup(builder) {
      builder.onResolve({ filter:/^\.\.\/(api|store|skin-render)$/ }, args => ({ path:args.path.split('/').at(-1)!, external:true }))
      builder.onLoad({ filter:/\.vue$/ }, args => {
        if (!args.path.endsWith('SkinsView.vue')) return { contents:'export default {}', loader:'js' }
        const { descriptor } = parse(fs.readFileSync(args.path,'utf8'))
        return { contents:compileScript(descriptor,{ id:args.path }).content, loader:'ts', resolveDir:path.dirname(args.path) }
      })
    } }] })
  const store = vue.reactive({ selectedAccount:{ id:'account-A',type:'microsoft' } }), notices:string[] = []
  const require = createRequire(path.resolve('package.json')), mod = { exports:{} as any }
  new Function('require','module','exports',bundle.outputFiles[0].text)((name:string) => name === 'vue'
    ? { ...vue,onMounted(){},onUnmounted(){} } : name === 'store' ? { store,toast:(message:string) => notices.push(message) }
      : name === 'api' ? { ...api,errText:String } : name === 'skin-render'
        ? { renderCape:async (url:string) => url.includes('bad') ? '' : 'thumbnail:' + url } : require(name),mod,mod.exports)
  const scope = vue.effectScope(), state = scope.run(() => mod.exports.default.setup({}, { expose(){} }))
  return { state,store,notices,scope }
}
const flush = async () => { await vue.nextTick(); await Promise.resolve(); await vue.nextTick() }

test('actual SkinsView setup regenerates capes after activation and exposes individual failures plus real refresh', async () => {
  const initial:ProfileSkins = { username:'fixture',skins:[],capes:[{ id:'p',alias:'Pan',active:false,dataUrl:'good' },
    { id:'a',alias:'Aurora',active:true,textureError:'HTTP 503，请刷新重试' },{ id:'h',alias:'Hero',active:false,dataUrl:'bad' }] }
  const changed = structuredClone(initial); changed.capes[1].dataUrl = 'recovered'; delete changed.capes[1].textureError
  const refreshes:boolean[] = []
  const fixture = await skinsFixture({ getSkinProfile:async (refresh:boolean) => { refreshes.push(refresh); return initial },
    changeCape:async () => changed })
  try {
    await fixture.state.loadProfile(); await flush()
    assert.equal(fixture.state.capeRenders.value.p,'thumbnail:good')
    assert.match(fixture.state.capeErrors.value.a,/HTTP 503/); assert.match(fixture.state.capeErrors.value.h,/无法加载/)
    await fixture.state.onCapeClick(initial.capes[1]); await flush()
    assert.equal(fixture.state.activeCape.value,'recovered'); assert.equal(fixture.state.capeRenders.value.a,'thumbnail:recovered')
    assert.equal(fixture.state.capeErrors.value.a,undefined)
    await fixture.state.loadProfile(true); await flush(); assert.deepEqual(refreshes,[false,true])
  } finally { fixture.scope.stop() }
})

test('cape activation response cannot replace a different selected account or its thumbnail/error state', async () => {
  let resolve!: (profile:ProfileSkins) => void
  const old:ProfileSkins = { username:'old',skins:[],capes:[{ id:'a',alias:'Aurora',active:false,dataUrl:'old' }] }
  const current:ProfileSkins = { username:'current',skins:[],capes:[{ id:'p',alias:'Pan',active:true,dataUrl:'new' }] }
  const fixture = await skinsFixture({ changeCape:() => new Promise(done => { resolve = done as typeof resolve }),getSkinProfile:async () => current })
  try {
    fixture.state.profile.value = old; await flush()
    const activation = fixture.state.onCapeClick(old.capes[0])
    fixture.store.selectedAccount = { id:'account-B',type:'microsoft' }; await flush()
    resolve(old); await activation; await flush()
    assert.equal(fixture.state.profile.value.username,'current'); assert.equal(fixture.state.capeRenders.value.p,'thumbnail:new')
    assert.equal(fixture.state.capeRenders.value.a,undefined); assert.equal(fixture.notices.length,0)
  } finally { fixture.scope.stop() }
})
