// Measure presented native frames on the current display, in a private startup session.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { spawn } = require('node:child_process')
const root = fs.mkdtempSync(path.resolve('out/startup-fps-'))
const signal = path.join(root, 'control'), probe = path.join(root, 'frames.txt')
const child = spawn(path.resolve('out/main/StartupFeedback.exe'), [signal, String(process.pid)], { windowsHide: true, env: { ...process.env, KAMUCL_FRAME_PROBE: probe }, stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const deadline = Date.now() + 5000
  while (!fs.existsSync(signal + '.visible')) { assert(Date.now() < deadline, 'First frame timed out'); await wait(20) }
  await wait(4500)
  fs.writeFileSync(signal, 'closed')
  await new Promise((resolve, reject) => { child.on('exit', code => code === 0 ? resolve() : reject(Error('Exit ' + code))); child.on('error', reject) })
  const times = fs.readFileSync(probe, 'utf8').trim().split(/\r?\n/).map(Number).filter(t => t >= 700)
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
  const fps = (times.length - 1) * 1000 / (times.at(-1) - times[0])
  const result = { root, frames: times.length, fps, medianFrameMs: gaps[Math.floor(gaps.length * .5)], p95FrameMs: gaps[Math.floor(gaps.length * .95)] }
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  assert(fps >= 55 && fps <= 63, 'Native startup should sustain approximately 60 presented frames/s')
})().catch(error => { fs.writeFileSync(signal, 'closed'); console.error(error); process.exitCode = 1 })
