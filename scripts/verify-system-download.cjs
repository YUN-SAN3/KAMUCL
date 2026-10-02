// Exercise Chromium's actual networking implementation, not a fetch mock.
const path = require('node:path'), { spawn } = require('node:child_process')
;(async () => {
  const file = path.resolve('out/native-system-download.cjs')
  await require('esbuild').build({ entryPoints: ['tests/helpers/system-download-native.ts'], outfile: file, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [file], { env, windowsHide: true, stdio: 'inherit' })
  const timer = setTimeout(() => child.kill(), 30_000)
  child.once('exit', code => { clearTimeout(timer); process.exitCode = code ?? 1 })
})().catch(error => { console.error(error); process.exitCode = 1 })
