const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

function checkLicenses({ release = false } = {}) {
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/GPL-3.0.txt', 'licenses/LGPL-3.0.txt', 'docs/CORRESPONDING_SOURCE.md']) {
    if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing license material: ${name}`)
  }
  const status = JSON.parse(fs.readFileSync(path.join(root, 'docs/license-status.json'), 'utf8'))
  if (status.formatVersion !== 1 || !Array.isArray(status.unresolved)) throw new Error('Invalid license review status')
  if (release && status.unresolved.length) {
    throw new Error('Release blocked by unresolved source permissions:\n' + status.unresolved.map(item => `${item.id}: ${item.reason}`).join('\n'))
  }
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'docs/third-party-provenance.json'), 'utf8'))
  const model = provenance.skinview3d
  const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, model.file), 'utf8').replace(/\r\n/g, '\n')).digest('hex')
  if (digest !== model.normalizedSha256) throw new Error('Vendored skin model changed: review provenance')
  for (const file of provenance.voxlink.files) if (!fs.readFileSync(path.join(root, 'src/main/core/voxlink', file), 'utf8').includes('SPDX-License-Identifier: LGPL-3.0-only')) throw new Error('Missing LGPL marker: ' + file)
  for (const file of ['licenses/skinview3d.txt', 'licenses/skinview-utils.txt', 'licenses/ws.txt', 'licenses/minecraft-data.txt']) if (!fs.existsSync(path.join(root, file))) throw new Error('Missing MIT license: ' + file)
  for (const file of provenance.voxlink.sharedFiles || []) if (!fs.readFileSync(path.join(root,file),'utf8').includes('SPDX-License-Identifier: LGPL-3.0-only')) throw new Error('Missing LGPL marker: '+file)
  return status
}
module.exports = { checkLicenses }
if (require.main === module) {
  try { checkLicenses({ release: !process.argv.includes('--materials-only') }); console.log('License check passed') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
