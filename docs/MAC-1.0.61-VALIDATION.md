# macOS 窗口与首次运行修复

源码提交：9e5b7e724b8fce7bd3fe3f8cbc9294c880cba9cf。

- 原来所有非 Windows 平台均使用普通透明无框窗口，缺少原生模糊。macOS 改用 under-window vibrancy，保持活跃材质，并提高界面底色覆盖。
- 使用 hiddenInset 标题栏和原生红绿灯，侧栏预留位置。Windows 的工作区模拟最大化仅在 Windows 执行。
- 原来默认游戏目录只有设置记录，磁盘目录未创建。现在读取设置时创建内置默认目录；用户外置目录不会被隐式创建或替换。

## 验证

- 388 项自动化测试通过；新增默认目录创建、幂等、文件保留及外置目录保护验证。
- 类型检查、许可检查、生产构建通过。
- 生产渲染器 Mac 布局夹具检查通过，Windows 自绘按钮数量为 0，品牌区避开原生按钮。
- [原生 Mac CI](https://github.com/kamubaba-i/KAMUCL/actions/runs/34599855180) ARM64 / x64 均通过 APP 与 DMG 启动检查；主界面正常，默认目录状态 ready。
- Windows 便携 EXE 冷/热入口与 ZIP 解压入口检查通过，EXE / ZIP 中 ASAR 一致。
- Windows 构建首次遇到 GitHub 依赖连接超时，重试使用本机同版本 Electron 33.4.11 未压缩分发文件完成构建。

原生材质模糊由 macOS 提供，视觉强度受系统设置影响，不保证与 Windows DWM 像素相同。Mac 沿用临时签名，未进行 Apple 公证。

成品、对应源码与完整 SHA256：[v1.0.61](https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.61)。本记录是源码标签之后的验证说明，不改变发行标签。
