import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { requiredMajor } from '../src/main/core/java'
import { resolveInstanceMetadata } from '../src/main/core/instanceMetadata'
import { readClientVersionEvidence } from '../src/main/core/instanceVersionEvidence'
import { supportsQuickPlayMultiplayer } from '../src/main/core/serverUtils'

test('117 verified client version drives Java and direct join without changing profile metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamucl-runtime-metadata117-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'client.jar')
  const profile = Object.freeze({ id: 'custom-Fabric', inheritsFrom: 'opaque-parent', _mcVersion: '0.0.0', libraries: [{ name: 'net.fabricmc:fabric-loader:0.19.5' }] })
  for (const [mc, java, direct] of [['1.12.2', 8, false], ['1.17', 16, false], ['1.20.1', 17, true], ['1.21.5', 21, true], ['26.1', 25, true]] as const) {
    const zip = new AdmZip(); zip.addFile('version.json', Buffer.from(JSON.stringify({ id: mc }))); zip.writeZip(file)
    const resolved = resolveInstanceMetadata(profile, () => undefined, () => readClientVersionEvidence(file)).mcVersion
    assert.equal(resolved, mc)
    assert.equal(requiredMajor(profile, resolved), java)
    assert.equal(supportsQuickPlayMultiplayer(resolved), direct)
    assert.equal(profile._mcVersion, '0.0.0')
  }
  assert.equal(requiredMajor({ ...profile, javaVersion: { majorVersion: 25 } }, '1.20.1'), 17, 'a copied profile declaration cannot override the canonical game release requirement')
  assert.equal(requiredMajor({ id: '1.20.1', _mcVersion: '0.0.0' }), 17, 'placeholder does not override a canonical profile id')
  assert.throws(() => requiredMajor(profile, '0.0.0'), /无法确认/, 'unknown game requirements must not silently default to Java 21')
  const invalid = new AdmZip(); invalid.addFile('version.json', Buffer.from('{"id":"0.0.0"}')); invalid.writeZip(file)
  assert.equal(readClientVersionEvidence(file), undefined)
  const resolved = resolveInstanceMetadata(profile, () => undefined, () => readClientVersionEvidence(file)).mcVersion
  assert.equal(resolved, '未知')
  assert.equal(supportsQuickPlayMultiplayer(resolved), false)
})
