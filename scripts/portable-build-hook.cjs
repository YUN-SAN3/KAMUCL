// electron-builder 26.15.3 的 portable 模板有两个问题需要构建时修复：
// 1. 未引用可执行文件路径——TEMP / 用户名含空格时 ExecWait 失败（退出码1），主进程尚未运行。
// 2. 解压目录：模板优先走 "$TEMP\${UNPACK_DIR_NAME}"（unpackDirName 即使为 false 也会
//    被 electron-builder 填成随机 ksuid），否则才落 $PLUGINSDIR\app——两条路径都在系统 TEMP，
//    用户不可见且占用系统盘；统一改为解压到 exe 所在目录的固定子目录 KAMUCL-runtime
//    缓存按完整构建内容隔离，完整解压后复用；首次解压前先显示轻量粒子。
// 在构建时变换模板，不修改 node_modules；升级模板后无法识别则阻止错误出包。
const OLD_UNPACK_PLUGINS = 'StrCpy $INSTDIR "$PLUGINSDIR\\app"'
const OLD_UNPACK_TEMP = 'StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"'
const NEW_UNPACK = 'StrCpy $INSTDIR "$EXEDIR\\KAMUCL-runtime"'

function repairPortableScript(script, options = {}) {
  if (script.includes('; KAMUCL_EARLY_FEEDBACK')) return script
  // 解压目录：TEMP 两条分支（ksuid 随机目录 / plugins 临时目录）→ exe 所在文件夹的固定子目录
  if (!script.includes(NEW_UNPACK)) {
    if (script.split(OLD_UNPACK_TEMP).length !== 2) throw new Error('Portable NSIS template changed: review unpack directory before release')
    script = script.replace(OLD_UNPACK_TEMP, NEW_UNPACK)
    // PLUGINSDIR\app 分支仅在 UNPACK_DIR_NAME 未定义时生效；一并替换保持语义一致
    if (script.includes(OLD_UNPACK_PLUGINS)) script = script.replace(OLD_UNPACK_PLUGINS, NEW_UNPACK)
  }
  const old = 'ExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0'
  const fixed = `ExecWait '\"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}\" $R0' $0`
  if (script.split(old).length !== 2) throw new Error('Portable NSIS template changed: review quoted launch command before release')
  script = script.replace(old, `ClearErrors\n\t${fixed}\n\tIfErrors 0 +3\n\tMessageBox MB_OK|MB_ICONSTOP 'KAMUCL could not start. Please extract the Windows ZIP package and run KAMUCL.exe.'\n\tStrCpy $0 1\n  FileOpen $R8 "$PLUGINSDIR\\startup.done" w\n  FileClose $R8`)
  const key = options.cacheKey || 'test-cache'
  const feedback = options.feedback || require('node:path').resolve(__dirname, '../out/main/StartupFeedback.exe')
  script = `; KAMUCL_EARLY_FEEDBACK\n!define KAMUCL_CACHE_KEY "${key}"\nVar runtimeMutex\n${script}`
  script = script.replace('Function .onInit', `Function .onInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\\StartupFeedback.exe "${feedback}"
  System::Call 'kernel32::GetCurrentProcessId() i.r9'
  System::Call 'kernel32::SetEnvironmentVariable(t "KAMUCL_BOOT_SIGNAL", t "$PLUGINSDIR\\startup.done")'
  Exec '"$PLUGINSDIR\\StartupFeedback.exe" "$PLUGINSDIR\\startup.done" "$9"'`)
  const remove = 'RMDir /r $INSTDIR'
  if (script.split(remove).length !== 3) throw new Error('Portable NSIS template changed: review cache cleanup')
  script = script.replace(remove, `StrCpy $INSTDIR "$INSTDIR\\\${KAMUCL_CACHE_KEY}"
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "Local\\KAMUCL-unpack-\${KAMUCL_CACHE_KEY}") p.s'
  Pop $runtimeMutex
  System::Call 'kernel32::WaitForSingleObject(p $runtimeMutex, i -1)'
  IfFileExists "$INSTDIR\\cache.ready" 0 extract_runtime
  IfFileExists "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" 0 extract_runtime
  IfFileExists "$INSTDIR\\resources\\app.asar" 0 extract_runtime
  IfFileExists "$INSTDIR\\icudtl.dat" runtime_ready extract_runtime
extract_runtime:
  ${remove}`)
  script = script.replace("  System::Call 'Kernel32::SetEnvironmentVariable", `  FileOpen $R8 "$INSTDIR\\cache.ready" w
  FileWrite $R8 "\${KAMUCL_CACHE_KEY}"
  FileClose $R8
runtime_ready:
  SetOutPath $INSTDIR
  System::Call 'kernel32::ReleaseMutex(p $runtimeMutex)'
  System::Call 'kernel32::CloseHandle(p $runtimeMutex)'
  System::Call 'Kernel32::SetEnvironmentVariable`)
  // Keep this build's runtime; another launcher process may still be using it.
  const last = script.lastIndexOf(remove)
  script = script.slice(0, last) + '; Keep verified runtime cache for next launch' + script.slice(last + remove.length)
  return script
}

function runtimeCacheKey(root = require('node:path').resolve(__dirname, '..')) {
  const fs = require('node:fs'), path = require('node:path'), hash = require('node:crypto').createHash('sha256')
  const add = dir => { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) add(file); else { hash.update(path.relative(root, file)); hash.update(fs.readFileSync(file)) } } }
  for (const dir of ['out/main', 'out/preload', 'out/renderer']) add(path.join(root, dir))
  hash.update(fs.readFileSync(path.join(root, 'package-lock.json')))
  return require(path.join(root, 'package.json')).version + '-' + hash.digest('hex').slice(0, 16)
}

module.exports = function beforePack() {
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget')
  if (NsisTarget.prototype.__kamuclQuotedPortable) return
  const original = NsisTarget.prototype.computeFinalScript
  NsisTarget.prototype.computeFinalScript = function (script, ...args) {
    return original.call(this, this.isPortable ? repairPortableScript(script, { cacheKey: runtimeCacheKey() }) : script, ...args)
  }
  NsisTarget.prototype.__kamuclQuotedPortable = true
}
module.exports.repairPortableScript = repairPortableScript
