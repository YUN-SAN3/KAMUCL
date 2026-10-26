import crypto from 'node:crypto'
import type { FrpCipherStorage } from '../../src/main/core/frpSecureStore'
/** Isolated AES-GCM fixture; not a claim of actual OS Keychain/DPAPI coverage. */
export class FrpCipherFixture implements FrpCipherStorage {
  available = true
  backend = 'gnome_libsecret'
  private key = crypto.randomBytes(32)
  isEncryptionAvailable() { return this.available }
  getSelectedStorageBackend() { return this.backend }
  encryptString(value: string) {
    if (!this.available) throw new Error('fixture-keyring-locked')
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
  }
  decryptString(value: Buffer) {
    if (!this.available) throw new Error('fixture-keyring-locked')
    const cipher = crypto.createDecipheriv('aes-256-gcm', this.key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28))
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
  }
}
