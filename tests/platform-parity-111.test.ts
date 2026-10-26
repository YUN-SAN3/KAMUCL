import test from 'node:test'
import assert from 'node:assert/strict'
import { productPlatform, minecraftRuleOs, requireDesktopGamePlatform, updateArtifactName, platformInfo } from '../src/shared/platform'
import { gameJavaArchitecture } from '../src/main/core/javaArchitecture'
import { nativeLibraryForHost, assertNativeElf, resolveNativeIntegrity } from '../src/main/core/platformNatives'
import { ruleArchitectureMatches } from '../src/main/core/versions'

test('HarmonyOS has a distinct ABI and cannot select a Linux JVM or update payload', () => {
  assert.equal(productPlatform('openharmony'), 'harmonyos')
  assert.equal(minecraftRuleOs('openharmony'), 'unsupported')
  assert.throws(() => requireDesktopGamePlatform('openharmony'), /尚未验证/)
  assert.throws(() => updateArtifactName('1.1.11', 'openharmony', 'arm64', 'hap'), /尚未验证/)
  assert.equal(platformInfo('openharmony', 'arm64', 'hap').nativeGameRuntime, 'requires-verification')
  for (const platform of ['win32', 'darwin', 'linux']) assert.doesNotThrow(() => requireDesktopGamePlatform(platform))
})

test('Linux updates preserve CPU architecture and actual installation form', () => {
  for (const arch of ['x64', 'arm64']) {
    assert.equal(updateArtifactName('1.1.11', 'linux', arch, 'appimage'), `KAMUCL-1.1.11-linux-${arch}.AppImage`)
    assert.equal(updateArtifactName('1.1.11', 'linux', arch, 'deb'), `KAMUCL-1.1.11-linux-${arch}.deb`)
    assert.equal(updateArtifactName('1.1.11', 'linux', arch, 'portable-directory'), `KAMUCL-1.1.11-linux-${arch}.tar.gz`)
    assert.equal(updateArtifactName('1.1.11', 'darwin', arch, 'mac-app'), `KAMUCL-1.1.11-mac-${arch}.zip`)
  }
  assert.throws(() => updateArtifactName('1.1.11', 'linux', 'ia32', 'deb'), /架构/)
  assert.equal(platformInfo('linux', 'arm64', 'deb').systemMemoryOrganizing, false)
  assert.equal(platformInfo('win32', 'x64', 'portable-exe').systemMemoryOrganizing, true)
})

test('JVM selection constrains Linux/Windows CPUs and retains verified Mac legacy strategy', () => {
  const old = { id: '1.12.2', libraries: [{ natives: { osx: 'natives-osx' } }] }
  assert.equal(gameJavaArchitecture(old, 'linux', 'arm64'), 'arm64')
  assert.equal(gameJavaArchitecture(old, 'linux', 'x64'), 'x64')
  assert.equal(gameJavaArchitecture(old, 'win32', 'x64'), 'x64')
  assert.equal(gameJavaArchitecture(old, 'darwin', 'arm64'), 'x64')
  assert.equal(gameJavaArchitecture(old, 'openharmony', 'arm64'), undefined)
  assert(ruleArchitectureMatches('x86_64|amd64', 'x64'))
  assert(ruleArchitectureMatches('aarch64', 'arm64'))
  assert(!ruleArchitectureMatches('x86', 'x64'))
  assert(!ruleArchitectureMatches('[', 'arm64'))
})

test('Linux ARM64 maps only trusted same-version LWJGL and does not modify shared instance metadata', () => {
  const library = { name: 'org.lwjgl:lwjgl-glfw:3.3.1:natives-linux', downloads: { artifact: { path: 'original.jar', url: 'https://libraries.minecraft.net/original.jar', sha1: 'a'.repeat(40) } } }
  const native = nativeLibraryForHost(library, 'linux', 'arm64')
  assert.equal(native.name, 'org.lwjgl:lwjgl-glfw:3.3.1:natives-linux-arm64')
  assert.equal(native.downloads!.artifact!.url, 'https://repo.maven.apache.org/maven2/org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-linux-arm64.jar')
  assert.equal(native.nativeChecksumUrl, native.downloads!.artifact!.url + '.sha1')
  assert.equal(library.downloads.artifact.path, 'original.jar')
  assert.equal(nativeLibraryForHost(library, 'linux', 'x64'), library)
  assert.equal(nativeLibraryForHost(library, 'openharmony', 'arm64'), library)
  assert.throws(() => nativeLibraryForHost({ name: 'org.lwjgl.lwjgl:lwjgl:2.9.4', natives: { linux: 'natives-linux' } }, 'linux', 'arm64'), /未提供已验证/)
  assert.throws(() => nativeLibraryForHost({ name: 'custom:unknown:1.0:natives-linux' }, 'linux', 'arm64'), /未提供已验证/)
})

test('Generated native classifiers cannot skip official hashes or use a forged metadata host', async () => {
  await assert.rejects(() => resolveNativeIntegrity({ url: 'https://example.com/a.jar', nativeChecksumUrl: 'https://example.com/a.jar.sha1' }), /来源无效/)
  const official = 'https://repo.maven.apache.org/maven2/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-linux-arm64.jar'
  await assert.rejects(() => resolveNativeIntegrity({ url: official + '?other', nativeChecksumUrl: official + '.sha1' }), /来源无效/)
})

test('Native game validation reads the actual ELF class and machine', () => {
  const elf = Buffer.alloc(64)
  elf.write('\x7fELF', 'ascii'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(183, 18)
  assert.doesNotThrow(() => assertNativeElf(elf, 'arm64', 'renamed.so'))
  assert.throws(() => assertNativeElf(elf, 'x64', 'renamed.so'), /架构不匹配/)
  elf.writeUInt16LE(62, 18)
  assert.doesNotThrow(() => assertNativeElf(elf, 'x64', 'actual.so'))
  elf[4] = 1
  assert.throws(() => assertNativeElf(elf, 'x64', 'actual.so'), /64 位/)
  assert.throws(() => assertNativeElf(Buffer.from('not elf'), 'arm64', 'fake.so'), /有效 ELF/)
})
