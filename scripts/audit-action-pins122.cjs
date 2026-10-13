/* Resolve public official action refs only. No repository token is used. */
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
const { fetch, ProxyAgent } = require('undici')
const actionRepos = ['checkout', 'setup-node', 'setup-java', 'upload-artifact', 'download-artifact', 'github-script']
const root = path.resolve(__dirname, '..')
async function main() {
  const dispatcher = new ProxyAgent('http://127.0.0.1:7897'), evidence = []
  try {
    for (const name of actionRepos) {
      const tag = name === 'github-script' ? 'v7' : 'v4', repository = `actions/${name}`
      const rows = execFileSync('git', ['-c', 'http.proxy=http://127.0.0.1:7897', 'ls-remote', `https://github.com/${repository}.git`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8', windowsHide: true }).trim().split('\n')
      const raw = rows.find(row => row.endsWith(`refs/tags/${tag}`)), peeled = rows.find(row => row.endsWith(`refs/tags/${tag}^{}`))
      const sha = (peeled || raw)?.split(/\s+/)[0]
      if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('Official Git tag was absent or ambiguous')
      const api = `https://api.github.com/repos/${repository}/git/commits/${sha}`
      const response = await fetch(api, { dispatcher, headers: { 'User-Agent': 'KAMUCL-1.1.22-offline-audit', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) })
      let treeSHA, verification
      if (response.ok) {
        const commit = await response.json()
        if (commit.sha !== sha || !/^[0-9a-f]{40}$/.test(commit.tree?.sha || '')) throw new Error('Official commit verification differs')
        treeSHA = commit.tree.sha; verification = 'Unauthenticated official Git ref and REST commit'
      } else if (response.status === 403 || response.status === 429) {
        await response.body?.cancel()
        // Anonymous API quota is not repaired by borrowing a project credential.
        const temp = fs.mkdtempSync(path.join(root, 'out/action-pin122-'))
        try {
          execFileSync('git', ['init', '--bare', temp], { stdio: 'pipe', windowsHide: true })
          execFileSync('git', ['-C', temp, '-c', 'http.proxy=http://127.0.0.1:7897', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--depth=1', `https://github.com/${repository}.git`, `refs/tags/${tag}`], { stdio: 'pipe', windowsHide: true })
          const resolved = execFileSync('git', ['-C', temp, 'rev-parse', 'FETCH_HEAD^{commit}'], { encoding: 'utf8', windowsHide: true }).trim()
          if (resolved !== sha) throw new Error('Official fetched commit differs from official tag ref')
          treeSHA = execFileSync('git', ['-C', temp, 'rev-parse', 'FETCH_HEAD^{tree}'], { encoding: 'utf8', windowsHide: true }).trim()
          verification = `Unauthenticated official Git ref and fetched commit/tree; anonymous REST status ${response.status} recorded, not treated as success`
        } finally { if (!temp.startsWith(path.join(root, 'out') + path.sep)) throw new Error('Temporary checkout escaped audit root'); fs.rmSync(temp, { recursive: true, force: true }) }
      } else { await response.body?.cancel(); throw new Error(`Official Git commit verification status ${response.status}`) }
      evidence.push({ repository, originalTag: tag, tagRefObject: raw.split(/\s+/)[0], peeledCommit: sha,
        officialGitRemote: `https://github.com/${repository}.git`, officialCommitURL: `https://github.com/${repository}/commit/${sha}`,
        officialAPI: api, officialAPIStatus: response.status, treeSHA, verifiedAtUTC: new Date().toISOString(), method: `${verification}; no discovered project credentials used.` })
    }
    const workflowDir = path.join(root, '.github/workflows'), changes = []
    for (const name of fs.readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name))) {
      const file = path.join(workflowDir, name), before = fs.readFileSync(file, 'utf8')
      let after = before
      for (const row of evidence) after = after.replaceAll(`uses: ${row.repository}@${row.originalTag}`, `uses: ${row.repository}@${row.peeledCommit} # ${row.originalTag}`)
      if (after !== before) { fs.writeFileSync(file, after); changes.push({ path: `.github/workflows/${name}`, changedUses: after.split('\n').filter(line => /uses: actions\/.*@[a-f0-9]{40}/.test(line)).length }) }
    }
    fs.writeFileSync(path.join(root, 'audit-reports/ACTION_PIN_PROVENANCE.json'), JSON.stringify({ schema: 1, evidence, changes,
      constraints: ['No version major, permission, job gate or consumer acceptance rule changed.', 'Only these six verified official repositories were substituted.', 'Historical tags and historical workflow data remain unchanged.'] }, null, 2) + '\n')
    console.log(JSON.stringify({ evidence, changes }, null, 2))
  } finally { await dispatcher.close() }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
