// Native filesystem preflight. Synthetic payload only; no Java or remote downloads.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { build } = require('esbuild');
const AdmZip = require('adm-zip');
const hash = bytes => crypto.createHash('sha1').update(bytes).digest('hex');
async function main() {
  const prefix = 'kamucl-legacy120-native-preflight-';
  const tmpdir = os.tmpdir(), temporaryBase = fs.realpathSync.native(tmpdir);
  const rawRoot = fs.mkdtempSync(path.join(tmpdir, prefix)), root = fs.realpathSync.native(rawRoot);
  const output = path.resolve(process.argv[2] || 'out/legacy-forge120-native-preflight.json');
  const workspace = fs.realpathSync.native(process.cwd());
  assert(path.relative(workspace, output).startsWith('out' + path.sep));
  const proof = { kind: 'Native filesystem + actual bundled production legacy helpers; synthetic never-executed payload',
    platform: process.platform, arch: process.arch, node: process.version, startedAt: new Date().toISOString(),
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync('src/main/core/legacyForgeInstaller.ts')).digest('hex'),
    tmpdir, temporaryBase, rawRoot, canonicalRoot: root, ancestors: [], status: 'running' };
  let api, failure;
  const recordFailure = (stage, error) => {
    const detail = { stage, message: error.message, stack: error.stack };
    proof.status = 'failed';
    (proof.failures ||= []).push(detail);
    if (!failure) { failure = error; proof.error = detail; }
  };
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    for (let current = rawRoot; ; current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      proof.ancestors.push({ path: current, symbolicLink: stat.isSymbolicLink(), uid: stat.uid,
        ...(stat.isSymbolicLink() ? { target: fs.readlinkSync(current), realpath: fs.realpathSync.native(current) } : {}) });
      if (current === path.parse(current).root) break;
    }
    const result = await build({ stdin: { contents: "export { readLegacyForgeInstaller, prepareLegacyForgeInstaller } from './src/main/core/legacyForgeInstaller'; export { closeHttpClient } from './src/main/core/httpClient';",
      resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
    const projectRequire = createRequire(path.resolve('package.json')), mod = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(name => name === 'electron'
      ? { app: { getPath: key => path.join(root, key), getVersion: () => 'preflight', getName: () => 'KAMUCL-preflight', isPackaged: false } }
      : projectRequire(name), mod, mod.exports);
    api = mod.exports;
    const coordinate = '1.7.10-10.13.4.1614-1.7.10';
    const embedded = new AdmZip(); embedded.addFile('fixture.txt', Buffer.from('Native synthetic universal. No executable code.'));
    const payload = embedded.toBuffer(), installer = new AdmZip(), jar = path.join(root, 'synthetic-installer.jar');
    const metadata = { install: { minecraft: '1.7.10', path: `net.minecraftforge:forge:${coordinate}`, target: 'Native legacy fixture', filePath: `forge-${coordinate}-universal.jar` },
      versionInfo: { id: 'Native legacy fixture', inheritsFrom: '1.7.10', jar: '1.7.10', mainClass: 'net.minecraft.launchwrapper.Launch', minecraftArguments: '--username ${auth_player_name}', libraries: [{ name: `net.minecraftforge:forge:${coordinate}` }] } };
    installer.addFile('install_profile.json', Buffer.from(JSON.stringify(metadata))); installer.addFile(metadata.install.filePath, payload); installer.writeZip(jar);
    const plan = api.readLegacyForgeInstaller(jar, '1.7.10', '10.13.4.1614', `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-installer.jar`);
    assert(plan); assert.equal(plan.libraries.length, 1); assert.equal(plan.libraries[0].checksums[0], hash(payload));
    let rawPrepared;
    try { rawPrepared = await api.prepareLegacyForgeInstaller(plan, path.join(rawRoot, 'raw-libraries'), 'official', () => {}); proof.lexicalRoot = { accepted: true }; }
    catch (error) { proof.lexicalRoot = { accepted: false, error: error.message }; }
    finally { rawPrepared?.dispose(); }
    const outside = path.join(root, 'outside'), linked = path.join(root, 'user-root-link'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'sentinel'), 'Keep me');
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(api.prepareLegacyForgeInstaller(plan, linked, 'official', () => {}), /链接/);
    assert.deepEqual(fs.readdirSync(outside), ['sentinel']); assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'Keep me');
    const libraries = path.join(root, 'canonical-libraries'), game = path.join(root, 'game');
    const prepared = await api.prepareLegacyForgeInstaller(plan, libraries, 'official', () => {});
    try {
      const id = await prepared.install(game, 'Native fixture 中文 §', () => {}); prepared.complete();
      const generated = JSON.parse(fs.readFileSync(path.join(game, 'versions', id, id + '.json'), 'utf8'));
      const artifact = generated.libraries[0].downloads.artifact;
      assert.equal(artifact.sha1, hash(payload)); assert.equal(artifact.size, payload.length);
      assert.equal(hash(fs.readFileSync(path.join(libraries, artifact.path))), hash(payload));
      assert.equal(artifact.path, `net/minecraftforge/forge/${coordinate}/forge-${coordinate}.jar`);
      assert(!fs.existsSync(path.join(game, 'versions', id, '.installing')));
      proof.canonicalRootInstall = { accepted: true, sha1: artifact.sha1, size: artifact.size, classifierFreePath: artifact.path };
    } finally { prepared.dispose(); }
    assert(!fs.readdirSync(libraries).some(name => name.startsWith('.kamucl-legacy-forge-')));
    proof.userRootLinkRejected = true; proof.status = 'passed';
  } catch (error) { recordFailure('preflight', error); }
  finally {
    try { await api?.closeHttpClient(); }
    catch (error) { recordFailure('closeHttpClient', error); }
    proof.ownedRootRemoved = false;
    try {
      const relative = path.relative(temporaryBase, root);
      assert(relative.startsWith(prefix) && relative === path.basename(root) && !path.isAbsolute(relative));
      assert.equal(path.dirname(root), temporaryBase); assert.equal(fs.realpathSync.native(root), root);
      fs.rmSync(root, { recursive: true, force: true });
      proof.ownedRootRemoved = !fs.existsSync(root);
    } catch (error) { recordFailure('cleanup', error); }
    proof.finishedAt = new Date().toISOString();
    try { fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n'); }
    catch (error) { recordFailure('receipt', error); }
  }
  if (failure) {
    if (proof.failures.length > 1) console.error(JSON.stringify({ preflightFailures: proof.failures }));
    throw failure;
  }
  console.log(`${proof.status}: ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
