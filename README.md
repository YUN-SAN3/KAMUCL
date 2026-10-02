<div align="center">

<img src="build/icon-512.png" width="128" alt="KAMUCL Logo">

# KAMUCL

### ✦ 简约、开箱即用的 Minecraft Java 启动器 ✦

<p>
  <img src="https://img.shields.io/github/package-json/v/kamubaba-i/KAMUCL?filename=package.json&color=c77dff&style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-8ecae6?style=flat-square" alt="platform">
  <img src="https://img.shields.io/badge/license-MIT-ffb4a2?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/Electron-33-9be564?style=flat-square" alt="electron">
  <a href="https://space.bilibili.com/9596327"><img src="https://img.shields.io/badge/Bilibili-作者主页-00AEEC?style=flat-square&logo=bilibili&logoColor=white" alt="Bilibili 作者主页"></a>
</p>

<p>把账号、实例、模组和启动按钮，收进一个清爽的小窗口里。<br>
愿每一次启动，都像打开一扇通往方块世界的传送门。</p>

</div>

## 🌸 功能一览

| 模块 | 说明 |
| --- | --- |
| 🎮 游戏实例 | 创建、删除、重命名、隔离实例，单独设置 Java 与启动参数 |
| 🧩 版本安装 | 安装原版、Fabric、Forge、NeoForge、Quilt |
| 🪪 账号中心 | 微软账号、离线账号、Yggdrasil 自定义认证 |
| 📦 资源管理 | 管理模组、资源包、光影、世界和服务器 |
| 🛠️ 实例管理中心 | 复制、备份、恢复实例，并查看运行诊断 |
| 🔎 社区资源 | 搜索并导入 Modrinth / CurseForge 资源 |
| 🧁 皮肤衣柜 | 角色预览、皮肤与披风上传、历史记录 |
| 🤝 联机 | FRP、VoxLink、Terracotta 和好友直连 |
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

### 直接运行（Windows）

Windows 便携版是单个 EXE，文件名会跟随 `package.json` 的版本号：

```text
release/KAMUCL-<version>.exe
```

首次启动 Minecraft 前，请准备 Windows 10/11 64 位或支持的 macOS、与目标 Minecraft 版本匹配的 Java（现代版本通常需要 Java 17+）和网络连接。Windows ZIP 包解压后需保留同目录下的全部文件。

### 从源码运行

```powershell
git clone https://github.com/kamubaba-i/KAMUCL.git
cd KAMUCL
npm install
npm run dev
```

## 🧰 开发与构建

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发模式 |
| `npm run build` | 构建应用文件到 `out/` |
| `npm test` | 运行自动化测试 |
| `npm run dist` | 构建 Windows 便携版与 ZIP |
| `npm run dist:win` | 构建 Windows 便携版与 ZIP |
| `npm run dist:mac` | 构建 macOS ZIP |
| `npm run dist:all` | 构建全部已配置平台 |
| `npm run license:check` | 校验第三方依赖许可证文件 |

只生成 Windows 单文件 EXE：

```powershell
npm install
npm run build
npx electron-builder --win portable
```

产物输出到 `release/`。构建配置已启用最大压缩、仅保留中英文语言包，并排除 source map。

## 🤝 参与开发

代码协作采用 Fork、功能分支和 Pull Request。提交标题、正文、类型前缀与检查要求见[提交规范](docs/CONTRIBUTING.md)；开发检查清单见[开发指南](docs/DEVELOPMENT.md#9-提交前检查清单)。

### 🌉 构建 KAMUCL Bridge（可选）

Bridge 是给 Fabric 实例使用的本机桥接 MOD。需要 JDK 17+，并且本机已下载 Fabric Loader 与 Gson 依赖：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
node scripts/build-bridge.cjs
```

成功后会生成 `bridge/dist/kamucl-bridge-1.0.0.jar`。构建脚本会从固定的 Fabric Maven 和 Maven Central 地址下载并校验编译依赖；未生成时主程序仍可构建，只是 Bridge 页面无法自动提供内置 MOD。

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

在项目根目录执行 `npm install`，再重新运行命令。

</details>

<details>
<summary><b>构建时提示 Bridge JAR 缺失</b></summary>

这是可选组件提示。设置 `JAVA_HOME` 指向 JDK 后，执行 `node scripts/build-bridge.cjs` 即可。

</details>

<details>
<summary><b>Windows SmartScreen 提示未知发布者</b></summary>

默认构建未配置商业代码签名证书。确认文件来源后即可运行；正式发布建议配置 Windows 代码签名证书。

</details>

<details>
<summary><b>Minecraft 无法启动</b></summary>

检查实例 Java 路径、Minecraft 版本和加载器是否匹配，然后在“设置 → 诊断”中查看日志。

</details>

## 💌 许可证

本项目基于 [MIT License](LICENSE) 开源。

<div align="center">

`Made with Vue · TypeScript · Electron`  ✦  `祝你游戏愉快！`

</div>
