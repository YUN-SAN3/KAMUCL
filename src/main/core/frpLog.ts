import { StringDecoder } from 'node:string_decoder'
import type { FrpStatus } from './frp'

export function parseFrpLine(raw: string): { status: FrpStatus | null; address: string | null; priority: number } {
  const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  let status: FrpStatus | null = null
  if (/invalid token|login to server failed|authorization failed|访问密钥.*(?:无效|失效)|认证失败/i.test(text)) status = 'auth_failed'
  else if (/tunnel not exists|tunnel offline|proxy not found|隧道不存在|隧道已被禁用/i.test(text)) status = 'tunnel_offline'
  else if (/start proxy (?:error|failed)|隧道启动失败/i.test(text)) status = 'error'
  else if (/\b(?:start )?proxy success\b|隧道启动成功/i.test(text)) status = 'running'

  // Accept addresses printed by frpc, never a local destination, timestamp or help URL.
  const contextual = /需要输\s*IP\s*[:：]\s*端口|远程地址|remote address|(?:电信|联通|移动)\s*[:：]/i.test(text)
  const known = /(?:[\w-]+\.)*(?:natfrp\.cloud|nyatwork\.cn|frp-hub\.com|frp\.com|frp\.net)/i
  const matches = [...text.matchAll(/((?:[a-z0-9-]+\.)+[a-z0-9-]+)\s*:\s*(\d{1,5})(?!\d)/gi)]
  const match = matches.find(m => (contextual || known.test(m[1])) && !/^(?:127\.|0\.0\.0\.0$|localhost$)/.test(m[1]) && Number(m[2]) > 0 && Number(m[2]) <= 65535)
  return { status, address: match ? `${match[1]}:${match[2]}` : null,
    priority: /需要输\s*IP\s*[:：]\s*端口|远程地址|remote address/i.test(text) ? 2 : 1 }
}

/** Each pipe owns a decoder: UTF-8 characters and lines can cross chunk boundaries. */
export function frpLineReader(emit: (line: string) => void) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const drain = (text: string) => {
    pending += text
    let end: number
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, '')
      pending = pending.slice(end + 1)
      if (line.trim()) emit(line)
    }
  }
  return {
    write(chunk: Buffer | string) { drain(typeof chunk === 'string' ? chunk : decoder.write(chunk)) },
    end() { drain(decoder.end()); if (pending.trim()) emit(pending.replace(/\r$/, '')); pending = '' }
  }
}
