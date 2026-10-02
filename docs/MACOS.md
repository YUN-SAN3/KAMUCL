# KAMUCL 1.1.5 · macOS

本次以当前 1.1.5 源码补齐 macOS 支持，不递增版本，也不替换已有 Windows 发布附件。两种架构共享同一套界面、主题、皮肤预览与玻璃启动动画。

## 安装

- Apple Silicon（M1/M2/M3/M4 等）选择 `KAMUCL-1.1.5-mac-arm64.dmg`。
- Intel Mac 选择 `KAMUCL-1.1.5-mac-x64.dmg`。
- 打开 DMG，将 `KAMUCL.app` 拖入“应用程序”，然后从应用程序中启动。ZIP 包解压后也按此方式放置。
- 包使用本地 ad-hoc 签名，未使用 Apple Developer ID，也未公证。如果系统拦截，请在确认下载来自本仓库后，到“系统设置 → 隐私与安全性”确认打开。无需关闭系统整体安全保护。
- 对照 Release 的 `SHA256SUMS.txt`，可在终端执行 `shasum -a 256 下载的文件路径`。

## 使用与平台行为

红色关闭按钮只关闭窗口，联机房间继续运行；点击 Dock 图标可重新打开。退出应用会清理本启动器的联机服务，但不会强制结束正在运行的 Minecraft。

启动器自动选择和下载适配架构的 Java。较旧 Minecraft 使用 Intel 原生库时，Apple Silicon 需要 Rosetta；现代版本可使用 ARM Java。应用与原生辅助程序的最低部署版本统一为 macOS 11，GitHub 原生验证环境为 macOS 15，其他系统版本不等同于已实测。

Terracotta 0.4.2 和 SakuraFRP 0.51.0-sakura-14 使用官方 Mac 客户端，按架构下载、校验并赋予执行权限。樱花穿透仍需用户自己的访问密钥和隧道；微软登录仍需用户自己的正版账户。

更新选择本架构的 ZIP，经 SHA256、应用标识、架构与签名检查后，等待下次启动应用。请先移出只读 DMG，不要直接在挂载卷内使用更新功能。设置内可选择本地 ZIP，也可从备份回退。

更新会在应用旁保留 `.KAMUCL-backup-标识.app`。如果新应用未能正常启动，不会为自动回退而强杀游戏；可在 Finder 按 `Command+Shift+.` 显示隐藏文件，将新应用改名保留后，把该备份改名为 `KAMUCL.app`。游戏、账户和设置存放在用户数据目录，不随应用包替换。

## 构建与验证

双架构构建使用仓库的 **macOS packages** GitHub Actions 工作流。在对应架构的 Mac 上也可运行 `npm ci`、`npm run dist:mac`；需要 Node.js、Java 17 与 Xcode Command Line Tools。构建会包含桥接 MOD、运行依赖和原生窗口辅助程序，不复用旧版本 ASAR 缓存。

验收脚本包括原生应用启动、皮肤实际像素、黑橙半透明主题的桌面毛玻璃、玻璃碎片鼠标排斥与头像重组、减少动态效果、官方联机工具下载启动、真实应用更新与回退，以及通过启动器安装并运行 Minecraft 的验证。具体结果以该发布附带的验证报告为准。

完整验收结果与限制见 [macOS 1.1.5 验收报告](MACOS_VERIFICATION_1.1.5.md)。
