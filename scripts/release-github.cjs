#!/usr/bin/env node
/**
 * GitHub Release 发版脚本：
 * 1. 计算 release/KAMUCL-<v>.exe 与 zip 的 SHA256，生成 SHA256SUMS.txt
 * 2. 用 gh CLI 创建 tag + Release（tag v<x.y.z>，body 取内置更新日志对应版本条目）
 * 3. 上传 3 个 Asset（exe / zip / SHA256SUMS.txt）
 *
 * 前置：gh CLI 已登录（gh auth login），或 GITHUB_TOKEN 环境变量。
 * 用法：node scripts/release-github.cjs [--dry-run]
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const version = pkg.version
const tag = `v${version}`
const dryRun = process.argv.includes('--dry-run')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function latestNoteBody() {
  // 从内置更新日志取当前版本条目作为 Release body
  const src = fs.readFileSync(path.join(root, 'src/shared/updateNotes.ts'), 'utf-8')
  const m = src.match(new RegExp(`version: '${version.replace(/\./g, '\\.')}'[^\\[]*\\[([\\s\\S]*?)\\] \\}`))
  if (!m) return `KAMUCL ${tag}`
  const items = [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"))
  return [`KAMUCL ${tag}`, '', ...items.map((i) => `- ${i}`)].join('\n')
}

const exe = path.join(root, 'release', `KAMUCL-${version}.exe`)
const zip = path.join(root, 'release', `KAMUCL-${version}-windows-x64.zip`)
for (const f of [exe, zip]) {
  if (!fs.existsSync(f)) {
    console.error(`缺少构建产物：${f}（先运行打包）`)
    process.exit(1)
  }
}
const sums = [`${sha256(exe)}  ${path.basename(exe)}`, `${sha256(zip)}  ${path.basename(zip)}`].join('\n') + '\n'
const sumsFile = path.join(root, 'release', 'SHA256SUMS.txt')
fs.writeFileSync(sumsFile, sums, 'utf-8')
console.log('SHA256SUMS.txt:')
console.log(sums)

const body = latestNoteBody()
if (dryRun) {
  console.log('--- dry run，以下为 Release body ---')
  console.log(body)
  process.exit(0)
}

const args = [
  'release', 'create', tag,
  '--repo', 'kamubaba-i/KAMUCL',
  '--title', `KAMUCL ${tag}`,
  '--notes', body,
  exe, zip, sumsFile
]
console.log('gh', args.slice(0, 4).join(' '), '…')
execFileSync('gh', args, { stdio: 'inherit' })
console.log(`Release ${tag} 创建完成`)
