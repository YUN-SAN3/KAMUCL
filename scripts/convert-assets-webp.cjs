// 一次性 PNG→WebP 资源转换工具（构建期专用：sharp 仅作 devDependency，不会进发布包）。
// 用法：node scripts/convert-assets-webp.cjs [相对路径 ...]
// 显式指定 PNG 输入；保留原 PNG，转换后按实际用途更新引用。
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const sharp = require('sharp')
  const root = path.resolve(__dirname, '..')
  const targets = process.argv.slice(2)
  if (!targets.length) throw new Error('请显式指定 PNG 路径：node scripts/convert-assets-webp.cjs <图片.png> ...')
  let before = 0
  let after = 0
  for (const target of targets) {
    const source = path.resolve(root, target)
    if (!/\.png$/i.test(source)) throw new Error(`仅支持 PNG 输入：${target}`)
    if (!fs.existsSync(source)) throw new Error(`文件不存在：${target}`)
    const destination = source.replace(/\.png$/i, '.webp')
    const sourceStat = fs.statSync(source)
    await sharp(source).webp({ lossless: true, effort: 6 }).toFile(destination)
    const destinationStat = fs.statSync(destination)
    before += sourceStat.size
    after += destinationStat.size
    console.log(
      `${target}: ${(sourceStat.size / 1024).toFixed(0)}KB -> ` +
      `${(destinationStat.size / 1024).toFixed(0)}KB webp`
    )
  }
  console.log(
    `total: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB ` +
    `(-${((before - after) / 1024).toFixed(0)}KB)`
  )
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
