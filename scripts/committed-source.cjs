// Source distributions use committed blobs, not platform-dependent checkout bytes.
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

function readCommittedSource(root) {
  root = path.resolve(root)
  const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 96 * 1024 * 1024 })
  const commit = git(['rev-parse', 'HEAD']).toString('utf8').trim()
  const requireClean = () => {
    const dirty = spawnSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: root })
    if (dirty.error) throw dirty.error
    if (dirty.status !== 0) throw Error('Commit tracked source before packaging or auditing delivery')
  }
  requireClean()
  const rows = git(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) (\w+) ([a-f\d]+)\t([\s\S]+)$/.exec(row)
    if (!match || !['100644', '100755'].includes(match[1]) || match[2] !== 'blob') throw Error('Source must be a committed ordinary file: ' + row)
    const file = match[4], parts = file.split('/')
    if (file.includes('\\') || file.startsWith('/') || parts[0].includes(':') || parts.some(p => !p || p === '.' || p === '..')) throw Error('Unsafe committed source path: ' + file)
    return { path: file, oid: match[3] }
  })
  if (!rows.length) throw Error('No committed source files')
  const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: rows.map(r => r.oid).join('\n') + '\n', maxBuffer: 96 * 1024 * 1024 })
  let offset = 0
  const files = rows.map(row => {
    const end = batch.indexOf(10, offset)
    if (end < 0) throw Error('Incomplete committed blob header')
    const header = batch.subarray(offset, end).toString('ascii').split(' '), size = Number(header[2])
    if (header[0] !== row.oid || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw Error('Unexpected committed blob')
    offset = end + 1
    if (offset + size >= batch.length || batch[offset + size] !== 10) throw Error('Incomplete committed blob content')
    const bytes = Buffer.from(batch.subarray(offset, offset + size)); offset += size + 1
    return { path: row.path, oid: row.oid, bytes }
  })
  if (offset !== batch.length || git(['rev-parse', 'HEAD']).toString('utf8').trim() !== commit) throw Error('Committed source changed during packaging')
  requireClean()
  return { commit, files }
}

module.exports = { readCommittedSource }
