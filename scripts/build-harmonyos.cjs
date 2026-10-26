'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { root, output, project, digest, files } = require('./prepare-harmonyos.cjs')
const { verify } = require('./verify-harmonyos.cjs')

async function exists(file) { return !!await fs.stat(file).catch(() => null) }
async function command(file, args, directory, env, logfile) {
  const lines = [`command: ${path.basename(file)} ${args.join(' ')}\n`]
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
  // Windows batch files need cmd; restrict tool paths to official installation
  // directories and never interpolate arbitrary signing secrets into a command.
  if (batch && /["\r\n&|<>^%]/.test(file)) throw new Error('Unsupported characters in CLI tool path')
  const child = batch
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${file}" ${args.map(argument => '"' + argument + '"').join(' ')}"`], { cwd: directory, env, windowsHide: true })
    : spawn(file, args, { cwd: directory, env, windowsHide: true })
  child.stdout.on('data', data => { const text = data.toString(); lines.push(text); process.stdout.write(text) })
  child.stderr.on('data', data => { const text = data.toString(); lines.push(text); process.stderr.write(text) })
  const code = await new Promise(resolve => { child.on('error', error => { lines.push(error.message + '\n'); resolve(-1) }); child.on('close', resolve) })
  lines.push(`\nexitCode: ${code}\n`)
  await fs.writeFile(logfile, lines.join(''))
  return code
}

async function tools() {
  const directory = process.env.KAMUCL_HARMONY_COMMAND_LINE_TOOLS
  if (!directory) return { available: false, reason: 'KAMUCL_HARMONY_COMMAND_LINE_TOOLS is unset; no authorized DevEco/Command Line Tools installation was found.' }
  const resolved = path.resolve(directory)
  const suffix = process.platform === 'win32' ? '.bat' : ''
  const hvigor = path.join(resolved, 'bin', 'hvigorw' + suffix)
  const ohpmCandidates = [path.join(resolved, 'bin', 'ohpm' + suffix), path.join(resolved, 'ohpm/bin', 'ohpm' + suffix)]
  const ohpm = (await Promise.all(ohpmCandidates.map(async file => await exists(file) ? file : null))).find(Boolean)
  const sdk = path.join(resolved, 'sdk')
  if (!await exists(hvigor) || !ohpm || !await exists(sdk)) return { available: false, reason: 'Official CLI directory must contain bin/hvigorw, ohpm and sdk. A JavaScript-only tool install is not a HarmonyOS SDK.' }
  return { available: true, directory: resolved, hvigor, ohpm, sdk }
}

async function main() {
  await fs.mkdir(output, { recursive: true })
  const toolset = await tools()
  const prepared = await exists(path.join(output, 'engineering-evidence.json')) && await exists(path.join(project, '.kamucl-generated-harmony-project'))
  const evidence = {
    schemaVersion: 1, createdAt: new Date().toISOString(), version: JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version,
    prepared, sdkAvailable: toolset.available, sdkReason: toolset.reason || null,
    compiled: false, signed: false, realDeviceVerified: false, nativeGameVerified: false,
    runtimeThirdPartyNoticesComplete: false, publishable: false,
    result: prepared && toolset.available ? 'ready-to-attempt-compilation' : 'blocked-prerequisite',
    history: [{ phase: 'official-sdk-download', observedAt: '2026-10-04', observed: 'Historical setup attempt: official download center tool-list API returned HTTP 401 without developer login. No credentials were extracted and no SDK substitute was used.' }]
  }
  const evidenceFile = path.join(output, 'build-evidence.json')
  const save = () => fs.writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n')
  if (prepared) {
    try { await verify(); evidence.inspectionPassed = true }
    catch (error) {
      evidence.inspectionPassed = false
      evidence.result = 'engineering-inspection-failed'
      evidence.history.push({ phase: 'engineering-inspection', error: error.message })
      await save()
      throw error
    }
  }
  await save()
  if (process.argv.includes('--check')) { console.log(JSON.stringify(evidence, null, 2)); return }
  if (!prepared || !toolset.available) {
    const message = !prepared ? 'Run npm run build and node scripts/prepare-harmonyos.cjs first.' : toolset.reason
    await fs.writeFile(path.join(output, 'compile-attempt.log'), `status: blocked-prerequisite\n${message}\nNo HAP was compiled or signed; no device or game result is inferred.\n`)
    throw new Error(message)
  }
  const env = { ...process.env, DEVECO_SDK_HOME: toolset.sdk }
  if (await command(toolset.hvigor, ['--version'], project, env, path.join(output, 'hvigor-version.log')) !== 0) throw new Error('Official Hvigor initialization failed; see raw log')
  if (await command(toolset.ohpm, ['-v'], project, env, path.join(output, 'ohpm-version.log')) !== 0) throw new Error('Official ohpm initialization failed; see raw log')
  if (await command(toolset.ohpm, ['install', '--all'], project, env, path.join(output, 'ohpm-install.log')) !== 0) throw new Error('Harmony project dependency installation failed; see raw log')
  const code = await command(toolset.hvigor, ['assembleHap', '--mode', 'module', '-p', 'product=default', '-p', 'buildMode=release', '--no-daemon'], project, env, path.join(output, 'compile-attempt.log'))
  evidence.history.push({ phase: 'assembleHap', exitCode: code })
  evidence.result = code === 0 ? 'unsigned-hap-built-device-and-game-not-verified' : 'compilation-failed'
  const artifacts = []
  if (code === 0) {
    for (const file of await files(path.join(project, 'electron/build'))) if (file.endsWith('.hap')) {
      const buffer = await fs.readFile(file)
      artifacts.push({ path: path.relative(root, file).replaceAll('\\', '/'), bytes: buffer.length, sha256: digest(buffer) })
    }
    evidence.compiled = artifacts.length > 0
  }
  evidence.artifacts = artifacts
  await save()
  if (code !== 0 || !evidence.compiled) throw new Error('Native HAP compilation did not succeed; original raw logs retained')
  console.log(JSON.stringify(evidence, null, 2))
}

module.exports = { tools, command }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 2 })
