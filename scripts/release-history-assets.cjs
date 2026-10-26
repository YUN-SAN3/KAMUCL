const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')

// Historical evidence may exceed one GitHub asset. Each part is an independent
// ZIP with its own manifest; never publish an incomplete or ambiguous sequence.
module.exports = function historyAssets(directory, version) {
  const prefix = `KAMUCL-${version}-validation-history`
  const names = fs.readdirSync(directory)
  const single = names.includes(prefix + '.zip')
  const indexName = prefix + '-index.json'
  const hasIndex = names.includes(indexName)
  const parts = names.filter(name => name.startsWith(prefix + '-part') && name.endsWith('.zip')).sort()
  if (single && (parts.length || hasIndex)) throw Error('历史证据单包与分包并存，停止发布')
  if (parts.length || hasIndex) {
    if (!hasIndex) throw Error('历史证据分包缺少完整索引，停止发布')
    const index = JSON.parse(fs.readFileSync(path.join(directory, indexName), 'utf8'))
    if (index.version !== version || !index.complete || !Array.isArray(index.archives) || !index.archives.length || index.archives.length !== parts.length) throw Error('历史证据分包索引不完整，停止发布')
    for (let position = 0; position < parts.length; position++) {
      const item = index.archives[position], file = path.join(directory, parts[position])
      if (item.name !== parts[position] || item.bytes !== fs.statSync(file).size || item.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')) throw Error('历史证据分包与索引不一致：' + parts[position])
    }
  }
  for (let index = 0; index < parts.length; index++) {
    const expected = `${prefix}-part${String(index + 1).padStart(3, '0')}.zip`
    if (parts[index] !== expected) throw Error('历史证据分包序号不连续：' + expected)
  }
  return (single ? [prefix + '.zip'] : hasIndex ? [indexName, ...parts] : []).map(name => path.join(directory, name))
}
