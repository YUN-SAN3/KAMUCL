import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { SmoothedSpeedEstimator } from '../src/main/core/downloadProgress'
import { downloadAll, downloadFile } from '../src/main/core/download'
import { DEFAULT_DOWNLOAD_LIMITS, downloadLimiter } from '../src/main/core/downloadLimits'
import { ProgressDeadline, withDeadline } from '../src/shared/deadline'

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

test('wire speed ignores callback frequency, delays ETA until warmup and expires stalled rates', () => {
  const frequent = new SmoothedSpeedEstimator(), ticks = new SmoothedSpeedEstimator()
  for (let ms = 0; ms <= 6000; ms += 10) {
    const rate = frequent.sample(ms * 1024, (12000-ms)*1024, ms)
    if (ms % 250 === 0) assert.deepEqual(rate, ticks.sample(ms*1024,(12000-ms)*1024,ms))
    if (ms < 3000) assert.equal(rate.etaSeconds, null)
  }
  assert.equal(frequent.sample(6000*1024, null, 10000).speedBps, 0)
  assert.equal(frequent.sample(6000*1024, null, 10250).etaSeconds, null)
  frequent.sample(6000*1024, 500, 10500, true)
  assert.equal(frequent.sample(6000*1024,500,11000).speedBps,0)
  assert.equal(frequent.sample(6001*1024,500,12000).speedBps,1024)
})

test('SHA256 update-sized transfer uses concurrent ranges; cache hits are zero wire bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'kamucl-transfer-'))
  const data = crypto.randomBytes(2*1024*1024)
  const sha256 = crypto.createHash('sha256').update(data).digest('hex')
  let active=0, peak=0, calls=0, wire=0
  const server=http.createServer((req,res)=>{
    calls++; active++; peak=Math.max(peak,active);res.on('close',()=>active--)
    const range=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range??'')
    const start=range?Number(range[1]):0,end=range?Number(range[2]):data.length-1
    res.writeHead(range?206:200,{'Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${data.length}`}:{})})
    setTimeout(()=>res.end(data.subarray(start,end+1)),60)
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  downloadLimiter.configure({downloadThreads:8,downloadSpeedKBps:0})
  try {
    const url=`http://127.0.0.1:${(server.address() as any).port}/update.exe`,dest=path.join(root,'update.exe')
    await downloadFile(url,dest,(_d,_t,n=0)=>wire+=n,undefined,'official',undefined,[],{size:data.length,sha256})
    assert.ok(peak>=2 && peak<=8,`concurrent requests ${peak}`)
    assert.equal(wire,data.length)
    assert.deepEqual(await fs.readFile(dest),data)
    const before=calls, speeds:number[]=[]
    await downloadAll([{url,dest,size:data.length,sha256}],(_d,_t,speed)=>speeds.push(speed))
    assert.equal(calls,before)
    assert.ok(speeds.every(speed=>speed===0))
  } finally {downloadLimiter.configure(DEFAULT_DOWNLOAD_LIMITS);server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fs.rm(root,{recursive:true,force:true})}
})

test('late startup preparation cannot create a process after deadline', async () => {
  let committed=false
  await assert.rejects(withDeadline(async signal=>{await wait(50);signal.throwIfAborted();committed=true},10,'timeout'),/timeout/)
  await wait(70)
  assert.equal(committed,false)
  assert.equal(await withDeadline(async()=>42,50,'timeout'),42)
})

test('startup watchdog ignores repeated heartbeats, permits real progress, and disposes on spawn', async () => {
  let failures=0
  const deadline=new ProgressDeadline(50,()=>failures++)
  deadline.progress('stage:1');await wait(25);deadline.progress('stage:2');await wait(30)
  assert.equal(failures,0)
  deadline.progress('stage:2');await wait(40)
  assert.equal(failures,1);assert.throws(()=>deadline.signal.throwIfAborted())
  deadline.dispose()
  const completed=new ProgressDeadline(10,()=>failures++);completed.dispose();await wait(20)
  assert.equal(failures,1)
})
