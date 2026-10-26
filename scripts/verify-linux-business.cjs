// Native Linux business execution is deliberately independent of WebGL success.
// This is a disposable source integration harness, not desktop qualification.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync, spawn } = require('node:child_process')
const { observeTamperedRejection, openOwnedInspector } = require('./linux-update-observer.cjs')
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const physicalFs = process.versions.electron ? require('original-fs') : fs
const sha = file => crypto.createHash('sha256').update(physicalFs.readFileSync(file)).digest('hex')
const errorRecord = error => ({ name: error.name, message: error.message, code: error.code, stack: error.stack })

async function preserveBusinessFailure(report, action, cleanup, save) {
  let primary, value
  try { value = await action() } catch (error) { primary = error; report.error = errorRecord(error) }
  try { await cleanup() } catch (error) { (report.secondaryErrors ??= []).push({ stage: 'owned-cleanup', ...errorRecord(error) }); primary ??= error }
  if (primary) { report.complete = false; report.error ??= errorRecord(primary) }
  try { await save() } catch (error) { (report.secondaryErrors ??= []).push({ stage: 'evidence-save', ...errorRecord(error) }); primary ??= error }
  if (primary) throw primary
  return value
}
async function loadCore(file, overrides = {}, directory = path.resolve('out/main')) {
  const { build } = require('esbuild')
  const compiled = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', '__dirname', compiled.outputFiles[0].text)(name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), module, module.exports, directory)
  return module.exports
}
function ownChild(child, label) {
  const ledger = { label, pid: child.pid, startedAt: new Date().toISOString(), events: [] }
  let done
  const closed = new Promise(resolve => { done = resolve })
  child.once('exit', (code, signal) => ledger.events.push({ event: 'exit', at: Date.now(), code, signal }))
  child.once('close', (code, signal) => { Object.assign(ledger, { closed: true, code, signal }); ledger.events.push({ event: 'close', at: Date.now(), code, signal }); done({ code, signal }) })
  child.once('error', error => { ledger.error = errorRecord(error) })
  return { child, ledger, closed }
}
async function awaitOwnedClose(track, timeoutMs = 10000) {
  let timer
  try { return await Promise.race([track.closed, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(track.ledger.label + ' close timed out')), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}
async function stopOwnedChild(track) {
  if (track.ledger.closed) return
  if (track.child.exitCode === null && track.child.signalCode === null) {
    assert.equal(track.child.pid, track.ledger.pid)
    track.ledger.events.push({ event: 'owned-SIGTERM', at: Date.now() }); track.child.kill('SIGTERM')
  }
  await awaitOwnedClose(track)
}

function selectOwnedExecutable(rows, expected) {
  const matches = rows.filter(row => row.exe === expected.exe && row.uid === expected.uid && /^\d+$/.test(row.startTime))
  const ids = new Set(matches.map(row => row.pid)), mains = matches.filter(row => !ids.has(row.ppid))
  assert(mains.length <= 1, 'Refuse multiple instances at the private update executable')
  return mains[0] ?? null
}
function processIdentity(pid) {
  try {
    const directory = '/proc/' + pid, raw = fs.readFileSync(directory + '/stat', 'utf8'), fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/)
    return { pid: Number(pid), ppid: Number(fields[1]), uid: fs.statSync(directory).uid, exe: fs.readlinkSync(directory + '/exe'), state: fields[0], startTime: fields[19] }
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error }
}
async function freePort() {
  const server = require('node:net').createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port
  await new Promise(resolve => server.close(resolve)); return port
}
async function verifyPackagedUpdate(root, report, tracks, proof) {
  const transactionRoot = fs.mkdtempSync(path.join(root, "update 中文 § O'Neil-")), rootIdentity = fs.lstatSync(transactionRoot)
  const target = path.join(transactionRoot, 'KAMUCL'), exe = path.join(target, 'kamucl')
  const archive = path.resolve('release', 'KAMUCL-' + report.version + '-linux-' + process.arch + '.tar.gz')
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', transactionRoot], { timeout: 60000 })
  const baselineHash = sha(path.join(target, 'resources/app.asar'))
  const packagedJSON = JSON.parse(require('@electron/asar').extractFile(path.join(target, 'resources/app.asar'), 'package.json').toString('utf8'))
  const applicationName = packagedJSON.productName || packagedJSON.name
  assert(typeof applicationName === 'string' && applicationName === path.basename(applicationName) && !applicationName.includes('\\'), 'Actual packaged application name must be a safe profile component')
  const config = path.join(transactionRoot, 'config'), profile = path.join(config, applicationName)
  fs.mkdirSync(profile, { recursive: true }); fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ autoUpdate: false, theme: 'black-orange' }))
  const env = { ...process.env, HOME: transactionRoot, XDG_CONFIG_HOME: config, XDG_DATA_HOME: path.join(transactionRoot, 'data'), XDG_CACHE_HOME: path.join(transactionRoot, 'cache') }
  delete env.ELECTRON_RUN_AS_NODE; delete env.APPIMAGE; delete env.APPDIR; delete env.APPIMAGE_EXTRACT_AND_RUN
  const sockets = [], launched = []; let relaunched, actualProfile
  const observerEvents = []
  const observe = event => { observerEvents.push(event); fs.writeFileSync(path.join(proof, 'packaged-update-observations.json'), JSON.stringify({ nativeDesktop: false, events: observerEvents }, null, 2)) }
  const privateIdentity = () => { const current = fs.lstatSync(transactionRoot); assert(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, rootIdentity.dev); assert.equal(current.ino, rootIdentity.ino) }
  const ownedRestart = () => {
    privateIdentity()
    // Only executable symlinks are inspected. No other process argv/env is read.
    const rows = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
      try { const directory = '/proc/' + name; if (fs.statSync(directory).uid !== process.getuid() || fs.readlinkSync(directory + '/exe') !== exe) return []; const row = processIdentity(Number(name)); return row ? [row] : [] }
      catch (error) { if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return []; throw error }
    })
    return selectOwnedExecutable(rows, { exe, uid: process.getuid() })
  }
  const stopRestart = async () => {
    if (!relaunched) return
    privateIdentity(); const current = processIdentity(relaunched.pid)
    if (current && current.state !== 'Z') {
      assert.equal(current.exe, exe); assert.equal(current.uid, process.getuid()); assert.equal(current.startTime, relaunched.startTime)
      process.kill(current.pid, 'SIGTERM')
      for (let i = 0; i < 120; i++) { const later = processIdentity(current.pid); if (!later || later.state === 'Z') { relaunched = null; return } assert.equal(later.startTime, current.startTime); await wait(100) }
      throw Error('Owned updated launcher did not exit after SIGTERM')
    }
    relaunched = null
  }
  async function start() {
    const mainPort = await freePort(), rendererPort = await freePort()
    const descriptor = fs.openSync(path.join(proof, 'packaged-update-' + launched.length + '.log'), 'wx')
    const child = spawn(exe, ['--inspect=127.0.0.1:' + mainPort, '--remote-debugging-port=' + rendererPort], { env, stdio: ['ignore', descriptor, descriptor] }); fs.closeSync(descriptor)
    const track = ownChild(child, 'packaged Linux update launcher ' + launched.length); tracks.push(track); launched.push(track)
    const deadline = Date.now() + 30000
    let mainTarget, rendererTarget
    for (let i = 0; i < 120 && Date.now() < deadline; i++) {
      assert.equal(child.exitCode, null, 'Update test launcher exited before IPC was ready')
      try { mainTarget = (await (await fetch('http://127.0.0.1:' + mainPort + '/json', { signal: AbortSignal.timeout(1000) })).json())[0]; rendererTarget = (await (await fetch('http://127.0.0.1:' + rendererPort + '/json', { signal: AbortSignal.timeout(1000) })).json()).find(page => page.url.includes('/renderer/index.html')); if (mainTarget && rendererTarget) break } catch {}
      await wait(250)
    }
    assert(mainTarget && rendererTarget, 'Actual packaged update IPC unavailable')
    const owned = { ownedPid: child.pid, ownedChild: child, deadline, observe }
    const main = await openOwnedInspector({ url: mainTarget.webSocketDebuggerUrl, port: mainPort, role: 'main', ...owned }); sockets.push(main.socket)
    const identity = await main.evaluate("({pid:process.pid,platform:process.platform,arch:process.arch,exe:process.execPath,name:process.mainModule.require('electron').app.getName(),userData:process.mainModule.require('electron').app.getPath('userData')})", { startupDeadline: true })
    assert.equal(identity.pid, child.pid); assert.equal(identity.exe, exe); assert.equal(identity.platform, 'linux'); assert.equal(identity.arch, process.arch)
    assert.equal(identity.name, applicationName); assert.equal(identity.userData, profile); actualProfile = identity.userData
    const renderer = await openOwnedInspector({ url: rendererTarget.webSocketDebuggerUrl, port: rendererPort, rendererURL: rendererTarget.url, role: 'renderer', ...owned }); sockets.push(renderer.socket)
    for (let i = 0; i < 80 && Date.now() < deadline; i++) { if (await renderer.evaluate("!!window.kamucl?.invoke && document.body?.innerText.includes('" + report.version + "')" , { startupDeadline: true })) return { track, renderer, main }; await wait(250) }
    throw Error('Actual renderer did not expose its production IPC')
  }
  const marker = path.join(profile, 'linux-update.json'), claim = marker + '.applying'
  const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
  async function startApplying() {
    const descriptor = fs.openSync(path.join(proof, 'packaged-update-applying-' + launched.length + '.log'), 'wx')
    const child = spawn(exe, [], { env, stdio: ['ignore', descriptor, descriptor] }); fs.closeSync(descriptor)
    const track = ownChild(child, 'packaged Linux update handoff ' + launched.length); launched.push(track); tracks.push(track)
    assert.equal((await awaitOwnedClose(track, 15000)).code, 0, 'The startup handoff must exit once')
    for (let i = 0; i < 400; i++) {
      if (fs.existsSync(claim + '.completed') && json(path.join(profile, 'update-state.json')).result === 'ok') { relaunched = ownedRestart(); assert(relaunched, 'Confirmed update did not leave its own application running'); return { transaction: json(claim + '.completed'), state: json(path.join(profile, 'update-state.json')), ownedProcess: relaunched } }
      if (fs.existsSync(claim + '.failed')) throw Error('Actual updater rejected its transaction: ' + fs.readFileSync(path.join(profile, 'linux-updater.log'), 'utf8'))
      await wait(250)
    }
    relaunched = ownedRestart(); throw Error('Actual packaged update acknowledgement timed out; original helper timeout remains unchanged')
  }
  const result = { name: 'actual packaged portable update, tamper rejection and retained-backup rollback', passed: false, publicOnlineUpdate: false, crossVersionUpdate: false, mode: 'local same version', nativeDesktop: false }
  await preserveBusinessFailure(result, async () => {
    let current = await start()
    await current.renderer.evaluate("window.kamucl.invoke('update:applyLocal'," + JSON.stringify({ filePath: archive }) + ')')
    const staged = json(marker), file = staged.file; assert(file.startsWith(profile + path.sep))
    const logFile = path.join(profile, 'linux-updater.log'), previousLog = fs.existsSync(logFile) ? fs.readFileSync(logFile) : Buffer.alloc(0)
    fs.appendFileSync(file, 'tampered-after-approval'); current.renderer.socket.close(); current.main.socket.close(); await stopOwnedChild(current.track)
    current = await start(); assert(fs.existsSync(claim + '.failed'), 'Tampered local package was not rejected'); assert.equal(json(claim + '.failed').id, staged.id)
    assert.equal(sha(path.join(target, 'resources/app.asar')), baselineHash, 'Rejecting a tampered payload must preserve the original application bytes')
    const flagFile = path.join(profile, 'update-failed.flag'), flag = { observedAt: new Date().toISOString(), state: 'absent' }
    try { flag.text = fs.readFileSync(flagFile, 'utf8'); flag.state = 'present' } catch (error) { if (error.code !== 'ENOENT') throw error }
    result.tamperedTransaction = observeTamperedRejection({ staged, failed: json(claim + '.failed'), actualSize: fs.statSync(file).size, actualSHA256: sha(file), targetSHA256: sha(path.join(target, 'resources/app.asar')), baselineSHA256: baselineHash, previousLog, currentLog: fs.readFileSync(logFile), flag })
    fs.renameSync(claim + '.failed', claim + '.tamper-proof')
    await current.renderer.evaluate("window.kamucl.invoke('update:applyLocal'," + JSON.stringify({ filePath: archive }) + ')')
    const approved = json(marker); current.renderer.socket.close(); current.main.socket.close(); await stopOwnedChild(current.track)
    const installed = await startApplying(); assert.equal(installed.transaction.id, approved.id); assert(fs.lstatSync(installed.state.backupPath).isDirectory()); assert.equal(sha(path.join(target, 'resources/app.asar')), baselineHash)
    result.update = installed; await stopRestart(); fs.renameSync(claim + '.completed', claim + '.update-proof')
    current = await start(); await current.renderer.evaluate("window.kamucl.invoke('update:restoreBackup')")
    assert.equal(json(marker).mode, 'rollback'); const rollback = json(marker)
    current.renderer.socket.close(); current.main.socket.close(); await stopOwnedChild(current.track)
    result.rollback = await startApplying(); assert.equal(result.rollback.transaction.id, rollback.id); assert.equal(result.rollback.transaction.mode, 'rollback'); assert.equal(sha(path.join(target, 'resources/app.asar')), baselineHash)
    result.passed = true; result.complete = true
  }, async () => {
    for (const socket of sockets) socket.close()
    const cleanupErrors = []
    try { if (!relaunched) relaunched = ownedRestart(); await stopRestart() } catch (error) { cleanupErrors.push(error) }
    for (const track of launched) try { await stopOwnedChild(track) } catch (error) { cleanupErrors.push(error) }
    try { if (actualProfile && fs.existsSync(path.join(actualProfile, 'linux-updater.log'))) fs.copyFileSync(path.join(actualProfile, 'linux-updater.log'), path.join(proof, 'actual-updater.log'), fs.constants.COPYFILE_EXCL) } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Owned update cleanup errors; every owned child was considered')
  }, () => fs.writeFileSync(path.join(proof, 'actual-update.json'), JSON.stringify(result, null, 2)))
  return result
}

