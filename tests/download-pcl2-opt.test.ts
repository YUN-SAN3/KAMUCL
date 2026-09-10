import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  downloadFile,
  noteHostFailure,
  noteHostSuccess,
  resetHostHealthForTest,
  setStatfsProbeForTest,
  slowSpeedThresholds
} from '../src/main/core/download'
import { DEFAULT_DOWNLOAD_LIMITS, downloadLimiter } from '../src/main/core/downloadLimits'
import { cancelTaskAndWait, finishTask, isCancelError, registerTask } from '../src/main/core/tasks'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test('本地文件复用：大小+sha1 命中时零网络请求直接复制', async () => {
  resetHostHealthForTest()
  let requests = 0
  const server = http.createServer((_req, res) => {
    requests++
    res.end('should not be reached')
  })
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-reuse-hit-'))
  try {
    const base = await listen(server)
    const payload = Buffer.from('shared vanilla client jar payload for reuse test')
    const sha1 = crypto.createHash('sha1').update(payload).digest('hex')
    const reuseDir = path.join(root, 'other', 'versions')
    fs.mkdirSync(path.join(reuseDir, '1.20.1'), { recursive: true })
    fs.writeFileSync(path.join(reuseDir, '1.20.1', '1.20.1.jar'), payload)
    const dest = path.join(root, 'versions', 'custom', 'custom.jar')
    await downloadFile(`${base}/client.jar`, dest, undefined, sha1, 'official', undefined, [], {
      size: payload.length,
      reuseDirs: [reuseDir, path.join(root, 'no-such-dir')]
    })
    assert.equal(requests, 0)
    assert.deepEqual(await fs.promises.readFile(dest), payload)
    assert.equal(fs.existsSync(dest + '.part'), false)
  } finally {
    await closeServer(server)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('本地文件复用：大小相同但内容不符或扩展名不同时回退网络下载', async () => {
  resetHostHealthForTest()
  let requests = 0
  const payload = Buffer.from('real network payload')
  const sha1 = crypto.createHash('sha1').update(payload).digest('hex')
  const server = http.createServer((_req, res) => {
    requests++
    res.writeHead(200, { 'content-length': String(payload.length) })
    res.end(payload)
  })
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-reuse-miss-'))
  try {
    const base = await listen(server)
    // 大小相同但内容损坏：预筛通过、sha1 不通过 → 走网络
    const corruptDir = path.join(root, 'a', 'versions')
    fs.mkdirSync(corruptDir, { recursive: true })
    fs.writeFileSync(path.join(corruptDir, 'fake.jar'), Buffer.alloc(payload.length, 7))
    const destA = path.join(root, 'a.bin')
    await downloadFile(`${base}/a`, destA, undefined, sha1, 'official', undefined, [], {
      size: payload.length,
      reuseDirs: [corruptDir]
    })
    assert.equal(requests, 1)
    assert.deepEqual(await fs.promises.readFile(destA), payload)

    // 内容相同但扩展名不同：预筛阶段直接排除 → 走网络
    let requests2 = 0
    const server2 = http.createServer((_req, res) => {
      requests2++
      res.end('direct download')
    })
    try {
      const base2 = await listen(server2)
      const wrongExtDir = path.join(root, 'b', 'versions')
      fs.mkdirSync(wrongExtDir, { recursive: true })
      fs.writeFileSync(path.join(wrongExtDir, 'same.bin'), 'direct download')
      const destB = path.join(root, 'b.bin')
      await downloadFile(`${base2}/b`, destB, undefined, undefined, 'official', undefined, [], {
        reuseDirs: [wrongExtDir]
      })
      assert.equal(requests2, 1)
    } finally {
      await closeServer(server2)
    }

    // dest 自身所在目录不作为复用来源
    let requests3 = 0
    const server3 = http.createServer((_req, res) => {
      requests3++
      res.end('network copy')
    })
    try {
      const base3 = await listen(server3)
      const destDir = path.join(root, 'own', 'versions', 'x')
      fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.join(destDir, 'sibling.jar'), 'network copy')
      const destC = path.join(destDir, 'x.jar')
      await downloadFile(`${base3}/c`, destC, undefined, undefined, 'official', undefined, [], {
        reuseDirs: [destDir]
      })
      assert.equal(requests3, 1)
    } finally {
      await closeServer(server3)
    }
  } finally {
    await closeServer(server)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('慢速连接在滑动窗口内字节过少时主动掐断并重试耗尽', async () => {
  resetHostHealthForTest()
  const original = { ...slowSpeedThresholds }
  slowSpeedThresholds.windowMs = 250
  slowSpeedThresholds.minWindowBytes = 16 * 1024
  slowSpeedThresholds.warmupBytes = 256 * 1024
  let requests = 0
  const server = http.createServer((_req, res) => {
    requests++
    res.writeHead(200, { 'content-length': String(1024 * 1024) })
    res.write(Buffer.alloc(300 * 1024, 1)) // 快速突进一段跨过预热阈值
    const timer = setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        clearInterval(timer)
        return
      }
      res.write(Buffer.alloc(1024, 2)) // 之后每 80ms 才 1KB：窗口内远低于 16KB
    }, 80)
    res.on('close', () => clearInterval(timer))
  })
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-slow-'))
  try {
    const base = await listen(server)
    await assert.rejects(
      downloadFile(`${base}/slow.bin`, path.join(root, 'slow.bin')),
      /速度过慢|下载失败/
    )
    assert.equal(requests, 4, 'transient 掐断：第一轮重试 3 次 + 整体重试轮再试 1 次')
  } finally {
    Object.assign(slowSpeedThresholds, original)
    await closeServer(server)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('限速开启时跳过慢速检测，isThrottling 只读反映限速状态', async () => {
  resetHostHealthForTest()
  assert.equal(downloadLimiter.isThrottling, false)
  downloadLimiter.configure({ downloadThreads: 8, downloadSpeedKBps: 64 })
  assert.equal(downloadLimiter.isThrottling, true)
  downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS)
  assert.equal(downloadLimiter.isThrottling, false)

  // 限速模式下（isThrottling=true）即使流量形态缓慢也不掐断，正常完成
  const original = { ...slowSpeedThresholds }
  slowSpeedThresholds.windowMs = 200
  slowSpeedThresholds.minWindowBytes = 16 * 1024
  slowSpeedThresholds.warmupBytes = 1024
  let requests = 0
  const payload = Buffer.alloc(8 * 1024, 9)
  const server = http.createServer((_req, res) => {
    requests++
    res.writeHead(200, { 'content-length': String(payload.length) })
    res.end(payload)
  })
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-throttle-skip-'))
  downloadLimiter.configure({ downloadThreads: 8, downloadSpeedKBps: 65536 })
  try {
    const base = await listen(server)
    await downloadFile(`${base}/ok.bin`, path.join(root, 'ok.bin'))
    assert.equal(requests, 1)
  } finally {
    Object.assign(slowSpeedThresholds, original)
    downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS)
    await closeServer(server)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('会话级源健康度：冷却中的 host 沉底，成功后恢复原序', async () => {
  resetHostHealthForTest()
  let badHits = 0
  let goodHits = 0
  const payload = Buffer.from('healthy source payload')
  const badServer = http.createServer((_req, res) => {
    badHits++
    res.writeHead(404).end('missing')
  })
  const goodServer = http.createServer((_req, res) => {
    goodHits++
    res.writeHead(200, { 'content-length': String(payload.length) })
    res.end(payload)
  })
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-health-'))
  try {
    const badBase = await listen(badServer)
    const goodBase = await listen(goodServer)
    // 连续两次 transient 失败进入冷却：候选重排后直接从健康源开始
    noteHostFailure(badBase)
    noteHostFailure(badBase)
    const dest = path.join(root, 'a.bin')
    await downloadFile(`${badBase}/x`, dest, undefined, undefined, 'official', undefined, [
      `${goodBase}/ok`
    ])
    assert.equal(badHits, 0, '冷却中的源不应被首先尝试')
    assert.equal(goodHits, 1)

    // 成功（noteHostSuccess）清零后恢复正常顺序：坏源重新排在最前（404 一次后换源）
    noteHostSuccess(badBase)
    await downloadFile(`${badBase}/x`, path.join(root, 'b.bin'), undefined, undefined, 'official', undefined, [
      `${goodBase}/ok`
    ])
    assert.equal(badHits, 1, '冷却解除后坏源应重新被首先尝试')
    assert.equal(goodHits, 2)
  } finally {
    resetHostHealthForTest()
    await closeServer(badServer)
    await closeServer(goodServer)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('磁盘空间预检：≥50MB 且空间不足时零请求直接失败，充足或小文件则跳过', async () => {
  resetHostHealthForTest()
  let requests = 0
  const small = Buffer.from('tiny')
  const server = http.createServer((_req, res) => {
    requests++
    res.writeHead(200, { 'content-length': String(small.length) })
    res.end(small)
  })
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-disk-'))
  try {
    const base = await listen(server)
    // 注入仅剩 4MB 可用的 statfs：60MB 文件应直接失败且不发请求
    setStatfsProbeForTest(() => ({ bavail: 1024, bsize: 4096 }))
    await assert.rejects(
      downloadFile(`${base}/big.jar`, path.join(root, 'big.jar'), undefined, undefined, 'official', undefined, [], {
        size: 60 * 1024 * 1024
      }),
      /磁盘空间不足/
    )
    assert.equal(requests, 0)

    // 空间充足：预检通过，正常进入网络流程（内容与声明大小不符在校验阶段失败）
    setStatfsProbeForTest(() => ({ bavail: 1024 * 1024, bsize: 4096 }))
    await assert.rejects(
      downloadFile(`${base}/big.jar`, path.join(root, 'big2.jar'), undefined, undefined, 'official', undefined, [], {
        size: 60 * 1024 * 1024
      }),
      /下载失败/
    )
    assert.equal(requests, 1, '单连接校验失败 1 次（分块引擎已移除）')

    // <50MB 的文件不做预检：即便可用空间接近 0 也可下载
    setStatfsProbeForTest(() => ({ bavail: 1, bsize: 1 }))
    await downloadFile(`${base}/small.bin`, path.join(root, 'small.bin'), undefined, undefined, 'official', undefined, [], {
      size: small.length
    })
    assert.equal(requests, 2)
  } finally {
    setStatfsProbeForTest(null)
    await closeServer(server)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
