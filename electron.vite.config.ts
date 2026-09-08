import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { readFileSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  main: {
    plugins: [{ name: 'kamucl-native-material', closeBundle() {
      execFileSync(process.execPath, [resolve(__dirname, 'scripts/build-native.cjs')], { stdio: 'inherit', windowsHide: true })
      // 内置桥接 MOD：随启动器分发，面板可一键装入实例 mods 目录
      const bridgeJar = resolve(__dirname, 'bridge/dist/kamucl-bridge-1.0.0.jar')
      if (existsSync(bridgeJar)) copyFileSync(bridgeJar, resolve(__dirname, 'out/main/kamucl-bridge.jar'))
      else console.warn('[kamucl] bridge/dist/kamucl-bridge-1.0.0.jar missing; run node scripts/build-bridge.cjs')
    } }],
    build: {
      outDir: 'out/main',
      minify: true,
      sourcemap: false
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      minify: true,
      sourcemap: false,
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), splash: resolve(__dirname, 'src/preload/splash.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), splash: resolve(__dirname, 'src/renderer/splash.html') } }
    },
    plugins: [vue()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
