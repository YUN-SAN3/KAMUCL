import test from 'node:test'
import assert from 'node:assert/strict'
import { macJavaArchitecture } from '../src/main/core/javaArchitecture'
import { selectJavaByMajor } from '../src/main/core/java'
import { javaHomeExecutable } from '../src/main/core/javaScanUtils'

test('macOS JVM selection distinguishes native architectures and legacy Intel natives', () => {
  const modern = { id: '1.21.11', libraries: [{ name: 'org.lwjgl:lwjgl:3.3.3:natives-macos' }, { name: 'org.lwjgl:lwjgl:3.3.3:natives-macos-arm64' }] }
  const legacy = { id: '1.12.2', libraries: [{ natives: { osx: 'natives-osx' } }] }
  assert.equal(macJavaArchitecture(modern, 'darwin', 'arm64'), 'arm64')
  assert.equal(macJavaArchitecture(modern, 'darwin', 'x64'), 'x64')
  assert.equal(macJavaArchitecture(legacy, 'darwin', 'arm64'), 'x64')
  assert.equal(macJavaArchitecture(legacy, 'win32', 'x64'), undefined)
  const installed = [
    { major: 21, is64Bit: true, architecture: 'x64' },
    { major: 25, is64Bit: true, architecture: 'arm64' },
    { major: 21, is64Bit: true, architecture: 'arm64' }
  ]
  assert.equal(selectJavaByMajor(installed, 21, 'arm64'), installed[2])
  assert.equal(selectJavaByMajor(installed, 21, 'x64'), installed[0])
  assert.equal(selectJavaByMajor(installed.slice(0, 1), 21, 'arm64'), null)
  assert.equal(javaHomeExecutable('java.home = /Users/测试用户/Library/Application Support/.kamucl/runtimes/jre-21/Contents/Home', 'darwin'), '/Users/测试用户/Library/Application Support/.kamucl/runtimes/jre-21/Contents/Home/bin/java')
})
