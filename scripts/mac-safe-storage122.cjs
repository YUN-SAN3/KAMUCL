// Runs only in Electron on an owned temporary profile. The random fixture stays private.
const { app, safeStorage } = require('electron')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const [phase, privateDirectory, receiptFile] = process.argv.slice(2)
assert(['write', 'read'].includes(phase)); assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64')
assert.equal(process.versions.electron, require('../package.json').devDependencies.electron)
assert(path.isAbsolute(privateDirectory) && path.isAbsolute(receiptFile))
app.setName('KAMUCL native security fixture 122'); app.setPath('userData', privateDirectory)
app.whenReady().then(() => {
  const receipt = { phase, platform: process.platform, arch: process.arch, electron: process.versions.electron, fixtureOnly: true, complete: false, observedAt: new Date().toISOString() }
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true, 'Native protected credential storage is unavailable')
    const file = path.join(privateDirectory, 'synthetic-encrypted-fixture.json')
    if (phase === 'write') {
      const value = crypto.randomBytes(32).toString('hex'), cipher = safeStorage.encryptString(value)
      assert.equal(safeStorage.decryptString(cipher), value, 'Immediate native encryption roundtrip failed')
      fs.writeFileSync(file, JSON.stringify({ cipher: cipher.toString('base64'), expected: crypto.createHash('sha256').update(value).digest('hex') }), { mode: 0o600, flag: 'wx' })
      receipt.immediateRoundtrip = true; receipt.encryptedBytes = cipher.length
    } else {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')), decoded = safeStorage.decryptString(Buffer.from(stored.cipher, 'base64'))
      assert.equal(crypto.createHash('sha256').update(decoded).digest('hex'), stored.expected, 'Native encryption did not survive process restart')
      receipt.restartRoundtrip = true
    }
    receipt.complete = true; fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n'); app.quit()
  } catch (error) {
    // Keep only a fixed diagnostic category, never the value, ciphertext or OS error payload.
    receipt.error = 'native-safe-storage-roundtrip-failed'; fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n'); console.error('Native protected-storage fixture failed; private profile retained locally only'); app.exit(1)
  }
})
