/**
 * 下载模块审计回归（合并后「多线程下载被大量取消」问题的针对性覆盖）：
 * 1. 分块计划纯函数：边界公式、连接上限、连续性
 * 2. 整体看门狗不误杀排队中的分块（并发闸门饥饿 ≠ 源挂起）——1.0.8 回归点
 * 3. 块级失败重试从磁盘断点续传，进度不重复累计
 * 4. 限速令牌桶聚合：总量受速率约束、突发被桶上限抑制
 * 5. 分块内容校验失败时丢弃全部断点（防坏块投毒后续候选/重试）
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildChunkPlan,
  chunkStallWatchdog,
  downloadAll,
  downloadFile,
  type ChunkPlan
} from '../src/main/core/download'
import { DEFAULT_DOWNLOAD_LIMITS, downloadLimiter, DownloadLimiter } from '../src/main/core/downloadLimits'

const MB = 1024 * 1024

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

function expectPlanCovers(plan: ChunkPlan[], total: number): void {
  let position = 0
  let summed = 0
  for (const chunk of plan) {
    assert.equal(chunk.start, position, '分块必须首尾相接')
    assert.ok(chunk.length > 0, '分块长度必须为正')
    assert.equal(chunk.end - chunk.start, chunk.length)
    position = chunk.end
    summed += chunk.length
  }
  assert.equal(position, total, '分块必须覆盖到文件末尾')
  assert.equal(summed, total, '分块长度之和必须等于文件大小')
}

function serveRange(payload: Buffer, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (!match) return false
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1
  res.writeHead(206, {
    'content-range': `bytes ${start}-${end}/${payload.length}`,
    'content-length': String(end - start + 1)
  })
  if (end < start) {
    res.end()
    return true
  }
  res.end(payload.subarray(start, end + 1))
  return true
}

test('分块计划：floor 边界公式、单块阈值与连接上限', () => {
  const dest = path.join(os.tmpdir(), 'kamucl-audit-plan', 'client.jar')

  const exact = buildChunkPlan(8 * MB, dest)
  assert.equal(exact.length, 1, '恰好 8MB 时单块即可，不拆分')

  const two = buildChunkPlan(9 * MB, dest)
  assert.equal(two.length, 2)
  assert.equal(two[0].start, 0)
  assert.equal(two[0].end, Math.floor((9 * MB) / 2), '块边界取 floor(total*i/n)，与断点续传契约一致')
  assert.equal(two[1].start, two[0].end)
  assert.equal(two[1].end, 9 * MB)
  assert.equal(two[0].part, dest + '.part0')
  assert.equal(two[1].part, dest + '.part1')

  const oneByteOver = buildChunkPlan(8 * MB + 1, dest)
  assert.equal(oneByteOver.length, 2, '超过 8MB 即拆分')

  const huge = buildChunkPlan(100 * MB, dest)
  assert.equal(huge.length, 8, '块数按最大连接数截断')
  expectPlanCovers(huge, 100 * MB)
  expectPlanCovers(two, 9 * MB)
  expectPlanCovers(oneByteOver, 8 * MB + 1)
})

test('整体看门狗不误杀排队中的分块：并发闸门饥饿时不整组取消、不回退单连接', async () => {
  const originalWatchdog = { ...chunkStallWatchdog }
  downloadLimiter.configure({ downloadThreads: 1, downloadSpeedKBps: 0 })
  // 每个分块请求服务端延迟 500ms 应答：任何排队块都会经历 >stallMs 的「本文件零字节」窗口。
  // 1.0.8 的看门狗只看「距上次字节的时间」，会把这种排队饥饿误判为源挂起并整组取消。
  chunkStallWatchdog.stallMs = 200
  chunkStallWatchdog.tickMs = 40
  const payload = crypto.randomBytes(12 * MB) // 每文件 2 块
  const requests: Array<{ range: string | null }> = []
  let active = 0
  let peak = 0
  const dripServer = http.createServer((req, res) => {
    requests.push({ range: req.headers.range ? String(req.headers.range) : null })
    active++
    peak = Math.max(peak, active)
    res.on('close', () => active--)
    const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''))
    if (!match) {
      res.writeHead(200, { 'content-length': String(payload.length) })
      res.end(payload)
      return
    }
    const start = Number(match[1])
    const end = match[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1
    setTimeout(() => {
      if (res.destroyed) return
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${payload.length}`,
        'content-length': String(end - start + 1)
      })
      res.end(payload.subarray(start, end + 1))
    }, 500)
  })

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-audit-watchdog-'))
  try {
    const base = await listen(dripServer)
    const tasks = [
      { url: `${base}/a.jar`, dest: path.join(root, 'a.jar'), size: payload.length },
      { url: `${base}/b.jar`, dest: path.join(root, 'b.jar'), size: payload.length }
    ]
    await downloadAll(tasks, undefined, 2, 'official', undefined)

    assert.equal(requests.length, 4, '两文件各 2 个分块请求，无额外重试/回退')
    assert.ok(
      requests.every((r) => r.range !== null),
      '不得出现无 Range 的全量请求（出现即说明分块组被看门狗误杀后回退单连接）'
    )
    assert.ok(peak === 1, `全局并发闸门仍然生效（peak=${peak}）`)
    for (const task of tasks) {
      assert.deepEqual(await fs.promises.readFile(task.dest), payload)
    }
    assert.deepEqual(fs.readdirSync(root).sort(), ['a.jar', 'b.jar'], '成功后不残留分块文件')
  } finally {
    Object.assign(chunkStallWatchdog, originalWatchdog)
    downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS)
    await closeServer(dripServer)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('块级失败重试从磁盘断点续传，进度单调且不重复累计', async () => {
  const payload = crypto.randomBytes(9 * MB) // 2 块
  const sha1 = crypto.createHash('sha1').update(payload).digest('hex')
  const requests: Array<string | null> = []
  const server = http.createServer((req, res) => {
    const range = req.headers.range ? String(req.headers.range) : null
    requests.push(range)
    const match = /^bytes=(\d+)-(\d*)$/.exec(String(range ?? ''))
    if (!match) {
      res.writeHead(200, { 'content-length': String(payload.length) })
      res.end(payload)
      return
    }
    const start = Number(match[1])
    const end = match[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1
    if (requests.length === 1) {
      // 首块首次传输：声明完整块长、吐出部分字节后硬断（transient），触发块级重试
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${payload.length}`,
        'content-length': String(end - start + 1)
      })
      res.write(payload.subarray(start, start + 256 * 1024))
      const cutoff = setTimeout(() => res.destroy(), 80)
      res.on('close', () => clearInterval(cutoff))
      return
    }
    res.writeHead(206, {
      'content-range': `bytes ${start}-${end}/${payload.length}`,
      'content-length': String(end - start + 1)
    })
    res.end(payload.subarray(start, end + 1))
  })

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-audit-chunkretry-'))
  try {
    const base = await listen(server)
    const dest = path.join(root, 'client.jar')
    const values: number[] = []
    await downloadFile(
      `${base}/client.jar`,
      dest,
      (done, total) => {
        values.push(done)
        assert.ok(done <= total, `进度不得超出总量：${done} > ${total}`)
      },
      sha1,
      'official',
      undefined,
      [],
      { size: payload.length }
    )

    assert.equal(requests.length, 3, '首块失败 1 次 + 首块断点续传 1 次 + 第二块 1 次')
    const resumeStarts = requests
      .map((range) => (range ? Number(/^bytes=(\d+)-/.exec(range)?.[1] ?? -1) : -1))
      .filter((start) => start > 0 && start < Math.floor(payload.length / 2))
    assert.ok(
      resumeStarts.length === 1 && resumeStarts[0] <= 256 * 1024,
      `首块必须从磁盘断点续传而非整块重下（实际续传起点：${resumeStarts.join(',')}）`
    )

    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] >= values[i - 1], `进度回跳：${values[i]} < ${values[i - 1]}（第 ${i} 次）`)
    }
    assert.equal(values.at(-1), payload.length, '最终进度必须恰为文件大小（无重复累计）')
    assert.deepEqual(await fs.promises.readFile(dest), payload)
    assert.deepEqual(fs.readdirSync(root), ['client.jar'], '成功后不残留分块文件')
  } finally {
    await closeServer(server)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('限速令牌桶聚合：吞吐受速率约束且突发被桶上限抑制', async () => {
  const steady = new DownloadLimiter()
  steady.configure({ downloadThreads: 1, downloadSpeedKBps: 8 })
  const started = performance.now()
  await steady.consume(16 * 1024)
  const elapsed = performance.now() - started
  assert.ok(elapsed >= 1500, `16KB @ 8KiB/s 应耗时约 2s，实际 ${elapsed.toFixed(0)}ms（限速聚合失效）`)

  const burst = new DownloadLimiter()
  burst.configure({ downloadThreads: 1, downloadSpeedKBps: 8 })
  const burstStarted = performance.now()
  await burst.consume(4 * 1024)
  const burstElapsed = performance.now() - burstStarted
  assert.ok(
    burstElapsed < 900,
    `4KB 突发应被 0.15s 桶上限抑制为约 0.35s，实际 ${burstElapsed.toFixed(0)}ms（桶容量异常）`
  )
})

test('分块内容校验失败时丢弃全部分块断点，防止坏块投毒后续候选', async () => {
  const payload = crypto.randomBytes(9 * MB)
  const wrongSha1 = crypto.createHash('sha1').update('definitely-not-the-payload').digest('hex')
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    if (!serveRange(payload, req, res)) {
      res.writeHead(200, { 'content-length': String(payload.length) })
      res.end(payload)
    }
  })

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kamucl-audit-poison-'))
  try {
    const base = await listen(server)
    await assert.rejects(
      downloadFile(`${base}/client.jar`, path.join(root, 'client.jar'), undefined, wrongSha1, 'official', undefined, [], {
        size: payload.length
      }),
      /下载失败/
    )
    assert.equal(requests, 2, '两个分块各请求一次（拼接成功，校验失败）')
    assert.deepEqual(fs.readdirSync(root), [], '校验失败后不得残留 .part/.partN 断点')
  } finally {
    await closeServer(server)
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
