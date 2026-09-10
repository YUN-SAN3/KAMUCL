const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
if (process.platform === 'win32') {
  for (const name of ['WindowMaterial', 'GameWindowFocus']) {
  const output = path.resolve(`out/main/${name}.exe`)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', `/out:${output}`, path.resolve(`native/${name}.cs`)], { stdio: 'inherit', windowsHide: true })
  }
  const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', `/out:${path.resolve('out/main/StartupFeedback.exe')}`, `/resource:${path.resolve('src/renderer/src/assets/splash-face.png')},face.png`, path.resolve('native/StartupFeedback.cs')], { stdio: 'inherit', windowsHide: true })
}
