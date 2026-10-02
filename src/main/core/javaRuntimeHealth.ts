import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'

// Minecraft, LWJGL and supported loaders need these modules even when -version works.
export const GAME_JAVA_MODULES = ['java.base', 'java.desktop', 'java.logging', 'java.management', 'java.naming', 'java.instrument', 'java.sql', 'jdk.unsupported', 'jdk.zipfs']
export function missingGameModules(output: string, major: number): string[] {
  const modules = new Set(output.split(/\r?\n/).map(line => line.trim().split('@')[0]))
  // Since JDK 22 SunEC lives in java.base; jdk.crypto.ec is only an optional empty compatibility module.
  // https://www.oracle.com/java/technologies/javase/22-relnote-issues.html#JDK-8308398
  const required = major < 22 ? [...GAME_JAVA_MODULES, 'jdk.crypto.ec'] : GAME_JAVA_MODULES
  return required.filter(name => !modules.has(name))
}
async function stamp(file: string): Promise<string> {
  const stat = await fs.stat(file)
  if (!stat.isFile() || !stat.size) throw new Error(`Java 运行环境文件缺失或为空：${file}`)
  return `${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
}
function run(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(exe, args, { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`Java 运行环境检查失败：${String(stderr || error.message).slice(0, 1000)}`))
    else resolve(stdout)
  }))
}
/** Validate only the selected runtime; cache against its actual files, not the scan's version cache. */
export function createJavaRuntimeValidator(probe: typeof run = run) {
  const checks = new Map<string, Promise<void>>()
  return async function validateJavaRuntime(exe: string, major: number): Promise<void> {
   const actual = await fs.realpath(exe)
   const home = path.dirname(path.dirname(actual))
   const image = major >= 9 ? path.join(home, 'lib/modules') : path.join(home, 'lib/rt.jar')
   const candidates = process.platform === 'win32'
     ? ['bin/server/jvm.dll', 'jre/bin/server/jvm.dll']
     : process.platform === 'darwin' ? ['lib/server/libjvm.dylib', 'jre/lib/server/libjvm.dylib']
       : ['lib/server/libjvm.so', 'lib/amd64/server/libjvm.so', 'jre/lib/amd64/server/libjvm.so', 'lib/aarch64/server/libjvm.so', 'jre/lib/aarch64/server/libjvm.so']
   const images = major >= 9 ? [image] : [image, path.join(home, 'jre/lib/rt.jar')]
   const firstStamp = async (files: string[]) => {
     for (const file of files) { try { return await stamp(file) } catch {} }
     throw new Error(`Java 运行环境不完整：缺少 ${files.map(f => path.relative(home, f)).join(' / ')}。请选择完整 Java 或开启自动管理。`)
   }
   const key = [major, await stamp(actual), await firstStamp(images), await firstStamp(candidates.map(f => path.join(home, f)))].join('|')
   let check = checks.get(key)
   if (!check) {
     check = (async () => {
       if (major >= 9) {
         const missing = missingGameModules(await probe(actual, ['--list-modules']), major)
         if (missing.length) throw new Error(`Java 为精简运行环境，缺少游戏所需模块：${missing.join('、')}。请选择完整 Java 或开启自动管理。`)
         await probe(actual, ['--validate-modules'])
       } else {
         // Java 8 has no module system; force VM startup in addition to checking rt.jar/JVM files.
         await probe(actual, ['-version'])
       }
     })()
     if (checks.size >= 32) checks.clear()
     checks.set(key, check)
     check.catch(() => checks.delete(key))
   }
   await check
 }
 
}
export const validateJavaRuntime = createJavaRuntimeValidator()
