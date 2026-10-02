const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const OPTIONAL_DXC = {
  'dxcompiler.dll': 'b2b5c67bc4a9c92a0ea87000415e7970488d1ca25767518d4cc27b88f18fb6ac',
  'dxil.dll': '77e039c905030a641e53658a008b74e90635a5ea9b6b79eabd0f2003bdfca59a'
}

function pruneWindowsRuntime(context) {
  if (context.electronPlatformName !== 'win32') return []
  // Do not apply assumptions about optional DLLs to another Electron/architecture.
  if (context.packager.config.electronVersion !== '44.3.0' || context.arch !== 1) {
    throw new Error('Review compact Windows runtime for the new Electron version/architecture')
  }
  const root = fs.realpathSync(context.appOutDir)
  if (root === fs.realpathSync(context.packager.info.appDir)) throw new Error('Refusing to prune source directory')
  const files = Object.entries(OPTIONAL_DXC).map(([name, expected]) => {
    const file = path.resolve(root, name)
    const stat = fs.lstatSync(file)
    if (path.dirname(file) !== root || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected runtime path: ' + name)
    const bytes = fs.readFileSync(file)
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Review changed optional compiler: ' + name)
    return { name, file, bytes: bytes.length, sha256: expected }
  })
  // Check every candidate first. Only these two ordinary files in this build are removed.
  for (const file of files) fs.unlinkSync(file.file)
  console.log('Pruned optional Windows DXC components:', files.map(f => `${f.name} (${f.bytes} bytes)`).join(', '))
  return files
}
module.exports = { pruneWindowsRuntime, OPTIONAL_DXC }
