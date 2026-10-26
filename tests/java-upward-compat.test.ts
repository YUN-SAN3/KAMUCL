import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { selectJavaByMajor, requiredMajor } from '../src/main/core/java'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const j = (major: number, is64Bit = true) => ({ major, is64Bit, path: `C:/Java/jdk-${major}/bin/java.exe`, version: String(major) })

test('Java automatic selection requires the recommended major and never chooses arbitrary higher JVMs', () => {
  const system = [j(8), j(17), j(21), j(25)]
  // 精确匹配优先
  assert.equal(selectJavaByMajor(system, 17)?.major, 17)
  assert.equal(selectJavaByMajor([j(21)], 17), null)
  assert.equal(selectJavaByMajor([j(8), j(21), j(25)], 17), null)
  assert.equal(selectJavaByMajor([j(21), j(25)], 8), null)
  // 32 位不满足
  assert.equal(selectJavaByMajor([{ ...j(21), is64Bit: false }], 17), null)
  // 全部低于需求 → null（触发下载）
  assert.equal(selectJavaByMajor([j(8)], 17), null)
  // 空系统 → null
  assert.equal(selectJavaByMajor([], 8), null)
})

test('known release Java requirements include 26.1 Java 25; unknown snapshots and custom profiles do not default to 21', () => {
  const v = (id: string) => ({ id }) as any
  assert.equal(requiredMajor(v('1.8.9')), 8)
  assert.equal(requiredMajor(v('1.12.2')), 8)
  assert.equal(requiredMajor(v('1.16.5')), 8)
  assert.equal(requiredMajor(v('1.17')), 16)
  assert.equal(requiredMajor(v('1.17.1')), 16)
  assert.equal(requiredMajor(v('1.18')), 17)
  assert.equal(requiredMajor(v('1.20.1')), 17)
  assert.equal(requiredMajor(v('1.20.4')), 17)
  assert.equal(requiredMajor(v('1.20.5')), 21)
  assert.equal(requiredMajor(v('1.21.1')), 21)
  assert.equal(requiredMajor(v('26.1')), 25)
  assert.throws(() => requiredMajor(v('26.2')), /无法确认/)
  assert.throws(() => requiredMajor(v('24w14a')), /无法确认/)
  assert.throws(() => requiredMajor(v('my-custom-pack')), /无法确认/)
  // json 声明优先
  assert.equal(requiredMajor({ id: 'x', javaVersion: { majorVersion: 25 } } as any), 25)
})

test('launch, installer repair and diagnostics share the compatibility resolver', () => {
  const java = read('src/main/core/java.ts')
  assert.match(java, /prepareCompatibleJava/)
  assert.match(read('src/main/core/launch.ts'), /resolveJavaRequirement\(merged, instanceMcVersion/)
  assert.match(read('src/main/core/instanceDiagnostics.ts'), /resolveJavaRequirement\(merged/)
  assert.match(read('src/main/core/loaders.ts'), /ensureJava\(baseJson, emit, mc\)/)
  assert(!java.includes('向上兼容选用'), 'automatic selection must not claim all higher JVMs are compatible')
})
