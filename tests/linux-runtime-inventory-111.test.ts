import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const { assertLinuxElectronFiles, LINUX_ELECTRON_FILES, assertObservedLinuxRuntime } = createRequire(path.resolve('package.json'))('./scripts/verify-linux-runtime.cjs')
function fixture(arch: 'x64' | 'arm64') {
  const header = Buffer.alloc(64)
  header.write('\x7fELF', 'binary'); header[4] = 2; header[5] = 1; header.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18)
  const entries: Record<string, { size: number; mode: number; isFile: boolean; isSymbolicLink: boolean; data: Buffer }> = {}
  for (const name of LINUX_ELECTRON_FILES) entries[name] = { size: 64, mode: 0o100755, isFile: true, isSymbolicLink: false, data: Buffer.from(header) }
  entries['vk_swiftshader_icd.json'].data = Buffer.from(JSON.stringify({ file_format_version: '1.0.0', ICD: { library_path: './libvk_swiftshader.so', api_version: '1.0.5' } }))
  return entries
}

test('Linux pinned runtime inventory requires the actual codec, sandbox, Vulkan and data payload on both ABIs', () => {
  for (const arch of ['x64', 'arm64'] as const) {
    assert.doesNotThrow(() => assertLinuxElectronFiles(fixture(arch), arch, '44.3.0'))
    for (const name of LINUX_ELECTRON_FILES) {
      const missing = fixture(arch); delete missing[name]
      assert.throws(() => assertLinuxElectronFiles(missing, arch, '44.3.0'), /Missing or unsafe runtime/)
      const empty = fixture(arch); empty[name].size = 0
      assert.throws(() => assertLinuxElectronFiles(empty, arch, '44.3.0'), /Missing or unsafe runtime/)
    }
    const wrong = fixture(arch); wrong['libvk_swiftshader.so'].data.writeUInt16LE(arch === 'arm64' ? 62 : 183, 18)
    assert.throws(() => assertLinuxElectronFiles(wrong, arch, '44.3.0'), /Wrong Linux architecture/)
    const notExecutable = fixture(arch); notExecutable['chrome-sandbox'].mode = 0o100644
    assert.throws(() => assertLinuxElectronFiles(notExecutable, arch, '44.3.0'), /not executable/)
    const linked = fixture(arch); linked['libvulkan.so.1'].isSymbolicLink = true
    assert.throws(() => assertLinuxElectronFiles(linked, arch, '44.3.0'), /unsafe runtime/)
    const truncated = fixture(arch); truncated['libffmpeg.so'].data = Buffer.alloc(8)
    assert.throws(() => assertLinuxElectronFiles(truncated, arch, '44.3.0'), /Truncated runtime ELF/)
    const invalid = fixture(arch); invalid['libffmpeg.so'].data.fill(0)
    assert.throws(() => assertLinuxElectronFiles(invalid, arch, '44.3.0'), /Invalid runtime ELF/)
    const narrow = fixture(arch); narrow['kamucl'].data[4] = 1
    assert.throws(() => assertLinuxElectronFiles(narrow, arch, '44.3.0'), /64-bit/)
    const endian = fixture(arch); endian['libvulkan.so.1'].data[5] = 2
    assert.throws(() => assertLinuxElectronFiles(endian, arch, '44.3.0'), /little-endian/)
    const unrenamedLicense = fixture(arch); unrenamedLicense.LICENSE = unrenamedLicense['LICENSE.electron.txt']; delete unrenamedLicense['LICENSE.electron.txt']
    assert.throws(() => assertLinuxElectronFiles(unrenamedLicense, arch, '44.3.0'), /LICENSE\.electron\.txt/)
  }
  assert.throws(() => assertLinuxElectronFiles(fixture('x64'), 'x64', '45.0.0'), /Review the official Linux runtime inventory/)
  assert.throws(() => assertLinuxElectronFiles(fixture('x64'), 'ia32', '44.3.0'), /Unsupported Linux architecture/)
})

test('Linux Vulkan ICD cannot escape or select an unbundled graphics library', () => {
  for (const target of ['../libvk_swiftshader.so', '/usr/lib/libvk_swiftshader.so', './libEGL.so', 'https://example.invalid/lib.so']) {
    const files = fixture('x64')
    files['vk_swiftshader_icd.json'].data = Buffer.from(JSON.stringify({ file_format_version: '1.0.0', ICD: { library_path: target, api_version: '1.0.5' } }))
    assert.throws(() => assertLinuxElectronFiles(files, 'x64', '44.3.0'), /bundled library/)
  }
})

test('Linux package runtime identity rejects mismatched or missing actual executable observations', () => {
  // Parsed process output fixtures exercise rejection; they are not native runs.
  assert.deepEqual(assertObservedLinuxRuntime('{"platform":"linux","arch":"arm64","electron":"44.3.0"}', 'arm64'), { platform: 'linux', arch: 'arm64', electron: '44.3.0' })
  for (const raw of ['{"platform":"win32","arch":"arm64","electron":"44.3.0"}', '{"platform":"linux","arch":"x64","electron":"44.3.0"}', '{"platform":"linux","arch":"arm64","electron":"43.0.0"}', '{"platform":"linux","arch":"arm64"}', 'not executable JSON']) assert.throws(() => assertObservedLinuxRuntime(raw, 'arm64'))
  assert.throws(() => assertObservedLinuxRuntime('{"platform":"linux","arch":"ia32","electron":"44.3.0"}', 'ia32'), /Unsupported Linux architecture/)
})
