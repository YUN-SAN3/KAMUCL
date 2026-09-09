import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let bundle: Promise<string> | undefined

/** Run the real install orchestrator with private settings; only Electron and metadata transport are injected. */
export async function versionInstallHarness(root: string, metadataFetch: typeof fetch = fetch, downloadUrl = (url: string) => url) {
  bundle ??= build({
    stdin: {
      contents: `export { installVersion, readVersionJson, listInstalled } from './src/main/core/versions';
        export { getSettings } from './src/main/core/settings';
        export { listFabricApiVersions } from './src/main/core/loaders';
        export { communityDownload } from './src/main/core/community';
        export { installModpack } from './src/main/core/modpacks';
        export { closeHttpClient } from './src/main/core/httpClient';`,
      resolveDir: process.cwd(), loader: 'ts'
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent'
  }).then(result => result.outputFiles[0].text)
  const require = createRequire(path.resolve('package.json'))
  const exported = { exports: {} as any }
  fs.mkdirSync(path.join(root, 'userData'), { recursive: true })
  const electron = { app: {
    getPath: (name: string) => path.join(root, name),
    getVersion: () => 'test', getName: () => 'KAMUCL-test', isPackaged: false
  } }
  new Function('require', 'module', 'exports', 'fetch', await bundle)(
    (name: string) => name === 'electron' ? electron : name === 'undici'
      ? { ...require(name), fetch: (url: string, init: unknown) => require(name).fetch(downloadUrl(String(url)), init) }
      : require(name),
    exported, exported.exports, metadataFetch
  )
  return exported.exports as {
    installVersion: typeof import('../../src/main/core/versions').installVersion
    readVersionJson: typeof import('../../src/main/core/versions').readVersionJson
    listInstalled: typeof import('../../src/main/core/versions').listInstalled
    getSettings: typeof import('../../src/main/core/settings').getSettings
    listFabricApiVersions: typeof import('../../src/main/core/loaders').listFabricApiVersions
    communityDownload: typeof import('../../src/main/core/community').communityDownload
    installModpack: typeof import('../../src/main/core/modpacks').installModpack
    closeHttpClient: () => Promise<void>
  }
}
