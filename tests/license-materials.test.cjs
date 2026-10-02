const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { checkLicenses } = require('../scripts/check-licenses.cjs')
const root = path.resolve(__dirname, '..')

test('license materials include both LGPL supplement and GPL terms', () => {
  checkLicenses()
  assert.match(fs.readFileSync(path.join(root, 'licenses/LGPL-3.0.txt'), 'utf8'), /GNU LESSER GENERAL PUBLIC LICENSE/)
  assert.match(fs.readFileSync(path.join(root, 'licenses/GPL-3.0.txt'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/)
})
test('unresolved provenance cannot pass release checks', () => {
  const status = checkLicenses()
  if (status.unresolved.length) assert.throws(() => checkLicenses({ release: true }), /Release blocked/)
  else assert.doesNotThrow(() => checkLicenses({ release: true }))
})
test('all platform builder payloads include license files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/**', 'docs/CORRESPONDING_SOURCE.md']) {
    assert.ok(pkg.build.files.includes(file), file)
  }
})
