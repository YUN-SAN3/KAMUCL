import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { selectJavaByMajor, requiredMajor } from '../src/main/core/java'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const j = (major: number, is64Bit = true) => ({ major, is64Bit, path: `C:/Java/jdk-${major}/bin/java.exe`, version: String(major) })

test('Java selection: minimum version + upward compatibility, prefer exact else highest available', () => {
  const system = [j(8), j(17), j(21), j(25)]
  // 精确匹配优先
  assert.equal(selectJavaByMajor(system, 17)?.major, 17)
  // 仅装 Java 21 无 Java 17：1.20.1（需 17）向上兼容选 21——用户报告场景
  assert.equal(selectJavaByMajor([j(21)], 17)?.major, 21)
  // 无精确时取满足条件的最高版本
  assert.equal(selectJavaByMajor([j(8), j(21), j(25)], 17)?.major, 25)
  // 32 位不满足
  assert.equal(selectJavaByMajor([{ ...j(21), is64Bit: false }], 17), null)
  // 全部低于需求 → null（触发下载）
  assert.equal(selectJavaByMajor([j(8)], 17), null)
  // 空系统 → null
  assert.equal(selectJavaByMajor([], 8), null)
})

test('required major per MC version band: 1.8-1.16.5→8, 1.17→16, 1.18-1.20.4→17, 1.20.5+→21, 26.x/snapshot→21', () => {
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
  assert.equal(requiredMajor(v('26.2')), 21, '26.x new scheme must not fall through to 8')
  assert.equal(requiredMajor(v('24w14a')), 21, 'snapshot must not fall through to 8')
  // json 声明优先
  assert.equal(requiredMajor({ id: 'x', javaVersion: { majorVersion: 25 } } as any), 25)
})

test('download prompt wording says "Java N or higher", actual pick is logged with path and version', () => {
  const java = read('src/main/core/java.ts')
  assert.match(java, /或更高版本/)
  assert.match(java, /selectJavaByMajor/)
  // 日志记录实际选用的路径与版本
  assert.match(java, /向上兼容选用 Java \$\{local\.major\}（\$\{local\.version\}，64位）：\$\{local\.path\}/)
  // 不再精确匹配
  assert(!java.includes('j.major === need && j.is64Bit'), 'exact-match-only logic must be gone')
})
