'use strict'

// Native HAP bootstrap; the application main/preload/renderer remain the same
// production outputs used by Windows, macOS and Linux.
if (process.platform !== 'openharmony' && process.platform !== 'ohos') {
  throw new Error('KAMUCL HarmonyOS entry requires the native HarmonyOS Electron runtime.')
}
if (process.arch !== 'arm64' || process.versions.electron !== '37.2.0') {
  throw new Error('Unexpected HarmonyOS runtime. Use the verified runtime.lock.json asset.')
}

const { app } = require('electron')
app.setName('KAMUCL')
// Keep the template WebAbilityStage.onAcceptWant route: it brings the existing
// widget forward on repeated starts while retaining internal multiwindow support.
// requestSingleInstanceLock is not supported by the HarmonyOS maintainer runtime.
require('./out/main/index.js')
