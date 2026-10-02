// Use the portable payload's solid compression in a standard, Explorer-readable ZIP.
// The wrapper remains intact, including its versioned cache and self-update identity.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const Zip = require('adm-zip')

async function packWindowsZip(root = path.resolve(__dirname, '..')) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const name = `KAMUCL-${version}.exe`
  const exe = fs.readFileSync(path.join(root, 'release', name))
  assert.equal(exe.subarray(0, 2).toString(), 'MZ', 'Portable EXE is missing or invalid')
  const zip = new Zip()
  zip.addFile(name, exe)
  // Recompressing an already solid-compressed EXE only wastes build/extraction time.
  zip.getEntry(name).header.method = 0
  zip.addFile('README.txt', Buffer.from(`KAMUCL ${version} - Windows x64\r\n\r\n请先解压 ZIP 到可写文件夹，再运行 ${name}。\r\n首次运行会在 EXE 旁的 KAMUCL-runtime 文件夹展开内置运行组件；之后复用缓存。\r\n移动启动器时可一起移动该文件夹。所有运行组件已包含，无需额外下载。\r\nZIP 内 EXE 与单独下载的便携 EXE 完全相同，支持自动更新。\r\n该优化缩小下载文件，展开后的运行组件仍占用磁盘空间。\r\n\r\nExtract the ZIP to a writable folder, then run ${name}.\r\nThe first launch extracts the bundled runtime next to the EXE; later launches reuse it.\r\nNo runtime download is required. Keep KAMUCL-runtime beside the EXE when moving it.\r\n`))
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/CORRESPONDING_SOURCE.md',
    ...fs.readdirSync(path.join(root, 'licenses')).map(n => `licenses/${n}`)]) {
    zip.addFile(file, fs.readFileSync(path.join(root, file)))
  }
  const output = path.join(root, 'release', `KAMUCL-${version}-windows-x64.zip`)
  zip.writeZip(output)
  const hash = data => crypto.createHash('sha256').update(data).digest('hex')
  assert.equal(hash(new Zip(output).readFile(name)), hash(exe), 'ZIP changed the portable EXE')
  const report = { output, bytes: fs.statSync(output).size, portableBytes: exe.length, portableSHA256: hash(exe) }
  console.log(JSON.stringify(report))
  // Preserve the original direct-extraction fallback for machines where NSIS
  // self-extraction cannot run. It is explicitly named and not the compact ZIP.
  const unpacked = path.join(root, 'release', `KAMUCL-${version}-windows-x64-unpacked.zip`)
  await require('app-builder-lib/out/targets/archive').archive('zip', unpacked, path.join(root, 'release/win-unpacked'), {
    withoutDir: true, compression: 'maximum'
  })
  console.log(JSON.stringify({ unpacked, bytes: fs.statSync(unpacked).size }))
  return report
}
module.exports = { packWindowsZip }
if (require.main === module) packWindowsZip().catch(error => { console.error(error); process.exitCode = 1 })
