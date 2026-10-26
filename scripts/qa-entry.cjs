const fs = require('node:fs')

// Electron 44's default application imports a requested .cjs main through ESM,
// so require.main can still point at Electron rather than that requested file.
// An imported helper must never start a QA application.
function isQaMain(currentModule, requireMain, runtime = process) {
  if (runtime.versions?.electron && runtime.type === 'browser') {
    if (runtime.env?.ELECTRON_RUN_AS_NODE) return false
    if (typeof runtime.argv?.[1] !== 'string' || typeof currentModule?.filename !== 'string') return false
    try { return fs.realpathSync(runtime.argv[1]) === fs.realpathSync(currentModule.filename) }
    catch { return false }
  }
  return currentModule === requireMain
}

module.exports = { isQaMain, loadedAsEntry: isQaMain(module, require.main) }