function packagedWindowDirectories(application) {
  return {
    logicalDirectory: path.join(application, 'resources', 'app.asar', 'out', 'main'),
    helperDirectory: path.join(application, 'resources', 'app.asar.unpacked', 'out', 'main')
  }
}
async function verifyOwnedX11(root, report, tracks) {
  assert(process.env.DISPLAY, 'This native window protocol fixture requires X11/XWayland')
  const applicationRoot = fs.mkdtempSync(path.join(root, 'packaged-window-helper-'))
  execFileSync('/usr/bin/tar', ['-xzf', path.resolve('release', 'KAMUCL-' + report.version + '-linux-' + process.arch + '.tar.gz'), '-C', applicationRoot], { timeout: 60000 })
  const application = path.join(applicationRoot, 'KAMUCL')
  const metadata = JSON.parse(fs.readFileSync(path.join(application, 'resources/kamucl-linux.json'), 'utf8'))
  assert.equal(metadata.sourceCommit, report.sourceCommit); assert.equal(metadata.arch, report.arch); assert.equal(metadata.runtimeVersion, report.electron)
  const { logicalDirectory, helperDirectory } = packagedWindowDirectories(application)
  const helper = path.join(helperDirectory, 'LinuxGameWindow')
  const source = `#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <unistd.h>
#include <iostream>
int main(){Display*d=XOpenDisplay(nullptr);if(!d)return 2;Window w=XCreateSimpleWindow(d,DefaultRootWindow(d),30,30,320,200,0,0,0xffffff);unsigned long pid=getpid();XChangeProperty(d,w,XInternAtom(d,"_NET_WM_PID",False),XA_CARDINAL,32,PropModeReplace,(unsigned char*)&pid,1);Atom del=XInternAtom(d,"WM_DELETE_WINDOW",False);XSetWMProtocols(d,w,&del,1);XStoreName(d,w,"KAMUCL owned Linux protocol fixture");XMapWindow(d,w);XFlush(d);std::cout<<"READY "<<pid<<" "<<w<<std::endl;for(;;){XEvent e;XNextEvent(d,&e);if(e.type==ClientMessage&&e.xclient.message_type==XInternAtom(d,"WM_PROTOCOLS",False)&&Atom(e.xclient.data.l[0])==del){std::cout<<"NORMAL WM_DELETE_WINDOW"<<std::endl;XDestroyWindow(d,w);XCloseDisplay(d);return 0;}}}`
  const sourceFile = path.join(root, 'owned-window.cpp'), executable = path.join(root, 'owned-window')
  fs.writeFileSync(sourceFile, source); execFileSync('g++', ['-std=c++17', sourceFile, '-lX11', '-o', executable], { timeout: 60000 })
  // Production __dirname is inside the ASAR. The product resolves its unpacked
  // native helper once; supplying an already-unpacked directory would map twice.
  const windows = await loadCore('src/main/core/gracefulClose.ts', {}, logicalDirectory)
  const rows = []
  for (let n = 0; n < 2; n++) {
    const child = spawn(executable, [], { stdio: ['ignore', 'pipe', 'pipe'] }), track = ownChild(child, 'owned X11 protocol window ' + n)
    tracks.push(track); let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
    for (let i = 0; i < 100 && !stdout.includes('READY'); i++) { assert.equal(child.exitCode, null); await wait(50) }
    assert(stdout.includes('READY'), 'Fixture window did not initialize: ' + stderr)
    rows.push({ child, track, output: () => stdout })
  }
  const [game, independent] = rows
  await windows.focusGameWindow(game.child, 10000)
  const active = execFileSync('xprop', ['-root', '_NET_ACTIVE_WINDOW'], { encoding: 'utf8' })
  const gameWindow = Number(game.output().trim().split(/\s+/)[2])
  assert.equal(Number(active.match(/0x[a-f\d]+/i)?.[0]), gameWindow)
  let noDisplay
  try { execFileSync(helper, ['focus', String(game.child.pid), '1000'], { env: { ...process.env, DISPLAY: ':59999' }, stdio: 'pipe', timeout: 3000 }) } catch (error) { noDisplay = { status: error.status, error: error.stderr.toString().trim() } }
  assert.equal(noDisplay?.status, 4); assert.equal(game.child.exitCode, null); assert.equal(independent.child.exitCode, null)
  await windows.requestGameWindowClose(game.child); const gameClose = await awaitOwnedClose(game.track)
  assert.equal(gameClose.code, 0); assert(game.output().includes('NORMAL WM_DELETE_WINDOW')); assert.equal(independent.child.exitCode, null)
  await windows.requestGameWindowClose(independent.child); assert.equal((await awaitOwnedClose(independent.track)).code, 0)
  return { name: 'actual packaged X11 helper and product backend focus/normal close/no-display failure', passed: true, actualMinecraft: false, virtualDisplayFixture: true, nativeDesktop: false, helperSHA256: sha(helper), fixtureSourceSHA256: sha(sourceFile), packageIdentity: metadata, game: game.track.ledger, independent: independent.track.ledger, otherWindowPreserved: true, noDisplay }
}

