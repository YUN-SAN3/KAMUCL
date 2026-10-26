/** A working cipher with a public fallback password is not protected storage. */
export interface CredentialStorage {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
}
export function protectedCredentialStorage(storage: CredentialStorage, platform: string = process.platform): boolean {
  try {
    if (!storage.isEncryptionAvailable()) return false
    if (platform !== 'linux') return true
    return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(storage.getSelectedStorageBackend?.() ?? '')
  } catch { return false }
}
export function credentialStorageStatus(storage: CredentialStorage, platform: string = process.platform) {
  const persistent = protectedCredentialStorage(storage, platform)
  return { persistent, sessionOnly: platform === 'linux' && !persistent,
    message: persistent ? '' : platform === 'linux'
      ? '系统密钥服务不可用，登录仅在本次运行中有效；请启用 GNOME Keyring 或 KWallet 后重新登录。'
      : '系统安全存储当前不可用，无法安全保存登录令牌' }
}
