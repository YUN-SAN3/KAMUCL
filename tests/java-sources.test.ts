import test from 'node:test'
import assert from 'node:assert/strict'
import { provisionJava, temurinPackage, zuluPackage, javaPackageSize } from '../src/main/core/javaSources'

const target = { major: 25, os: 'mac' as const, arch: 'x64' as const }
const detail = { java_version: [25, 0, 4], os: 'macos', arch: 'x86', hw_bitness: 64, archive_type: 'tar.gz', java_package_type: 'jre', availability_type: 'CA', download_url: 'https://cdn.azul.com/zulu/bin/runtime.tar.gz', sha256_hash: 'a'.repeat(64), size: 57757700 }
const temurin = [{ version: { major: 25 }, binary: { os: 'mac', architecture: 'x64', image_type: 'jre', package: { link: 'https://github.com/adoptium/temurin25-binaries/releases/download/test/runtime.tar.gz', checksum: 'b'.repeat(64), size: 55500000 } } }]
const list = [{ java_version: [25], availability_type: 'CA', package_uuid: '144bf66e-6734-49cc-8948-8fcac9f6806a' }]
const read = async (url: string) => url.includes('adoptium.net') ? temurin : url.includes('packages/?') ? list : detail

test('Java 25 on Intel Mac falls back after GitHub fetch failure using the backup package own SHA256', async () => {
  const installed: string[] = [], reports: string[] = []
  const result = await provisionJava(target, read, async pkg => {
    installed.push(pkg.provider)
    if (pkg.provider === 'Eclipse Temurin') throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect failed'), { code: 'ECONNRESET' }) })
    assert.equal(pkg.sha256, detail.sha256_hash); assert.equal(pkg.size, undefined)
    return '/verified/Contents/Home/bin/java'
  }, text => reports.push(text))
  assert.deepEqual(installed, ['Eclipse Temurin', 'Azul Zulu'])
  assert.equal(result, '/verified/Contents/Home/bin/java')
  assert(reports.some(text => text.includes('切换备用源')))
})

test('Java metadata failure also falls back; both failures explain that no game was started', async () => {
  const fallback = await provisionJava(target, async url => {
    if (url.includes('adoptium.net')) throw new TypeError('fetch failed')
    return read(url)
  }, async pkg => pkg.provider, () => {})
  assert.equal(fallback, 'Azul Zulu')
  await assert.rejects(provisionJava(target, async () => { throw new TypeError('fetch failed') }, async () => '', () => {}), /Java 25.*mac\/x64.*游戏尚未启动[\s\S]*Adoptium[\s\S]*Azul/)
})

test('Java providers reject mismatched CPU, major, untrusted URLs and absent integrity metadata', async () => {
  await assert.rejects(temurinPackage({ ...target, arch: 'aarch64' }, read), /没有匹配/)
  await assert.rejects(zuluPackage(target, async url => url.includes('packages/?') ? list : { ...detail, arch: 'arm' }), /不匹配/)
  for (const invalid of [{ sha256_hash: '' }, { size: 0 }, { download_url: 'https://example.com/evil.tar.gz' }, { java_version: [21] }]) {
    await assert.rejects(zuluPackage(target, async url => url.includes('packages/?') ? list : { ...detail, ...invalid }))
  }
})

test('cancelled Java provisioning never switches sources or publishes a runtime', async () => {
  const controller = new AbortController(); let calls = 0
  await assert.rejects(provisionJava(target, async url => {
    calls++; controller.abort(new Error('cancelled')); return read(url)
  }, async () => { throw new Error('must not install') }, () => {}, controller.signal), /cancelled/)
  assert.equal(calls, 1)
})

test('Azul rounded metadata size is replaced by binary length; unavailable HEAD retains SHA256 streaming', async () => {
  const pkg = await zuluPackage(target, read)
  assert.equal(pkg.size, undefined)
  assert.equal(await javaPackageSize(pkg, async () => new Response(null, { headers: { 'content-length': '57757736' } })), 57757736)
  assert.equal(await javaPackageSize(pkg, async () => { throw new TypeError('fetch failed') }), undefined)
  assert.equal(pkg.sha256, detail.sha256_hash)
})
