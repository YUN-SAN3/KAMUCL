<div align="center">

<img src="build/icon-512.png" width="128" alt="KAMUCL Logo">

# KAMUCL

### ✦ 简约、开箱即用的 Minecraft Java 启动器 ✦

<p>
  <img src="https://img.shields.io/github/package-json/v/kamubaba-i/KAMUCL?filename=package.json&color=c77dff&style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-8ecae6?style=flat-square" alt="platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-See%20LICENSE-ffb4a2?style=flat-square" alt="license: see LICENSE"></a>
  <img src="https://img.shields.io/badge/Electron-44.3.0-9be564?style=flat-square" alt="electron">
  <a href="https://space.bilibili.com/9596327"><img src="https://img.shields.io/badge/Bilibili-作者主页-00AEEC?style=flat-square&logo=bilibili&logoColor=white" alt="Bilibili 作者主页"></a>
  <a href="https://space.bilibili.com/526277131"><img src="https://img.shields.io/badge/Bilibili-代码贡献者-00AEEC?style=flat-square&logo=bilibili&logoColor=white" alt="Bilibili 代码贡献者主页"></a>
</p>

<p>把账号、实例、模组和启动按钮，收进一个清爽的小窗口里。<br>
愿每一次启动，都像打开一扇通往方块世界的传送门。</p>

</div>

## 🌸 功能一览

KAMUCL 基于 Electron 44.3.0、Vue 和 Three.js。当前交付 Windows x64 和 macOS ARM64；其他平台工程仍在仓库中，验收范围以对应 Release 为准。

