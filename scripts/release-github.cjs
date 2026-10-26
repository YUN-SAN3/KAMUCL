#!/usr/bin/env node
/**
 * GitHub Release 发版脚本：
 * 1. 计算 EXE、紧凑/兼容 ZIP 与源码包的 SHA256，生成 SHA256SUMS.txt
 * 2. 创建 tag + Release（body 取内置更新日志对应版本条目）
 * 3. 上传并验证全部附件后公开 Release
 *
 * 认证优先级：GITHUB_TOKEN 环境变量 → gh CLI → git 凭据管理器（推送用的凭据）。
 * 用法：node scripts/release-github.cjs [--platform all|windows|desktop] [--dry-run] [--notes-file reviewed.md]
 */
const fs = require('node:fs')
const { parseReleaseArgs, releaseAssetNames, assertUniqueAssetNames, assertRemotePlatformScope } = require('./release-platform-assets.cjs')
// Reject invalid/ambiguous scope before writing checksums or creating remote state.
const options = parseReleaseArgs(process.argv.slice(2))
require('./check-licenses.cjs').checkLicenses({ release: true })
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const REPO = 'kamubaba-i/KAMUCL'
const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const version = pkg.version
const tag = `v${version}`
const dryRun = options.dryRun

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function latestNoteBody() {
  const src = fs.readFileSync(path.join(root, 'src/shared/updateNotes.ts'), 'utf-8')
  // Read the same trusted data module as the app; quote style and brackets in notes are irrelevant.
  const compiled = require('esbuild').transformSync(src, { loader: 'ts', format: 'cjs' }).code
  const notesModule = { exports: {} }
  new Function('module', 'exports', compiled)(notesModule, notesModule.exports)
  const note = notesModule.exports.updateNotes.find(n => n.version === version)
  if (!note?.changes?.length || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(note.date)) throw new Error('当前版本缺少完整更新日志或分钟时间，停止发布')
  return [`KAMUCL ${tag}`, note.date + '（UTC+8）', '', ...note.changes.map(i => `- ${i}`)].join('\n')
}

/** 从 git 凭据管理器取 GitHub 令牌（推送同款凭据） */
function tokenFromGitCredential() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n', encoding: 'utf-8' })
    const m = /^password=(.+)$/m.exec(out)
    return m?.[1]?.trim() || null
  } catch {
    return null
  }
}

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' })
    const t = execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' }).trim()
    if (t) return t
  } catch { /* gh 不可用 */ }
  return tokenFromGitCredential()
}

async function api(method, url, token, body, isBinary = false) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'KAMUCL-Release-Script',
          ...(isBinary ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {})
        },
        body: isBinary ? body : body ? JSON.stringify(body) : undefined
      })
      return res
    } catch (e) {
      lastErr = e
      console.warn(`请求失败（第 ${attempt + 1} 次）：${e.message}，2s 后重试`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw lastErr
}

async function taggedCommit(token) {
  const response = await api('GET', `https://api.github.com/repos/${REPO}/git/ref/tags/${tag}`, token)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`无法核对远端标签：HTTP ${response.status}`)
  let object = (await response.json()).object
  for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) {
    const annotated = await api('GET', `https://api.github.com/repos/${REPO}/git/tags/${object.sha}`, token)
    if (!annotated.ok) throw new Error(`无法读取注释标签：HTTP ${annotated.status}`)
    object = (await annotated.json()).object
  }
  if (object?.type !== 'commit') throw new Error('版本标签未指向提交')
  return object.sha
}

