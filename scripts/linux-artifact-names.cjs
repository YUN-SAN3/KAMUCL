const fs = require('node:fs'), path = require('node:path')

// electron-builder uses distribution-specific names for ${arch}; update identity
// uses the Node architecture. Map only the current target's exact output.
function linuxArtifactNames(version, arch, target) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !['x64', 'arm64'].includes(arch) || !['AppImage', 'deb', 'tar.gz'].includes(target)) throw Error('Unsupported Linux package identity')
  const builderArch = arch === 'x64' ? target === 'AppImage' ? 'x86_64' : target === 'deb' ? 'amd64' : 'x64' : 'arm64'
  return { builderName: `KAMUCL-${version}-linux-${builderArch}.${target}`, releaseName: `KAMUCL-${version}-linux-${arch}.${target}` }
}

function assertUnpublishedLinuxArtifact(directory, name) {
  const destination = path.join(directory, name)
  try { fs.lstatSync(destination) } catch (error) { if (error.code === 'ENOENT') return destination; throw error }
  throw Error('Refusing to overwrite an existing Linux candidate: ' + destination)
}

function publishLinuxArtifact(builderDirectory, releaseDirectory, names) {
  const source = path.join(builderDirectory, names.builderName), stat = fs.lstatSync(source)
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('Missing or unsafe Linux builder artifact: ' + source)
  const destination = assertUnpublishedLinuxArtifact(releaseDirectory, names.releaseName)
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(destination, stat.mode & 0o777)
  return destination
}

module.exports = { linuxArtifactNames, assertUnpublishedLinuxArtifact, publishLinuxArtifact }