| 模块 | 说明 |
| --- | --- |
| 🎮 游戏实例 | 创建、删除、重命名、隔离实例，单独设置 Java 与启动参数 |
| 🧩 版本安装 | 安装原版、Fabric、Forge、NeoForge、Quilt |
| 🪪 账号中心 | 微软账号、离线账号、Yggdrasil 自定义认证 |
| 📦 资源管理 | 管理模组、资源包、光影、世界和服务器 |
| 🛠️ 实例管理中心 | 复制、备份、恢复实例，并查看运行诊断 |
| 🔎 社区资源 | 搜索并导入 Modrinth / CurseForge 资源 |
| 🧁 皮肤衣柜 | 角色预览、皮肤与披风上传、历史记录 |
| 🤝 联机 | FRP、[VoxLink](https://github.com/AUGUHDAR/VoxLink)、[陶瓦（Terracotta）](https://github.com/burningtnt/Terracotta)和好友直连 |
| 🛠️ MOD 面板 | 通过 KAMUCL Bridge 实时读取与修改 MOD 参数 |
| ✨ 个性化 | 主题、背景、快捷键、插件和启动页缩略图 |
| 🩺 诊断 | 下载任务、日志导出、启动诊断、更新与回滚 |

> 完整的页面与业务模块关系见[功能树](docs/FEATURE_TREE.md)，开发流程见[开发指南](docs/DEVELOPMENT.md)。
> 好友直连的网络边界见 [`docs/features/friend-direct-connect.md`](docs/features/friend-direct-connect.md)。

## 📚 文档导航

| 文档 | 适合阅读时机 |
| --- | --- |
| [功能树](docs/FEATURE_TREE.md) | 想了解页面、功能和代码模块的对应关系 |
| [开发指南](docs/DEVELOPMENT.md) | 第一次搭建环境、开发功能或提交代码 |
| [提交规范](docs/CONTRIBUTING.md) | Commit 标题、正文、类型前缀和 Pull Request |
| [好友直连说明](docs/features/friend-direct-connect.md) | 调试联机、端口映射和邀请流程 |
| [Yggdrasil 提供商格式](docs/auth/yggdrasil-provider-card.md) | 接入或排查外置认证服务器 |
| [诊断记录](docs/diagnostics/) | 排查启动器、整合包和运行时问题 |
| [发布验收记录](docs/releases/) | 查看历史版本变更与回归结果 |
| [对应源码](docs/CORRESPONDING_SOURCE.md) | 从发布包重建并核对源码 |
| [第三方许可](THIRD_PARTY_NOTICES.md) | 查看依赖许可证与源码说明 |

## 🚀 快速开始

请从 [GitHub Releases](https://github.com/kamubaba-i/KAMUCL/releases) 下载对应平台的成品，并使用该版本的 `SHA256SUMS.txt` 核对文件。源码包不是可直接双击的应用。

### 直接运行（Windows）

Windows 便携版是单个 EXE，文件名会跟随 `package.json` 的版本号：

```text
release/KAMUCL-<version>.exe
```

首次启动 Minecraft 前，请准备 Windows 10/11 64 位、与目标 Minecraft 版本匹配的 Java（现代版本通常使用 Java 17 或 21）和网络连接。Windows ZIP 包解压后需保留同目录下的全部文件。复制可执行文件不会自动复制用户配置目录中的账号、图片、收藏和游戏数据；分享整个文件夹前，请检查是否另行放入了用户数据。

### 直接运行（Mac ARM64）

要求 macOS 13 或更新版本及 Apple Silicon。打开 ARM64 DMG，把 `KAMUCL.app` 拖入“应用程序”，推出镜像后运行；或解压 ARM64 ZIP，把应用移入“应用程序”再运行。不要选择 Intel 包，也不要在只读 DMG 内执行更新。

当前包使用 ad-hoc 签名，未做 Apple Developer ID 签名与公证；如系统要求确认，请在“系统设置 → 隐私与安全性”按系统提示处理，不需要关闭整个系统的安全检查。

游戏保存到设置中选定的游戏目录。安装到另一个磁盘时，请在“设置 → 游戏 → 游戏文件夹”添加并设置默认目录，并在安装确认页核对实际目标。离线账号不会获得正版在线服务器的验证权限。

每个版本的真实验证范围、平台差异及尚未覆盖项目在 Release 和交付文档中独立说明；构建成功不等同于所有第三方模组、游戏版本和图形设备都兼容。

### 从源码运行

安装 Node.js 24、完整 JDK 17 或更新版本以及 Git；Windows 原生辅助程序需要 .NET SDK，macOS 原生辅助程序需要 Xcode Command Line Tools。确认 `node`、`npm`、`javac` 和 `jar` 都在 PATH 中。

```powershell
git clone https://github.com/kamubaba-i/KAMUCL.git
cd KAMUCL
npm ci
node scripts/build-bridge.cjs
npm run dev
```

行为修改需保留旧设置、收藏、图片和实例；用户的整合包、存档与账号凭据不能进入公开源码。构建与验证命令、代码分层、平台适配、测试证据和发布流程见[开发指南](docs/DEVELOPMENT.md)。

## 🧰 开发与构建

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发模式 |
| `npm run build` | 构建应用文件到 `out/` |
| `npm test` | 运行自动化测试 |
| `npm run dist` | 构建 Windows 便携版与 ZIP |
| `npm run dist:win` | 构建 Windows 便携版与 ZIP |
| `npm run dist:mac` | 在原生 Mac 上构建 APP、ZIP 和 DMG |
| `npm run dist:all` | 构建当前宿主支持的已配置平台；不代表所有平台已经验收 |
| `npm run license:check` | 校验第三方依赖许可证文件 |

只生成 Windows 单文件 EXE：

```powershell
npm ci
node scripts/build-bridge.cjs
npm run build
npx electron-builder --win portable
```

产物输出到 `release/`。构建配置已启用最大压缩、仅保留中英文语言包，并排除 source map。完整生产构建包括主进程、Preload、渲染器、原生与离线皮肤辅助程序；单独渲染器编译不替代完整构建。本批锁定 Electron 44.3.0，不应通过手动换版本掩盖平台问题。

当前 Mac 发布在 Apple Silicon 上执行 `node scripts/pack-mac.mjs arm64 --package-only`，再运行对应原生 APP/DMG 和功能验收；跨平台压缩目录不能代替原生 ARM64 构建。具体流程见[开发指南](docs/DEVELOPMENT.md)。

## 🤝 参与开发

代码协作采用 Fork、功能分支和 Pull Request。提交标题、正文、类型前缀与检查要求见[提交规范](docs/CONTRIBUTING.md)；开发检查清单见[开发指南](docs/DEVELOPMENT.md#9-提交前检查清单)。

### 🌉 构建 KAMUCL Bridge

Bridge 是给 Fabric 实例使用的本机桥接 MOD，实例可按需启用；完整生产构建要求提前生成内置 JAR。需要完整 JDK 17+：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
node scripts/build-bridge.cjs
```

成功后会生成 `bridge/dist/kamucl-bridge-1.0.1.jar`。构建脚本会从固定的 Fabric Maven 和 Maven Central 地址下载并校验 Fabric Loader 与 Gson 编译依赖；未生成时完整构建会报告缺失。

## 🗂️ 项目地图

```text
src/main/       Electron 主进程、Minecraft 管理与 IPC
src/preload/    渲染进程安全桥接 API
src/renderer/   Vue 页面、组件与主题
src/shared/     共用类型、协议和常量
bridge/         KAMUCL Bridge MOD（Fabric）
native/         Windows 原生辅助程序（材质、聚焦、启动反馈）
scripts/        构建、发布与回归测试脚本
tests/          自动化测试
docs/           功能说明、构建说明与版本验证记录
```

## 💾 数据、日志与隐私

启动器运行数据默认保存在 Windows 的 `%APPDATA%\KAMUCL`（macOS 为 `~/Library/Application Support/KAMUCL`），包括账号、设置、缓存和日志。反馈问题时，请先隐藏账号令牌、个人路径和公网 IP。

## ❓ 常见问题

<details>
<summary><b>提示「electron-vite 未找到」</b></summary>

在项目根目录执行 `npm ci`，再重新运行命令；使用 Node.js 24 和仓库锁定的依赖版本。

</details>

<details>
<summary><b>构建时提示 Bridge JAR 缺失</b></summary>

完整构建要求此 JAR。设置 `JAVA_HOME` 指向完整 JDK，确认 `javac` 和 `jar` 在 PATH 中，然后执行 `node scripts/build-bridge.cjs`。

</details>

<details>
<summary><b>Windows SmartScreen 提示未知发布者</b></summary>

默认构建未配置商业代码签名证书。确认文件来源后即可运行；正式发布建议配置 Windows 代码签名证书。

</details>

<details>
<summary><b>Minecraft 无法启动</b></summary>

检查实例 Java 路径、Minecraft 版本和加载器是否匹配，然后在“设置 → 诊断”中查看日志。

</details>

## 💌 许可证与致谢

项目的 `package.json` 许可字段为 `SEE LICENSE IN LICENSE`。原始 KAMUCL 贡献适用 [LICENSE](LICENSE) 中限定范围的 MIT 条款；第三方代码保留各自许可，请同时阅读 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、`licenses/` 和[对应源码说明](docs/CORRESPONDING_SOURCE.md)，以具体条件为准。

联机模块的实现离不开以下开源项目的支持：

- **[VoxLink](https://github.com/AUGUHDAR/VoxLink)**：由 [AUGUHDAR](https://github.com/AUGUHDAR) 开发，提供开箱即用的房间码联机方案，无需端口映射或公网 IP。感谢作者及所有参与远程联机测试的贡献者
- **[陶瓦联机（Terracotta）](https://github.com/burningtnt/Terracotta)**：由 [Burning_TNT](https://github.com/burningtnt) 基于 [EasyTier](https://github.com/EasyTier/EasyTier) 开发，采用 AGPL-3.0 许可，为 Minecraft Java 版提供 P2P 联机能力。

<div align="center">

`Made with Vue · TypeScript · Electron`  ✦  `祝你游戏愉快！`

</div>