async function main() {
  const { app, safeStorage } = require('electron')
  assert.equal(process.platform, 'linux'); assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This harness requires a disposable CI account')
  assert.notEqual(process.getuid(), 0, 'Do not disable Chromium sandbox or run the launcher as root')
  assert.equal(process.arch, process.argv[2]); assert(['x64', 'arm64'].includes(process.arch))
  fs.mkdirSync(path.resolve('out'), { recursive: true })
  const root = fs.mkdtempSync(path.resolve('out/linux-business-')), proof = path.resolve('release/linux-business-proof-' + process.arch + '-' + Date.now())
  fs.mkdirSync(proof, { recursive: true }); fs.mkdirSync(path.join(root, 'config')); app.setPath('appData', path.join(root, 'config')); app.setPath('userData', root)
  const report = { version: require('../package.json').version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), platform: process.platform, arch: process.arch, electron: process.versions.electron, qaEntry: { argv: [...process.argv], moduleFile: module.filename, requireMainFile: require.main?.filename ?? null, requireMainEqualsModule: require.main === module, matchedRequestedEntry: require('./qa-entry.cjs').isQaMain(module, require.main), type: process.type, runAsNode: !!process.env.ELECTRON_RUN_AS_NODE }, nativeExecution: true, sourceHarness: true, nativeDesktop: false, complete: false, steps: [], uncovered: ['real authorized account login', 'GNOME Keyring/KWallet lock-unlock and restart on actual desktop', 'system DEB installer confirmation, cancellation and upgrade', 'normal FUSE AppImage update', 'public online cross-version update', 'actual Minecraft window/world', 'hardware GPU and visual/motion parity'] }
  const save = () => fs.writeFileSync(path.join(proof, 'verification.json'), JSON.stringify(report, null, 2))
  const tracks = []
  await app.whenReady()
  await preserveBusinessFailure(report, async () => {
    assert.equal(process.versions.electron, require('../package.json').devDependencies.electron)
    const settings = await loadCore('src/main/core/settings.ts')
    const games = path.join(root, "games 中文 § O'Neil"); fs.mkdirSync(games)
    const saved = settings.saveSettings({ activeFolder: games, gameDir: games, autoUpdate: false, theme: 'black-orange' })
    assert.equal(saved.gameDir, games); assert.equal(saved.autoUpdate, false)
    const reloaded = await loadCore('src/main/core/settings.ts'); assert.equal(reloaded.getSettings().gameDir, games)
    report.steps.push({ name: 'real Linux settings persistence and special path', passed: true })
    const accounts = await loadCore('src/main/core/accounts.ts')
    const status = accounts.accountStorageStatus(), backend = safeStorage.getSelectedStorageBackend()
    const account = accounts.addOffline('LinuxNativeFixture'); accounts.selectAccount(account.id)
    assert.equal(accounts.selectedAccount().id, account.id)
    const disk = fs.readFileSync(path.join(root, 'accounts.json'), 'utf8')
    assert(!disk.includes(account.accessToken), 'A login token must not be persisted in plaintext')
    const again = await loadCore('src/main/core/accounts.ts')
    assert.equal(again.selectedAccount().id, account.id)
    if (['basic_text', 'unknown', ''].includes(backend)) {
      assert.equal(status.sessionOnly, true); assert(!again.selectedAccount().accessToken)
    } else {
      assert.equal(status.persistent, true); assert.equal(again.selectedAccount().accessToken, account.accessToken)
    }
    await accounts.removeAccount(account.id); assert.equal(accounts.listAccounts().length, 0)
    report.steps.push({ name: 'actual safeStorage backend and account persistence policy', passed: true, backend, status, actualKeyringLockCycle: false })
    const favorites = await loadCore('src/main/core/modFavorites.ts')
    const favorite = { source: 'modrinth', projectId: 'fixture-project', name: 'Linux 收藏 fixture', iconUrl: 'https://cdn.modrinth.com/data/fixture/icon.png' }
    favorites.setFavorite(favorite, true); favorites.setFavorite(favorite, true)
    assert.equal(favorites.modFavorites().length, 1)
    assert.equal(favorites.modFavorites()[0].iconUrl, favorite.iconUrl)
    const favoritesAgain = await loadCore('src/main/core/modFavorites.ts'); assert.equal(favoritesAgain.modFavorites().length, 1)
    favoritesAgain.setFavorite(favorite, false); assert.equal(favoritesAgain.modFavorites().length, 0)
    report.steps.push({ name: 'favorite filesystem deduplication, icon and restart', passed: true, realCommunityService: false })
    const native = await loadCore('src/main/core/linuxUpdateIdentity.ts')
    // Verify the actual running Electron ELF, not a generated machine header.
    native.assertLinuxElf(fs.readFileSync(process.execPath).subarray(0, 64), process.arch)
    await assert.rejects(Promise.resolve().then(() => native.assertLinuxElf(fs.readFileSync(process.execPath).subarray(0, 64), process.arch === 'x64' ? 'arm64' : 'x64')))
    report.steps.push({ name: 'actual runtime ELF architecture and opposite-ABI rejection', passed: true, executableSHA256: sha(process.execPath) })
    const updates = await loadCore('src/main/core/linuxUpdate.ts')
    const prefix = 'KAMUCL-' + report.version + '-linux-' + process.arch
    const payloads = ['tar.gz', 'AppImage', 'deb'].map(format => ({ format, file: path.resolve('release', prefix + '.' + format) }))
    for (const payload of payloads) {
      assert(fs.lstatSync(payload.file).isFile())
      if (payload.format === 'tar.gz') await updates.validateLinuxArchive(payload.file)
      if (payload.format === 'AppImage') await updates.verifyLinuxAppImage(payload.file, report.version)
      if (payload.format === 'deb') await updates.verifyLinuxDeb(payload.file, report.version)
    }
    const transaction = await loadCore('src/main/core/updateTransaction.ts')
    const original = payloads[0].file, corrupt = path.join(root, 'tampered-package.tar.gz')
    fs.copyFileSync(original, corrupt); const oldHash = sha(corrupt), size = fs.statSync(corrupt).size
    const fd = fs.openSync(corrupt, 'r+'); const byte = Buffer.alloc(1); fs.readSync(fd, byte, 0, 1, 100); byte[0] ^= 1; fs.writeSync(fd, byte, 0, 1, 100); fs.closeSync(fd)
    await assert.rejects(transaction.validateUpdatePayload({ file: corrupt, sha256: oldHash, size }), /SHA256/)
    report.steps.push({ name: 'actual three-format update identity/ABI validation and byte tamper rejection', passed: true, payloads: payloads.map(p => ({ format: p.format, name: path.basename(p.file), bytes: fs.statSync(p.file).size, sha256: sha(p.file) })), appliedUpdate: false })
    // Run the real detached spawn backend. No launcher exit or process-name kill.
    const windows = await loadCore('src/main/core/gracefulClose.ts')
    const java = await windows.spawnGameProcess('/usr/bin/env', ['ELECTRON_RUN_AS_NODE=1', process.execPath, '-e', 'process.stdout.write("owned-ready\\n");setTimeout(()=>process.exit(0),200)'], { cwd: games })
    const track = ownChild(java, 'native detached game-process backend'); tracks.push(track)
    let output = ''; java.stdout.on('data', data => { output += data })
    const closed = await awaitOwnedClose(track)
    assert.equal(closed.code, 0); assert.equal(output, 'owned-ready\n')
    report.steps.push({ name: 'real detached process backend, stdout and normal exit', passed: true, child: track.ledger, actualMinecraft: false })
    report.steps.push(await verifyOwnedX11(root, report, tracks))
    report.steps.push(await verifyPackagedUpdate(root, report, tracks, proof))
    report.complete = true
  }, async () => { for (const track of tracks) await stopOwnedChild(track) }, save)
  console.log('PASS native Linux business harness; desktop and real account qualification remain uncovered')
  app.exit(0)
}
module.exports = { preserveBusinessFailure, loadCore, ownChild, awaitOwnedClose, stopOwnedChild, selectOwnedExecutable, packagedWindowDirectories }
if (require('./qa-entry.cjs').isQaMain(module, require.main)) main().catch(error => { console.error(error); require('electron').app.exit(1) })
