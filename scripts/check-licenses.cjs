const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

function checkLicenses({ release = false, rootDir = root } = {}) {
  rootDir = path.resolve(rootDir)
  const file = name => {
    if (typeof name !== 'string' || path.isAbsolute(name) || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe license material path')
    const target = path.resolve(rootDir, name)
    if (!target.startsWith(rootDir + path.sep)) throw new Error('License material escapes source root')
    if (fs.existsSync(target)) {
      if (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink()) throw new Error('License material must be an ordinary file')
      const canonicalRoot = fs.realpathSync(rootDir)
      if (!fs.realpathSync(target).startsWith(canonicalRoot + path.sep)) throw new Error('License material escapes source root through a link')
    }
    return target
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/GPL-3.0.txt', 'licenses/LGPL-3.0.txt', 'docs/CORRESPONDING_SOURCE.md']) {
    if (!fs.existsSync(file(name))) throw new Error(`Missing license material: ${name}`)
  }
  const status = JSON.parse(fs.readFileSync(file('docs/license-status.json'), 'utf8'))
  if (status.formatVersion !== 1 || !Array.isArray(status.unresolved)) throw new Error('Invalid license review status')
  if (release && status.unresolved.length) {
    throw new Error('Release blocked by unresolved source permissions:\n' + status.unresolved.map(item => `${item.id}: ${item.reason}`).join('\n'))
  }
  const provenance = JSON.parse(fs.readFileSync(file('docs/third-party-provenance.json'), 'utf8'))
  const model = provenance.skinview3d
  const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(file(model.file), 'utf8').replace(/\r\n/g, '\n')).digest('hex')
  if (digest !== model.normalizedSha256) throw new Error('Vendored skin model changed: review provenance')
  for (const name of provenance.voxlink.files) if (!fs.readFileSync(file('src/main/core/voxlink/' + name), 'utf8').includes('SPDX-License-Identifier: LGPL-3.0-only')) throw new Error('Missing LGPL marker: ' + name)
  for (const name of ['licenses/skinview3d.txt', 'licenses/skinview-utils.txt', 'licenses/ws.txt', 'licenses/minecraft-data.txt', 'licenses/vue.txt', 'licenses/vue-runtime-core.txt', 'licenses/vue-runtime-dom.txt', 'licenses/vue-reactivity.txt', 'licenses/vue-shared.txt', 'licenses/three.txt', 'licenses/adm-zip.txt', 'licenses/koffi.txt', 'licenses/undici.txt']) {
    const content = fs.readFileSync(file(name), 'utf8')
    if (!/Permission is hereby granted/.test(content) || !/THE SOFTWARE IS PROVIDED/.test(content) || content.length < 800) throw new Error('Incomplete MIT license: ' + name)
  }
  const isc = fs.readFileSync(file('licenses/iarna-toml.txt'), 'utf8')
  if (!/Permission to use, copy, modify, and\/or distribute/.test(isc) || !/THE SOFTWARE IS PROVIDED/.test(isc) || isc.length < 600) throw new Error('Incomplete ISC license')
  for (const name of provenance.voxlink.sharedFiles || []) if (!fs.readFileSync(file(name),'utf8').includes('SPDX-License-Identifier: LGPL-3.0-only')) throw new Error('Missing LGPL marker: '+name)
  for (const [name,marker,minimum] of [['licenses/GPL-3.0.txt','GNU GENERAL PUBLIC LICENSE',30000],['licenses/LGPL-3.0.txt','GNU LESSER GENERAL PUBLIC LICENSE',7000],['licenses/LGPL-2.1.txt','GNU LESSER GENERAL PUBLIC LICENSE',25000]]) {
    const content = fs.readFileSync(file(name), 'utf8')
    if (!content.includes(marker) || content.length < minimum) throw new Error('Incomplete copyleft license: ' + name)
  }
  if (!Array.isArray(provenance.koffiNativeHeaders?.materials) || provenance.koffiNativeHeaders.materials.length !== 2) throw new Error('Missing native-header license provenance')
  if (!Array.isArray(provenance.portableLibraries?.materials) || provenance.portableLibraries.materials.length < 7 || !Array.isArray(provenance.portableLibraries.sourceArchives) || provenance.portableLibraries.sourceArchives.length !== 3) throw new Error('Missing portable-library license/source provenance')
  if (!Array.isArray(provenance.runtimeFFmpeg?.materials) || provenance.runtimeFFmpeg.materials.length !== 3 || !provenance.authlibInjector?.material) throw new Error('Missing runtime copyleft materials/provenance')
  const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex')
  for (const material of [...provenance.koffiNativeHeaders.materials,...provenance.portableLibraries.materials,...provenance.runtimeFFmpeg.materials,provenance.authlibInjector.material]) {
    if (!/^[a-f\d]{64}$/.test(material.normalizedSha256)) throw new Error('Invalid verified license digest')
    const content = fs.readFileSync(file(material.file), 'utf8').replace(/\r\n/g, '\n')
    if (hash(content) !== material.normalizedSha256) throw new Error('Verified license material changed: ' + material.file)
  }
  for (const archive of provenance.portableLibraries.sourceArchives) {
    if (!/^[a-f\d]{64}$/.test(archive.sha256) || !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0) throw new Error('Invalid corresponding-source binding')
    const content = fs.readFileSync(file(archive.file))
    if (content.length !== archive.bytes || hash(content) !== archive.sha256) throw new Error('Corresponding-source archive changed: ' + archive.file)
  }
  // This is a deterministic materials gate. Asset permissions, historical source
  // provenance and actual platform package notices need their separate audits.
  return status
}
module.exports = { checkLicenses }
if (require.main === module) {
  try { checkLicenses({ release: !process.argv.includes('--materials-only') }); console.log('License check passed') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
