#!/usr/bin/env node
// Refuse obsolete global Electron matching and window controls.
console.error('此旧内存脚本已停用：它不能可靠限定测试进程，也不能衡量真实私有内存。请使用 scripts/resource-baseline113.cjs；只会观察其独立测试实例。')
process.exitCode = 2
