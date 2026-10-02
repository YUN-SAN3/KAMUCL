import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createJavaRuntimeValidator, GAME_JAVA_MODULES, missingGameModules } from '../src/main/core/javaRuntimeHealth'

test('Java module checks reject trimmed desktop runtimes without requiring JDK compiler modules', () => {
  const full = GAME_JAVA_MODULES.map(m => `${m}@25.0.1`).join('\r\n')
  assert.deepEqual(missingGameModules(full, 25), [])
  assert.deepEqual(missingGameModules(full.replace('java.desktop@25.0.1', ''), 25), ['java.desktop'])
  assert(missingGameModules('java.base@25', 25).includes('jdk.unsupported'))
})
test('selected Java health validates files, modules and graph; changes invalidate successful cache', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'kamucl-java-health-'))
  const exe = path.join(home, 'bin/java')
  const jvm = path.join(home, process.platform === 'win32' ? 'bin/server/jvm.dll' : process.platform === 'darwin' ? 'lib/server/libjvm.dylib' : 'lib/server/libjvm.so')
  const modules = path.join(home, 'lib/modules')
  for (const file of [exe, jvm, modules]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'fixture') }
  let calls = 0, trimmed = false, invalid = false
  const check = createJavaRuntimeValidator(async (_exe, args) => {
    calls++
    if (args[0] === '--list-modules') return (trimmed ? ['java.base'] : GAME_JAVA_MODULES).join('\n')
    if (invalid) throw new Error('invalid module graph')
    return ''
  })
  try {
    await check(exe, 25); await check(exe, 25); assert.equal(calls, 2)
    trimmed = true; await fs.appendFile(modules, 'changed')
    await assert.rejects(check(exe, 25), /精简运行环境/)
    trimmed = false; invalid = true
    await assert.rejects(check(exe, 25), /invalid module graph/)
    invalid = false; await check(exe, 25)
    await fs.unlink(jvm); await assert.rejects(check(exe, 25), /不完整/)
  } finally { await fs.rm(home, { recursive: true, force: true }) }
})

test('SunEC moved into java.base in Java 22: do not reject complete Azul JREs without the empty compatibility module', () => {
  const modules = GAME_JAVA_MODULES.join('\n')
  assert.deepEqual(missingGameModules(modules, 21), ['jdk.crypto.ec'])
  assert.deepEqual(missingGameModules(modules, 22), [])
  assert.deepEqual(missingGameModules(modules, 25), [])
  assert.deepEqual(missingGameModules(modules + '\njdk.crypto.ec', 21), [])
})
