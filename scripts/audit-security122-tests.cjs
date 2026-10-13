const test = require('node:test'), assert = require('node:assert/strict')
const { scanBytes } = require('./audit-security122.cjs')
test('potential secret detection never serializes its value or neighboring text', () => {
  const secret = 'ghp_' + 'Q7r8T9u0V1w2X3y4Z5a6B7c8D9e0'
  const results = scanBytes(Buffer.from(`privateNeighbor\nconst token = '${secret}'`), 'src/application.ts')
  assert.equal(results.length, 1); assert.equal(results[0].kind, 'github-token'); assert.equal(results[0].line, 2)
  assert.ok(!JSON.stringify(results).includes(secret)); assert.ok(!JSON.stringify(results).includes('privateNeighbor'))
})
test('public OAuth application identifiers are not classified as secrets', () => {
  const results = scanBytes(Buffer.from(`client_id: '06cc8cf6-4b8f-4631-8459-b2bd828808f8'`), 'src/application.ts')
  assert.equal(results.length, 1); assert.equal(results[0].classification, 'public-identifier-not-a-secret')
})
test('fixtures remain review candidates rather than being omitted', () => {
  const secret = 'ghp_' + 'X'.repeat(32)
  const results = scanBytes(Buffer.from(secret), 'tests/synthetic.test.ts')
  assert.equal(results.length, 1); assert.equal(results[0].classification, 'synthetic-or-fixture-needs-review')
})
test('PE UTF16 private strings receive separate representation checks without disclosure', () => {
  const secret = 'ghp_' + 'P'.repeat(32), bytes = Buffer.concat([Buffer.from('MZ\0\0'), Buffer.from(secret, 'utf16le')])
  const results = scanBytes(bytes, 'native/component.exe')
  assert.equal(results.length, 1); assert.equal(results[0].representation, 'utf16le-strings'); assert.equal(results[0].line, null)
  assert.ok(!JSON.stringify(results).includes(secret))
})
test('opaque application-key or password-hash shape does not prove token ownership or account compromise', () => {
  const value = '$2a$10$' + 'A'.repeat(53), results = scanBytes(Buffer.from(value), 'src/api.ts')
  assert.equal(results[0].classification, 'opaque-application-key-or-password-hash-needs-context')
  assert.ok(!JSON.stringify(results).includes(value))
})
