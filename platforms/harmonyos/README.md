# 原生鸿蒙电脑工程

本目录是当前 KAMUCL 原生 HarmonyOS PC 的工程接入层，运行相同的生产 main、preload 和 Vue/Three 渲染输出。底层使用维护方 Electron 37.2.0 的 ARM64 原生库、ArkTS 窗口适配器和 HAP 工程，不使用 Android、远程游戏或 Linux 虚拟机。

工程准备、SDK 编译、签名安装、界面验收和原生 Minecraft 游戏运行是不同的门槛。当前版本尚未通过全部门槛，不能称为可发布的完整鸿蒙版。完整状态和操作步骤见 [docs/HARMONYOS.md](../../docs/HARMONYOS.md)。

```text
npm run build
node scripts/prepare-harmonyos.cjs
node scripts/build-harmonyos.cjs --check
node scripts/build-harmonyos.cjs
```

下载运行时只接受 `runtime.lock.json` 固定地址、大小及 SHA256。生成工程放在忽略目录 `out/harmonyos/project`；上游个人签名配置不会复制到生成工程，不读取或打包启动器的用户数据。
