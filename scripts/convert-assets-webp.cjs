// 一次性 PNG→WebP 资源转换工具（构建期专用：sharp 仅作 devDependency，不会进发布包）。
// 用法：node scripts/convert-assets-webp.cjs [相对路径 ...]
//   缺省转换 renderer 内置 banner 三图；转换后需手动更新引用并删除旧 PNG。
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_TARGETS = [
  'src/renderer/src/assets/banner1.png',
  'src/renderer/src/assets/banner2.png',
  'src/renderer/src/assets/banner3.png'
]

async function main() {
  const sharp = require('sharp')
  const root = path.resolve(__dirname, '..')
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS
  let before = 0
  let after = 0
  for (const target of targets) {
    const source = path.resolve(root, target)
    if (!/\.png$/i.test(source)) throw new Error(`仅支持 PNG 输入：${target}`)
    if (!fs.existsSync(source)) throw new Error(`文件不存在：${target}`)
    const destination = source.replace(/\.png$/i, '.webp')
    const sourceStat = fs.statSync(source)
    // 质量 85 + effort 6：展示图视觉无损，alpha 自动保留
    await sharp(source).webp({ quality: 85, effort: 6 }).toFile(destination)
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
