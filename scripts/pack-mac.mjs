// Native packaging preserves dependencies, executable modes, Mach-O signatures and symlinks.
import { execFileSync } from 'node:child_process'
import fs, { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { IDENTITY_FILE, createMacIdentity } = require('./mac-package-identity.cjs')
const { preserveRuntimeNotices, verifyRuntimeNotices } = require('./mac-runtime-notices.cjs')
if (process.platform !== 'darwin') throw new Error('Mac 包必须在对应架构的 macOS 13+ 构建和验证。')
const args = process.argv.slice(2), packageOnly = args.includes('--package-only')
if (args.some(arg => arg.startsWith('--') && arg !== '--package-only')) throw new Error('Unknown Mac packaging option')
const arch = args.find(arg => !arg.startsWith('--')) || process.arch
if (arch !== process.arch || !['arm64', 'x64'].includes(arch)) throw new Error('请在对应架构的 Mac 上打包并验证。')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const runtimeVersion = require('electron/package.json').version
if (runtimeVersion !== pkg.devDependencies.electron) throw new Error('Installed Electron must match the shared locked application runtime')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
const output = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const sha = async file => { const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
run('node', ['scripts/build-bridge.cjs'])
run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--mac', 'dir', `--${arch}`, '--publish', 'never'])
const bundle = `release/mac${arch === 'arm64' ? '-arm64' : ''}/KAMUCL.app`
run('lipo', [path.join(bundle, 'Contents/MacOS/KAMUCL'), '-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64'])
run('lipo', [path.join(bundle, 'Contents/Resources/app.asar.unpacked/out/main/MacGameWindow'), '-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64'])
const minimum = output('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', path.join(bundle, 'Contents/Info.plist')])
if (Number(minimum.split('.')[0]) !== 13) throw new Error('Mac package must advertise the approved macOS 13+ minimum')
const frameworkVersion = output('plutil', ['-extract', 'CFBundleVersion', 'raw', path.join(bundle, 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist')])
if (frameworkVersion !== runtimeVersion) throw new Error('Packaged Electron framework differs from the shared runtime')
const { version } = pkg
const sourceCommit = output('git', ['rev-parse', 'HEAD'])
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sourceCommit) throw new Error('CI checkout differs from the declared build source')
const appAsarSHA256 = await sha(path.join(bundle, 'Contents/Resources/app.asar'))
const runtimeNotices = preserveRuntimeNotices(path.resolve('node_modules/electron/dist'), path.join(bundle, 'Contents/Resources'))
const buildIdentity = createMacIdentity({ version, arch, sourceCommit, runtimeVersion: frameworkVersion, minimumSystemVersion: minimum, appAsarSHA256, runtimeNotices })
const identityFile = path.join(bundle, 'Contents/Resources', IDENTITY_FILE)
fs.writeFileSync(identityFile, JSON.stringify(buildIdentity, null, 2) + '\n')
// Embedded provenance is covered by the final Resources signature and both archives.
run('codesign', ['--force', '--deep', '--sign', '-', bundle])
run('codesign', ['--verify', '--deep', '--strict', bundle])
verifyRuntimeNotices(path.join(bundle, 'Contents/Resources'), runtimeNotices)
const buildIdentitySHA256 = await sha(identityFile)
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, `release/KAMUCL-${version}-mac-${arch}.zip`])
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL DMG stage '))
run('ditto',[bundle,path.join(stage,'KAMUCL.app')]);verifyRuntimeNotices(path.join(stage,'KAMUCL.app/Contents/Resources'),runtimeNotices);fs.symlinkSync('/Applications',path.join(stage,'Applications'))
fs.writeFileSync(path.join(stage,'安装说明.txt'),'适用于 macOS 13 及以上。将 KAMUCL.app 拖入 Applications。此包使用本地临时签名，尚未进行 Apple Developer ID 签名及公证；首次打开可能需要在系统设置 → 隐私与安全性中确认。\n')
const dmg=`release/KAMUCL-${version}-mac-${arch}.dmg`
run('hdiutil',['create','-ov','-volname',`KAMUCL ${arch}`,'-srcfolder',stage,'-format','UDZO','-fs','HFS+',dmg]);run('hdiutil',['verify',dmg])
const files=[`KAMUCL-${version}-mac-${arch}.zip`,path.basename(dmg)],assets=[]
for(const file of files)assets.push({name:file,bytes:fs.statSync(path.join('release',file)).size,sha256:await sha(path.join('release',file))})
fs.writeFileSync(`release/SHA256SUMS-mac-${arch}.txt`,assets.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n')
fs.writeFileSync(`release/mac-package-${arch}.json`,JSON.stringify({version,arch,commit:sourceCommit,runtimeVersion,frameworkVersion,minimum,signing:'ad-hoc; not Developer ID or notarized',packageIntegrity:true,nativeAcceptance:'separate required native APP/DMG/game/tools/update jobs',appAsarSHA256,buildIdentity,buildIdentitySHA256,runtimeNotices,assets},null,2))
if(!packageOnly){
 run('node',['scripts/verify-mac.cjs',bundle,arch,'app'])
 const mount=fs.mkdtempSync(path.join(os.tmpdir(),'KAMUCL DMG mount '))
 run('hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount])
 try{run('node',['scripts/verify-mac.cjs',path.join(mount,'KAMUCL.app'),arch,'dmg'])}finally{run('hdiutil',['detach',mount])}
 if(process.env.GITHUB_ACTIONS==='true'){run('node',['scripts/verify-mac-game.cjs',bundle,arch]);run('node',['scripts/verify-mac-extra.cjs',bundle,arch])}
}
