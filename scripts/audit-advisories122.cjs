/* Public npm release metadata only; does not run npm hooks or send source/tokens. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const requests = { 'adm-zip': ['0.6.0', '0.6.1'], undici: ['6.28.0', '6.28.1', '6.29.0'], sharp: ['0.35.4', '0.35.5'], 'source-map-js': ['1.2.1', '1.2.2'], vite: ['5.4.21', '6.4.3'], 'electron-vite': ['2.3.0'], '@vitejs/plugin-vue': ['5.2.4'], 'brace-expansion': ['1.1.21', '2.1.7', '5.0.12'], 'fast-uri': ['3.1.8'], 'http-cache-semantics': ['4.2.1'], 'sprintf-js': ['1.1.4'] }
async function main() {
  const packages = []
  for (const [name, wanted] of Object.entries(requests)) {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`, response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Public npm registry metadata status ${response.status}`)
    const raw = Buffer.from(await response.arrayBuffer()), metadata = JSON.parse(raw)
    packages.push({ name, registry: url, metadataSHA256: crypto.createHash('sha256').update(raw).digest('hex'), latest: metadata['dist-tags']?.latest,
      versions: wanted.map(version => { const v = metadata.versions?.[version]; return v ? { version, exists: true, publishedAtUTC: metadata.time?.[version], repository: v.repository,
        tarball: v.dist?.tarball, integrity: v.dist?.integrity, shasum: v.dist?.shasum, engines: v.engines || null, peerDependencies: v.peerDependencies || null,
        dependencies: v.dependencies || null, optionalDependencies: v.optionalDependencies || null, scripts: Object.fromEntries(Object.entries(v.scripts || {}).filter(([key]) => /^(?:preinstall|install|postinstall|prepare)$/.test(key))) } : { version, exists: false } }) })
  }
  fs.writeFileSync(path.join(root, 'audit-reports/ADVISORY_RELEASE_METADATA.json'), JSON.stringify({ schema: 1, checkedAtUTC: new Date().toISOString(),
    purpose: 'Official package release/version/integrity/engine/peer metadata; not an exploitability verdict. No packages installed and no lifecycle scripts run.', packages }, null, 2) + '\n')
  console.log(JSON.stringify(packages.map(row => ({ name: row.name, latest: row.latest, versions: row.versions.map(v => ({ version: v.version, exists: v.exists, engines: v.engines, peerDependencies: v.peerDependencies })) })), null, 2))
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
