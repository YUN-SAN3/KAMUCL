// Native packaging preserves dependencies, executable modes, Mach-O signatures and symlinks.
import { execFileSync } from 'node:child_process'
import fs, { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
if (process.platform !== 'darwin') throw new Error('Mac 包必须在 macOS 构建和签名；请运行 GitHub Actions 的 macOS packages 工作流。')
const arch = process.argv[2] || process.arch
if (arch !== process.arch || !['arm64', 'x64'].includes(arch)) throw new Error('请在对应架构的 Mac 上打包并验证。')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
run('node', ['scripts/build-bridge.cjs'])
run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--mac', 'dir', `--${arch}`, '--config.electronVersion=33.4.11', '--publish', 'never'])
const bundle = `release/mac${arch === 'arm64' ? '-arm64' : ''}/KAMUCL.app`
run('codesign', ['--force', '--deep', '--sign', '-', bundle])
run('codesign', ['--verify', '--deep', '--strict', bundle])
run('node', ['scripts/verify-mac.cjs', bundle, arch])
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, `release/KAMUCL-${version}-mac-${arch}.zip`])
const stage=fs.mkdtempSync(path.resolve('release/mac-dmg-stage-'))
run('ditto',[bundle,path.join(stage,'KAMUCL.app')]);fs.symlinkSync('/Applications',path.join(stage,'Applications'))
fs.writeFileSync(path.join(stage,'安装说明.txt'),'将 KAMUCL.app 拖入 Applications。未进行 Apple 开发者签名及公证；首次打开可在系统设置 → 隐私与安全性中确认。\n')
const dmg=`release/KAMUCL-${version}-mac-${arch}.dmg`
run('hdiutil',['create','-ov','-volname',`KAMUCL ${arch}`,'-srcfolder',stage,'-format','UDZO','-fs','HFS+',dmg]);run('hdiutil',['verify',dmg])
const files=[`KAMUCL-${version}-mac-${arch}.zip`,path.basename(dmg)],sums=[]
for(const file of files){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(path.join('release',file)))hash.update(chunk);sums.push(`${hash.digest('hex')}  ${file}`)}
fs.writeFileSync(`release/SHA256SUMS-mac-${arch}.txt`,sums.join('\n')+'\n')
