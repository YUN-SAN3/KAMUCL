// Test-only synthetic metadata and loopback files. Production IPC, downloads,
// cancellation, checksums, dependency parsing and commits remain untouched.
module.exports = async function attach(config) {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http'), AdmZip = require('adm-zip')
  const electron = require('electron'), { app } = electron
  if (process.pid !== config.pid || fs.realpathSync.native(app.getPath('userData')) !== fs.realpathSync.native(config.profile)) throw Error('Fixture requires the exact owned disposable PID/profile')
  const window = electron.BrowserWindow.fromId(config.windowId)
  if (!window || window.webContents.id !== config.webContentsId) throw Error('Fixture renderer ownership mismatch')
  const approved = fs.realpathSync.native(config.approvedOut), root = path.resolve(config.root)
  if (path.basename(approved) !== 'out' || !root.startsWith(approved + path.sep)) throw Error('Fixture must remain in the explicitly approved workspace out root')
  fs.mkdirSync(root, { recursive: true })
  if (!fs.realpathSync.native(root).startsWith(approved + path.sep)) throw Error('Fixture symlink escapes approved root')
  const protectedChannels = ['mods:prepare', 'mods:commit', 'mods:discard', 'mods:targets', 'tasks:cancel']
  const handlers = protectedChannels.map(channel => [channel, electron.ipcMain._invokeHandlers.get(channel)])
  if (handlers.some(([, handler]) => typeof handler !== 'function')) throw Error('Production MOD IPC handler is absent')
  const requests = [], events = [], tasks = new Set(), cases = [], bytes = new Map()
  let current, closed = false
  const originalSend = window.webContents.send, originalFetch = globalThis.fetch
  const observer = function (channel, payload, ...rest) {
    if (channel === 'event:progress' && payload?.operationId) { tasks.add(payload.taskId); events.push({ at: Date.now(), channel, payload: structuredClone(payload) }) }
    if (channel === 'event:taskDone' && tasks.has(payload?.taskId)) events.push({ at: Date.now(), channel, payload: structuredClone(payload) })
    return originalSend.call(this, channel, payload, ...rest)
  }
  window.webContents.send = observer
  const server = http.createServer((req, res) => {
    const id = decodeURIComponent((req.url || '').slice(1)), stored = bytes.get(id)
    if (!stored) { res.writeHead(404); res.end(); return }
    const mode = stored.mode; let payload = stored.bytes
    if (mode.failHash) { payload = Buffer.from(payload); payload[payload.length - 1] ^= 255 }
    const request = { at: Date.now(), id, unknown: mode.unknown, hashFailure: mode.failHash, sent: 0, completed: false }; requests.push(request)
    res.writeHead(200, mode.unknown ? {} : { 'content-length': payload.length })
    let cursor = 0
    const timer = setInterval(() => {
      const start = cursor; cursor = Math.min(cursor + 32768, payload.length); res.write(payload.subarray(start, cursor)); request.sent = cursor
      if (cursor === payload.length) { clearInterval(timer); request.completed = true; res.end() }
    }, mode.delayMs)
    res.once('close', () => { clearInterval(timer); request.closedAt = Date.now() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const version = id => {
    const entry = bytes.get(id); if (!entry) throw Error('Unknown private metadata project')
    return { id: id + '_v1', project_id: id, version_number: '1.0.0', version_type: 'release', game_versions: ['1.20.1'], loaders: ['fabric'], date_published: '2026-10-07T00:00:00Z', dependencies: entry.dependency ? [{ project_id: entry.dependency, version_id: entry.dependency + '_v1', dependency_type: 'required' }] : [], files: [{ primary: true, filename: entry.fileName, url: base + '/' + id, hashes: { sha1: entry.sha1 }, size: entry.mode.unknown ? 0 : entry.bytes.length }] }
  }
  const wrapper = async function (input, init) {
    const url = new URL(String(input)), official = url.hostname === 'api.modrinth.com' || (url.hostname === 'mod.mcimirror.top' && url.pathname.startsWith('/modrinth/'))
    if (official) {
      const exact = url.pathname.match(/\/version\/(community_progress_[a-z0-9_]+)_v1$/)
      if (exact && bytes.has(exact[1])) return Response.json(version(exact[1]))
      const project = url.pathname.match(/\/project\/(community_progress_[a-z0-9_]+)\/version$/)
      if (project && bytes.has(project[1])) return Response.json([version(project[1])])
      if (current && url.pathname.endsWith('/search') && url.searchParams.get('query') === current.rootId) return Response.json({ hits: [{ project_id: current.rootId, slug: current.rootId, title: '社区 MOD 下载进度 ' + current.name, description: '私有合成仓库；生产下载、校验和事务', author: 'acceptance fixture', downloads: 0 }], total_hits: 1 })
    }
    return originalFetch(input, init)
  }
  globalThis.fetch = wrapper
  return {
    classification: 'Synthetic repository metadata and chunked loopback transport; original production IPC, bytes, checksum, cancellation and transaction. No live services or game launch.',
    useCase({ name, unknown = false, failHash = false, delayMs = 50 }) {
      if (closed || !/^[a-z0-9_]{1,30}$/.test(name) || cases.some(row => row.name === name)) throw Error('Unsafe or duplicate fixture case')
      const rootId = 'community_progress_root_' + name, depId = 'community_progress_library_' + name, instance = '社区 MOD 进度 ' + name, folder = path.join(root, name, '游戏 §'), versionDir = path.join(folder, 'versions', instance), mode = { unknown, failHash, delayMs }
      fs.mkdirSync(versionDir, { recursive: true })
      fs.writeFileSync(path.join(versionDir, instance + '.json'), JSON.stringify({ id: instance, _mcVersion: '1.20.1', _loader: 'fabric', _loaderVersion: '0.16.0', _gameDir: true, mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', libraries: [] }), { flag: 'wx' })
      fs.writeFileSync(path.join(versionDir, instance + '.jar'), 'Synthetic shell for scanner; never launch', { flag: 'wx' })
      for (const [id, dependency, size, fileName] of [[rootId, depId, 3 * 1024 * 1024, '社区模组 § ' + name + '.jar'], [depId, undefined, 1024 * 1024, '必要前置 § ' + name + '.jar']]) {
        const zip = new AdmZip(); zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id, name: id, version: '1.0.0', depends: { minecraft: '1.20.1', fabricloader: '>=0.15', ...(dependency ? { [dependency]: '*' } : {}) } }))); zip.addFile('fixture.bin', crypto.randomBytes(size))
        const payload = zip.toBuffer(); bytes.set(id, { bytes: payload, mode, dependency, fileName, sha1: crypto.createHash('sha1').update(payload).digest('hex'), sha256: crypto.createHash('sha256').update(payload).digest('hex') })
      }
      current = { name, rootId, depId, folder, instance, versionDir, mode, eventStart: events.length, requestStart: requests.length }; cases.push(current)
      return { ...current, expected: [rootId, depId].map(id => { const entry = bytes.get(id); return { id, name: entry.fileName, size: entry.bytes.length, sha1: entry.sha1, sha256: entry.sha256 } }) }
    },
    setHashFailure(value) { if (!current) throw Error('No active fixture'); current.mode.failHash = value === true },
    inspect() {
      const files = current && fs.existsSync(path.join(current.versionDir, 'mods')) ? fs.readdirSync(path.join(current.versionDir, 'mods')).map(name => { const data = fs.readFileSync(path.join(current.versionDir, 'mods', name)); return { name, size: data.length, sha1: crypto.createHash('sha1').update(data).digest('hex'), sha256: crypto.createHash('sha256').update(data).digest('hex') } }) : []
      return { current, events: structuredClone(events), requests: structuredClone(requests), files, productionHandlersUnchanged: handlers.every(([channel, handler]) => electron.ipcMain._invokeHandlers.get(channel) === handler) }
    },
    async close() {
      if (closed) return { complete: true, alreadyClosed: true }; closed = true
      if (globalThis.fetch !== wrapper || window.webContents.send !== observer) throw Error('Fixture ownership changed; refusing to overwrite another transport')
      globalThis.fetch = originalFetch; window.webContents.send = originalSend; server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
      return { complete: globalThis.fetch === originalFetch && window.webContents.send === originalSend, productionHandlersUnchanged: handlers.every(([channel, handler]) => electron.ipcMain._invokeHandlers.get(channel) === handler), requests, events }
    }
  }
}
