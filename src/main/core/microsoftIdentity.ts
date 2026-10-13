import { DEFAULT_MS_CLIENT_ID } from '../../shared/types'
import type { Account, MicrosoftAuthFailure, MicrosoftAuthFailureCode } from '../../shared/types'

/** A public desktop client has no embedded client secret or third-party fallback. */
export const MICROSOFT_IDENTITY = Object.freeze({
  clientId: DEFAULT_MS_CLIENT_ID,
  applicationName: 'KAMUCL' as const,
  authority: 'https://login.microsoftonline.com/consumers/oauth2/v2.0',
  scopes: 'XboxLive.signin offline_access'
})

const MESSAGES: Record<MicrosoftAuthFailureCode, string> = {
  APPLICATION_REJECTED: 'KAMUCL 的微软应用配置或 Xbox/Minecraft 服务许可尚未通过验证，请联系维护者；不会切换到其他启动器身份。',
  ACCOUNT_REAUTH_REQUIRED: '微软应用身份已更新或原授权来源无法确认，请重新登录此账号；账号资料已保留。',
  USER_DECLINED: '已拒绝微软授权，可重新开始登录。',
  DEVICE_CODE_EXPIRED: '设备代码已过期，请重新开始微软登录。',
  NETWORK_ERROR: '正版登录网络连接失败，请检查网络或正版登录系统代理设置后重试。',
  TLS_ERROR: 'SSL 证书验证失败，请检查系统时间、代理或网络证书；登录已中止。',
  STORAGE_UNAVAILABLE: '系统安全存储当前不可用，无法安全保存新的登录令牌；原账号凭据已保留。',
  STORAGE_WRITE_FAILED: '无法保存新的账号授权，原账号与选择已保留；请检查文件权限或磁盘空间后重试。',
  PROTOCOL_ERROR: '正版认证服务返回了无效响应，未保存此次授权，请重试。',
  NOT_OWNED: 'Minecraft 拥有权检查：该账号未拥有 Minecraft。',
  PROFILE_MISSING: '未取得可用的 Minecraft 档案，请先完成正版账号档案设置。',
  ACCOUNT_CHANGED: '账号在认证期间已被移除或更新，此次旧响应未保存，请重试。',
  CANCELLED: '已取消微软登录。',
  RATE_LIMITED: '正版认证服务暂时限制请求，请稍后重试。',
  SERVICE_ERROR: '正版认证服务暂时不可用或拒绝此请求，请稍后重试。'
}

/** Only controlled messages/metadata reach logs or IPC; raw responses never do. */
export class MicrosoftAuthError extends Error {
  readonly failure: MicrosoftAuthFailure
  constructor(code: MicrosoftAuthFailureCode, stage: string, httpStatus?: number) {
    super(`${stage}：[${code}] ${MESSAGES[code]}`)
    this.name = 'MicrosoftAuthError'
    this.failure = { code, stage, message: this.message,
      ...(Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599 ? { httpStatus } : {}) }
  }
}

export function microsoftReauthReason(account: Account): Account['msReauthReason'] | undefined {
  if (account.type !== 'microsoft') return undefined
  if (!account.msOAuthClientId) return 'identity-unknown'
  if (account.msOAuthClientId !== MICROSOFT_IDENTITY.clientId) return 'application-changed'
  if (!account.refreshToken) return 'credentials-missing'
  return account.msReauthRequired ? account.msReauthReason ?? 'credentials-missing' : undefined
}

export function assertMicrosoftIdentityPatch(patch: { msClientId?: unknown }): void {
  if (Object.hasOwn(patch, 'msClientId') && patch.msClientId !== MICROSOFT_IDENTITY.clientId) {
    throw new Error('KAMUCL 正式微软应用身份不可覆写，请使用当前正式版本重新授权。')
  }
}

export function oauthResponseError(data: Record<string, unknown>, status: number, stage: string): MicrosoftAuthError {
  const code = typeof data.error === 'string' ? data.error : ''
  if (['invalid_client', 'unauthorized_client', 'invalid_scope'].includes(code)) return new MicrosoftAuthError('APPLICATION_REJECTED', stage, status)
  if (code === 'access_denied' || code === 'authorization_declined') return new MicrosoftAuthError('USER_DECLINED', stage, status)
  if (code === 'expired_token' || code === 'bad_verification_code') return new MicrosoftAuthError('DEVICE_CODE_EXPIRED', stage, status)
  if (code === 'invalid_grant' || code === 'interaction_required' || code === 'login_required') return new MicrosoftAuthError('ACCOUNT_REAUTH_REQUIRED', stage, status)
  return new MicrosoftAuthError(status === 429 ? 'RATE_LIMITED' : 'SERVICE_ERROR', stage, status)
}

export function safeMicrosoftError(error: unknown, stage: string, cancelled = false): MicrosoftAuthError {
  if (cancelled) return new MicrosoftAuthError('CANCELLED', stage)
  if (error instanceof MicrosoftAuthError) return error
  const value = error as { code?: unknown; message?: unknown } | null
  const metadata = `${typeof value?.code === 'string' ? value.code : ''} ${typeof value?.message === 'string' ? value.message : ''}`
  return new MicrosoftAuthError(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|SSL.*验证|TLS/i.test(metadata) ? 'TLS_ERROR' : 'NETWORK_ERROR', stage)
}

export function microsoftVerificationUri(value: unknown): string {
  if (typeof value !== 'string') throw new MicrosoftAuthError('PROTOCOL_ERROR', '获取设备码')
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') ||
      !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com', 'login.live.com'].includes(url.hostname)) throw new Error()
    return url.href
  } catch { throw new MicrosoftAuthError('PROTOCOL_ERROR', '获取设备码') }
}