async function main() {
  if (!dryRun && options.platform !== 'windows') require('./platform-release-gate.cjs').verifyPlatformRelease(root, version)
  const packages = releaseAssetNames(version, options.platform).map(name => path.join(root, 'release', name))
  packages.push(...require('./release-history-assets.cjs')(path.join(root, 'release'), version))
  assertUniqueAssetNames([...packages.map(file => path.basename(file)), 'SHA256SUMS.txt'])
  for (const f of packages) {
    if (!fs.existsSync(f)) {
      console.error(`缺少构建产物：${f}（先运行打包）`)
      process.exit(1)
    }
    if (fs.statSync(f).size >= 2_000_000_000) throw new Error('附件超过保守的单文件大小上限：' + path.basename(f))
  }
  const sums = packages.map(file => `${sha256(file)}  ${path.basename(file)}`).join('\n') + '\n'
  const sumsFile = path.join(root, 'release', 'SHA256SUMS.txt')
  fs.writeFileSync(sumsFile, sums, 'utf-8')
  console.log('SHA256SUMS.txt:\n' + sums)

  const notesPath = options.notesPath
  const body = notesPath ? fs.readFileSync(path.resolve(root, notesPath), 'utf8') : latestNoteBody()
  if (!body.trim()) throw new Error('Release 说明为空，停止发布')
  if (dryRun) {
    if (options.platform !== 'windows') console.log('Preview only: native platform acceptance has not been inferred or granted by this dry run.')
    console.log('Release platform: ' + options.platform)
    console.log('--- dry run，Release body ---')
    console.log(body)
    return
  }

  const token = resolveToken()
  if (!token) {
    console.error('无可用 GitHub 认证（GITHUB_TOKEN / gh / git 凭据均不可用）')
    process.exit(1)
  }

  // Bind both draft creation and publication to the reviewed master commit.
  // GitHub may otherwise leave a published draft on an untagged-* reference.
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const masterResponse = await api('GET', `https://api.github.com/repos/${REPO}/branches/master`, token)
  if (!masterResponse.ok || (await masterResponse.json()).commit?.sha !== commit) throw new Error('本地 HEAD 尚未同步到 origin/master，停止发布')
  const existingTag = await taggedCommit(token)
  if (existingTag && existingTag !== commit) throw new Error('版本标签已指向其他提交，保留远端标签并停止发布')
  const binding = { tag_name: tag, target_commitish: commit, name: `KAMUCL ${tag}`, body, prerelease: false }

  // 已存在同 tag Release 则复用（幂等）
  let release = null
  const existing = await api('GET', `https://api.github.com/repos/${REPO}/releases/tags/${tag}`, token)
  if (existing.ok) {
    release = await existing.json()
    console.log(`Release ${tag} 已存在（id=${release.id}），直接补传资产`)
  } else if (existing.status === 404) {
    // The by-tag endpoint does not always expose drafts; recover the exact
    // draft by id rather than creating a duplicate after an interrupted upload.
    for (let page = 1; page <= 10 && !release; page++) {
      const response = await api('GET', `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, token)
      if (!response.ok) throw new Error(`无法检查已有草稿：HTTP ${response.status}`)
      const entries = await response.json()
      release = entries.find(entry => entry.tag_name === tag) || null
      if (entries.length < 100) break
    }
  } else {
    throw new Error(`无法检查已有 Release：HTTP ${existing.status}`)
  }
  if (!release) {
    const res = await api('POST', `https://api.github.com/repos/${REPO}/releases`, token, {
      ...binding,
      draft: true,
    })
    if (!res.ok) {
      console.error(`创建 Release 失败：HTTP ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    release = await res.json()
    console.log(`Release ${tag} 创建完成（id=${release.id}）`)
  }

  for (const file of [...packages, sumsFile]) {
    const name = path.basename(file)
    // 重传前先删同名人资产（幂等覆盖）
    const assetResponse = await api('GET', `https://api.github.com/repos/${REPO}/releases/${release.id}/assets`, token)
    if (!assetResponse.ok) throw new Error(`无法检查远端附件：HTTP ${assetResponse.status}`)
    const assets = await assetResponse.json()
    assertRemotePlatformScope(assets, version, options.platform)
    const same = assets.find(a => a.name === name)
    if (same?.size === fs.statSync(file).size && same.digest === `sha256:${sha256(file)}`) {
      console.log(`  ✓ ${name} 已存在且摘要一致`)
      continue
    }
    for (const a of assets ?? []) {
      if (a.name === name) {
        const removed = await api('DELETE', `https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, token)
        if (!removed.ok) throw new Error(`无法替换附件 ${name}：HTTP ${removed.status}`)
      }
    }
    console.log(`上传 ${name}（${(fs.statSync(file).size / 1048576).toFixed(1)} MB）…`)
    const up = await api('POST', `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, token, fs.readFileSync(file), true)
    if (!up.ok) {
      console.error(`上传 ${name} 失败：HTTP ${up.status} ${await up.text()}`)
      process.exit(1)
    }
    console.log(`  ✓ ${name}`)
  }
  const verified = await api('GET', `https://api.github.com/repos/${REPO}/releases/${release.id}/assets`, token)
  if (!verified.ok) throw new Error(`无法核对远端附件：HTTP ${verified.status}`)
  const assets = await verified.json()
  assertRemotePlatformScope(assets, version, options.platform)
  for (const file of [...packages, sumsFile]) {
    const asset = assets.find(a => a.name === path.basename(file))
    if (!asset || asset.size !== fs.statSync(file).size || asset.digest !== `sha256:${sha256(file)}`) {
      throw new Error('远端附件大小或 SHA256 不匹配：' + path.basename(file))
    }
  }
  const published = await api('PATCH', `https://api.github.com/repos/${REPO}/releases/${release.id}`, token, { ...binding, draft: false })
  if (!published.ok) throw new Error(`公开 Release 失败：HTTP ${published.status}`)
  const publicResponse = await api('GET', `https://api.github.com/repos/${REPO}/releases/tags/${tag}`, token)
  if (!publicResponse.ok) throw new Error(`公开标签无法读取：HTTP ${publicResponse.status}`)
  const publicRelease = await publicResponse.json()
  assertRemotePlatformScope(publicRelease.assets, version, options.platform)
  if (publicRelease.id !== release.id || publicRelease.draft || publicRelease.tag_name !== tag || publicRelease.target_commitish !== commit) throw new Error('公开 Release 与已验证标签或 master 提交不一致')
  if (await taggedCommit(token) !== commit) throw new Error('公开版本标签未指向已验证 master 提交')
  console.log(`\n全部附件大小与 SHA256 已核对，发布完成：https://github.com/${REPO}/releases/tag/${tag}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
