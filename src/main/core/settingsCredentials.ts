import type { CredentialStorage } from './credentialProtection'
import { protectedCredentialStorage } from './credentialProtection'

interface SecretStorage extends CredentialStorage {
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export interface SettingsCredentialSnapshot {
  readonly ciphertext?: string
  readonly plaintext?: string
  readonly legacy: boolean
}

function validateKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('自定义 CurseForge 密钥必须为文本；清空请输入空文本。')
  const key = value.trim()
  if (key.length > 4096 || /[\u0000-\u001f\u007f]/.test(key)) throw new Error('自定义 CurseForge 密钥格式无效。')
  return key
}

/** Write-only settings credential state: no snapshot ever enters a Settings/IPC result. */
export class SettingsCredentials {
  private current: SettingsCredentialSnapshot = { legacy: false }
  constructor(private readonly storage: SecretStorage) {}

  load(raw: Record<string, unknown>): void {
    const secure = raw.secureCredentials as { curseforgeApiKey?: unknown } | undefined
    const ciphertext = typeof secure?.curseforgeApiKey === 'string' && secure.curseforgeApiKey ? secure.curseforgeApiKey : undefined
    const legacy = typeof raw.curseforgeApiKey === 'string' && !!raw.curseforgeApiKey.trim()
    // A legacy plaintext write can come from an older version that knew nothing about our vault.
    this.current = { ...(ciphertext ? { ciphertext } : {}), ...(legacy ? { plaintext: (raw.curseforgeApiKey as string).trim() } : {}), legacy }
  }

  configured(snapshot = this.current): boolean { return !!(snapshot.plaintext || snapshot.ciphertext) }

  prepare(patch: { curseforgeApiKey?: unknown }): SettingsCredentialSnapshot {
    if (Object.hasOwn(patch, 'curseforgeApiKey')) {
      const plaintext = validateKey(patch.curseforgeApiKey)
      if (!plaintext) return { legacy: false }
      return this.encrypt(plaintext)
    }
    if (this.current.legacy) return this.encrypt(validateKey(this.current.plaintext!))
    return this.current
  }

  private encrypt(plaintext: string): SettingsCredentialSnapshot {
    if (!protectedCredentialStorage(this.storage)) throw new Error('系统安全存储不可用，无法安全保存或迁移自定义 CurseForge 密钥；原设置未改动。')
    try { return { plaintext, ciphertext: this.storage.encryptString(plaintext).toString('base64'), legacy: false } }
    catch { throw new Error('系统安全存储无法加密自定义 CurseForge 密钥；原设置未改动。') }
  }

  commit(snapshot: SettingsCredentialSnapshot): void { this.current = snapshot }

  read(): string {
    if (this.current.plaintext) return validateKey(this.current.plaintext)
    if (!this.current.ciphertext) return ''
    if (!protectedCredentialStorage(this.storage)) throw new Error('系统安全存储暂不可用，无法读取已保存的自定义 CurseForge 密钥。')
    try {
      const plaintext = validateKey(this.storage.decryptString(Buffer.from(this.current.ciphertext, 'base64')))
      if (!plaintext) throw new Error()
      this.current = { ...this.current, plaintext }
      return plaintext
    } catch { throw new Error('无法解密已保存的自定义 CurseForge 密钥，请检查系统密钥服务或重新设置密钥。') }
  }
}

export function publicSettingsFields<T extends Record<string, unknown>>(value: T): Omit<T, 'curseforgeApiKey' | 'secureCredentials' | 'curseforgeApiKeyConfigured'> {
  const { curseforgeApiKey: _key, secureCredentials: _secure, curseforgeApiKeyConfigured: _status, ...publicFields } = value
  return publicFields
}

export function rejectSettingsCredentialInjection(patch: Record<string, unknown>): void {
  if (Object.hasOwn(patch, 'secureCredentials')) throw new Error('安全凭据字段不能由设置界面或外观配置注入。')
}
