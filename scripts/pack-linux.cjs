// Native packages preserve ELF libraries, permissions and a per-package identity.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), arch = process.argv[2] || process.arch
if (process.platform !== 'linux' || arch !== process.arch || !['x64', 'arm64'].includes(arch)) throw Error('Linux must be packaged and verified on the matching native architecture')
const { version } = require('../package.json'), prefix = 'KAMUCL-' + version + '-linux-' + arch
const { linuxArtifactNames, assertUnpublishedLinuxArtifact, publishLinuxArtifact } = require('./linux-artifact-names.cjs')
const releaseDirectory = path.join(root, 'release')
for (const target of ['AppImage', 'deb', 'tar.gz']) assertUnpublishedLinuxArtifact(releaseDirectory, linuxArtifactNames(version, arch, target).releaseName)
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options })
run(process.execPath, ['scripts/build-bridge.cjs']); run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--linux', 'dir', '--' + arch, '--config.afterPack=scripts/verify-linux-runtime.cjs', '--publish', 'never'])
const directory = path.join(root, 'release/linux' + (arch === 'arm64' ? '-arm64' : '') + '-unpacked')
const { verifyLinuxRuntime } = require('./verify-linux-runtime.cjs')
verifyLinuxRuntime(directory, arch)
const stageRoot = fs.mkdtempSync(path.join(root, 'out/linux-package-'))
const portable = path.join(stageRoot, 'KAMUCL')
fs.cpSync(directory, portable, { recursive: true, dereference: true })
verifyLinuxRuntime(portable, arch)
run('/usr/bin/tar', ['--format=ustar', '--dereference', '-czf', path.join(stageRoot, linuxArtifactNames(version, arch, 'tar.gz').builderName), '-C', stageRoot, 'KAMUCL'])
publishLinuxArtifact(stageRoot, releaseDirectory, linuxArtifactNames(version, arch, 'tar.gz'))
for (const [target, kind] of [['AppImage', 'appimage'], ['deb', 'deb']]) {
  const copy = path.join(stageRoot, kind)
  fs.cpSync(directory, copy, { recursive: true, dereference: true }); verifyLinuxRuntime(copy, arch, kind)
  // The packager copies our AppRun after generating its default launcher.
  // The default silently disables sandboxing when user namespaces are blocked.
  if (kind === 'appimage') { fs.copyFileSync(path.join(__dirname, 'linux-AppRun.sh'), path.join(copy, 'AppRun')); fs.chmodSync(path.join(copy, 'AppRun'), 0o755) }
  const builderDirectory = path.join(stageRoot, 'builder-' + kind)
  run('npx', ['electron-builder', '--linux', target, '--' + arch, '--prepackaged', copy, '--config.directories.output=' + builderDirectory, '--publish', 'never'])
  publishLinuxArtifact(builderDirectory, releaseDirectory, linuxArtifactNames(version, arch, target))
}
const products = ['AppImage', 'deb', 'tar.gz'].map(extension => path.join(root, 'release', prefix + '.' + extension))
fs.writeFileSync(path.join(root, 'release/SHA256SUMS-linux-' + arch + '.txt'), products.map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + path.basename(file)).join('\n') + '\n')
run(process.execPath, ['scripts/verify-linux-package.cjs', arch])
console.log(JSON.stringify({ version, arch, nativeBuild: true, packages: products, desktopAcceptance: 'Run verify-linux-desktop.cjs in a real graphical desktop; packaging is not a desktop pass' }))
