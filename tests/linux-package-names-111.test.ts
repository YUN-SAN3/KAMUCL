import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const { linuxArtifactNames, assertUnpublishedLinuxArtifact, publishLinuxArtifact } = createRequire(path.resolve('package.json'))('./scripts/linux-artifact-names.cjs')

test('Linux builder architecture names map explicitly to the trusted release identity on both ABIs', () => {
  const mappings = [
    ['x64', 'AppImage', 'KAMUCL-1.1.11-linux-x86_64.AppImage', 'KAMUCL-1.1.11-linux-x64.AppImage'],
    ['x64', 'deb', 'KAMUCL-1.1.11-linux-amd64.deb', 'KAMUCL-1.1.11-linux-x64.deb'],
    ['x64', 'tar.gz', 'KAMUCL-1.1.11-linux-x64.tar.gz', 'KAMUCL-1.1.11-linux-x64.tar.gz'],
    ['arm64', 'AppImage', 'KAMUCL-1.1.11-linux-arm64.AppImage', 'KAMUCL-1.1.11-linux-arm64.AppImage'],
    ['arm64', 'deb', 'KAMUCL-1.1.11-linux-arm64.deb', 'KAMUCL-1.1.11-linux-arm64.deb'],
    ['arm64', 'tar.gz', 'KAMUCL-1.1.11-linux-arm64.tar.gz', 'KAMUCL-1.1.11-linux-arm64.tar.gz']
  ]
  for (const [arch, target, builderName, releaseName] of mappings) {
    const names = linuxArtifactNames('1.1.11', arch, target)
    assert.deepEqual(names, { builderName, releaseName })
  }
  for (const args of [['1.1.11', 'ia32', 'deb'], ['1.1.11', 'x64', 'rpm'], ['../1.1.11', 'x64', 'deb']]) assert.throws(() => linuxArtifactNames(...args), /Unsupported Linux package identity/)
})

test('Linux artifact publication requires the current exact builder output and preserves old candidates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-linux-names-'))
  try {
    const builder = path.join(root, 'current-builder'), release = path.join(root, 'release')
    fs.mkdirSync(builder); fs.mkdirSync(release)
    const names = linuxArtifactNames('1.1.11', 'x64', 'AppImage'), payload = Buffer.from('synthetic package fixture; not a native package')
    fs.writeFileSync(path.join(builder, 'KAMUCL-1.1.10-linux-x86_64.AppImage'), Buffer.from('old builder output'))
    assert.throws(() => publishLinuxArtifact(builder, release, names), /ENOENT/)
    assert.deepEqual(fs.readdirSync(release), [])
    fs.writeFileSync(path.join(builder, names.builderName), payload, { mode: 0o755 })
    const published = publishLinuxArtifact(builder, release, names)
    assert.equal(published, path.join(release, names.releaseName)); assert(fs.readFileSync(published).equals(payload))
    if (process.platform !== 'win32') assert.equal(fs.statSync(published).mode & 0o777, 0o755)
    for (const arch of ['x64', 'arm64']) for (const target of ['AppImage', 'deb', 'tar.gz']) {
      const artifact = linuxArtifactNames('1.1.12', arch, target), exactBytes = Buffer.from(`${arch}:${target}:synthetic package`)
      fs.writeFileSync(path.join(builder, artifact.builderName), exactBytes)
      assert(fs.readFileSync(publishLinuxArtifact(builder, release, artifact)).equals(exactBytes))
    }
    fs.writeFileSync(path.join(builder, names.builderName), 'different new candidate')
    assert.throws(() => publishLinuxArtifact(builder, release, names), /Refusing to overwrite/)
    assert.throws(() => assertUnpublishedLinuxArtifact(release, names.releaseName), /Refusing to overwrite/)
    assert(fs.readFileSync(published).equals(payload))
    const empty = linuxArtifactNames('1.1.11', 'arm64', 'deb'); fs.writeFileSync(path.join(builder, empty.builderName), '')
    assert.throws(() => publishLinuxArtifact(builder, release, empty), /unsafe Linux builder artifact/)
    const directory = linuxArtifactNames('1.1.11', 'arm64', 'AppImage'); fs.mkdirSync(path.join(builder, directory.builderName))
    assert.throws(() => publishLinuxArtifact(builder, release, directory), /unsafe Linux builder artifact/)
    if (process.platform !== 'win32') {
      const linked = linuxArtifactNames('1.1.11', 'x64', 'deb'); fs.symlinkSync(path.join(builder, names.builderName), path.join(builder, linked.builderName))
      assert.throws(() => publishLinuxArtifact(builder, release, linked), /unsafe Linux builder artifact/)
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
