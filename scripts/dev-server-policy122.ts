import type { Plugin, ServerOptions } from 'vite'

/** Desktop development is local. This contains exposure; it is not a Vite CVE backport. */
export const LOOPBACK_DEV_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1']
export function loopbackDevServerOptions(): ServerOptions {
  return {
    host: '127.0.0.1',
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
    cors: { origin: LOOPBACK_DEV_ORIGIN },
    fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**'] }
  }
}
export function loopbackDevServerPolicy(): Plugin {
  return {
    name: 'kamucl-loopback-dev-server-policy',
    enforce: 'post',
    configResolved(config) {
      if (config.command !== 'serve') return
      // This is checked after CLI and inline config merging, before listen().
      if (typeof config.server.host !== 'string' || !LOOPBACK_HOSTS.includes(config.server.host)) {
        throw new Error('KAMUCL 开发服务器仅允许本机 loopback；拒绝 --host 公网或局域网覆盖。')
      }
      const cors = config.server.cors
      if (!cors || cors === true || !(cors.origin instanceof RegExp) ||
          cors.origin.source !== LOOPBACK_DEV_ORIGIN.source || cors.origin.flags !== LOOPBACK_DEV_ORIGIN.flags) {
        throw new Error('KAMUCL 开发服务器必须保留仅 loopback origin 的 CORS 策略。')
      }
      if (!Array.isArray(config.server.allowedHosts) || config.server.allowedHosts.some(host => !['localhost', '127.0.0.1', '[::1]'].includes(host))) {
        throw new Error('KAMUCL 开发服务器不允许扩大 Host 名称列表。')
      }
      if (config.server.fs.strict !== true) throw new Error('KAMUCL 开发服务器必须保留文件系统边界。')
      for (const pattern of ['.env', '.env.*', '*.{crt,pem}', '**/.git/**']) {
        if (!config.server.fs.deny.includes(pattern)) throw new Error('KAMUCL 开发服务器必须保留敏感文件拒绝规则。')
      }
    }
  }
}
