import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { updateNotes } from '../src/shared/updateNotes'
const require = createRequire(import.meta.url)
test('portable feedback precedes extraction, cache is gated by completion and launch cleanup preserves concurrent users', () => {
  const { repairPortableScript } = require('../scripts/portable-build-hook.cjs')
  const src = fs.readFileSync('node_modules/app-builder-lib/templates/nsis/portable.nsi', 'utf8')
  const script = repairPortableScript(src, { cacheKey: '1.0.33-proof' })
  assert(script.indexOf('StartupFeedback.exe') < script.indexOf('extract_runtime:'))
  assert(script.indexOf('cache.ready') < script.indexOf('extract_runtime:'))
  assert(script.indexOf('WaitForSingleObject') < script.indexOf('extract_runtime:'))
  assert(script.indexOf('runtime_ready:') > script.indexOf('extractEmbeddedAppPackage'))
  assert(script.indexOf('ReleaseMutex') < script.indexOf('ExecWait'))
  assert(!script.slice(script.indexOf('ExecWait')).includes('RMDir /r'))
  assert.equal(repairPortableScript(script), script)
  assert(script.includes('1.0.33-proof'))
})
test('new release notes and corrected previous release include local hours and minutes', () => {
  for (const version of ['1.0.33', '1.0.32']) assert.match(updateNotes.find(n => n.version === version)!.date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})
