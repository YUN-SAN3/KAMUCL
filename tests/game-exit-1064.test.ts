import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GameExitEvidence, shouldReportGameCrash, signedExitCode } from '../src/shared/gameExit'
import { ExitJournal } from '../src/main/core/exitJournal'
import { DetachedGameProcess } from '../src/main/core/gracefulClose'
const shutdown = [
  '[23:03:45] [Render thread/INFO]: Stopping!',
  '[23:03:45] [Server thread/INFO]: Stopping server',
  '[23:03:45] [Server thread/INFO]: Saving players',
  '[23:03:45] [Server thread/INFO]: ThreadedAnvilChunkStorage: All dimensions are saved',
  '---- Minecraft Crash Report ----',
  'Description: Client shutdown from post-main',
  'java.lang.Error: Watchdog (Client shutdown from post-main)',
  'Thread: Client shutdown watchdog #2'
]
const observe = (lines: string[]) => { const e = new GameExitEvidence(); lines.forEach(l => e.observe(l)); return e }
test('user close followed by post-main watchdog is non-modal, signed and DWORD exit codes', () => {
  for (const code of [-8, 4294967288]) {
    const exitKind = observe(shutdown).classify(code)
    assert.equal(exitKind, 'shutdown-timeout')
    assert.equal(shouldReportGameCrash({ code, exitKind }), false)
    assert.equal(signedExitCode(code), -8)
  }
})
test('exit code alone, server stop, disconnect and watchdog before client stop are not accepted', () => {
  for (const lines of [[], shutdown.slice(1), [...shutdown.slice(4), shutdown[0]], ['[Server thread/INFO]: Stopping!', ...shutdown.slice(4)]]) assert.equal(observe(lines).classify(-8), 'abnormal')
  assert.equal(observe(shutdown).classify(-8, false, 'linux'), 'abnormal')
  assert.equal(observe(shutdown).classify(1), 'abnormal')
})
test('real crash before/after shutdown watchdog remains modal; incomplete crash report remains abnormal', () => {
  const crash = ['---- Minecraft Crash Report ----', 'Description: Rendering entity in world']
  for (const lines of [[...crash, ...shutdown], [...shutdown, ...crash], [...shutdown, '---- Minecraft Crash Report ----'], ['A fatal error has been detected by the Java Runtime Environment', ...shutdown]]) {
    const exitKind = observe(lines).classify(-8)
    assert.equal(exitKind, 'abnormal'); assert(shouldReportGameCrash({ code: -8, exitKind }))
  }
})
test('ordinary warnings do not turn a shutdown timeout into a gameplay crash; sessions do not leak', () => {
  assert.equal(observe(['io.netty.handler.codec.EncoderException: disconnect', ...shutdown]).classify(-8), 'shutdown-timeout')
  assert.equal(new GameExitEvidence().classify(-8), 'abnormal')
  assert.equal(observe(shutdown).classify(0), 'normal')
  assert.equal(observe(shutdown).classify(null, true), 'stopped')
  assert.equal(shouldReportGameCrash({code:1,intentionalStop:true}),false)
  assert.equal(shouldReportGameCrash({code:1}),true)
})
test('shutdown timeout history retains evidence without a fresh crash notice after restart', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kamucl-exit-test-')), file=path.join(dir,'exit.json')
  try {
    const j=new ExitJournal(file), id=j.begin('game',123,'fixture',{logDir:'session-a'})
    j.end(id,4294967288,false,true)
    const history=new ExitJournal(file).list()
    assert.equal(history.length,1);assert.equal(history[0].seen,true)
    assert.equal(history[0].context?.exitKind,'shutdown-timeout');assert.equal(history[0].context?.logDir,'session-a')
    const crash=j.begin('game',124,'fixture');j.end(crash,1)
    assert.equal(j.list()[0].seen,false)
    const launcher=j.begin('launcher',125,'launcher');j.end(launcher,1,false,true)
    assert.equal(j.list()[0].seen,false)
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
test('Windows close waits for final pipe output so shutdown evidence is available', async () => {
  let exit!:()=>void
  const pumps=new Map<number,{push:(b:Buffer)=>void,end:()=>void}>()
  const closed:number[]=[]
  const api={ waitForExit:()=>new Promise<void>(r=>{exit=r}),getExitCode:()=>4294967288,close:(h:number)=>closed.push(h),pumpStream:(h:number,push:(b:Buffer)=>void,end:()=>void)=>pumps.set(h,{push,end}),terminate:()=>true } as any
  const p=new DetachedGameProcess(123,1,api,2,3),e=new GameExitEvidence()
  p.stdout!.on('data',(b:Buffer)=>b.toString().trim().split('\n').forEach(l=>e.observe(l)))
  p.stderr!.on('data',()=>{})
  let didClose=false;const done=new Promise<void>(resolve=>p.on('close',()=>{didClose=true;assert.equal(e.classify(p.exitCode),'shutdown-timeout');resolve()}))
  exit();await new Promise(r=>setImmediate(r));assert.equal(didClose,false)
  pumps.get(2)!.push(Buffer.from(shutdown.join('\n')+'\n'));pumps.get(2)!.end();pumps.get(3)!.end()
  await done;assert.deepEqual(closed.sort(),[1,2,3])
})
