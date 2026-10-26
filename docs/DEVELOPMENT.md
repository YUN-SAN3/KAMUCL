# KAMUCL 开发指南

这份文档面向第一次参与 KAMUCL 开发的成员，目标是让你能快速启动项目、找到正确的代码层，并安全地提交一个功能改动。

本文适用于当前 Windows x64、Mac ARM64 共同代码基线。其他平台工程仍在仓库中，不代表本批交付或已经通过原生验收。

## 1. 环境准备

### 必需环境

- Node.js 24
- npm
- Git 与完整 JDK 17+；`jar` 必须和 `javac` 一起位于 PATH，只安装 Windows 的 Java 启动别名会导致离线皮肤辅助程序构建失败
- Windows 开发使用 Windows 10/11 64 位及 .NET SDK；当前 Mac ARM64 构建需 macOS 13+、Apple Silicon 或原生 ARM64 CI runner，并安装 Xcode Command Line Tools

### 可选环境

- .NET Framework：`native/` 下的 Windows 辅助程序会使用系统中的 `csc.exe`
- Java：需要与目标 Minecraft 版本匹配；现代版本通常使用 Java 17 或 Java 21，具体实例可以在启动器中单独配置

安装依赖：

```powershell
npm ci
node scripts/build-bridge.cjs
```

## 2. 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron + Vite 开发环境 |
| `npm run build` | 构建主进程、Preload 和渲染进程到 `out/` |
| `npm test` | 运行 `tests/all.test.ts` 汇总的测试 |
| `npx tsc --noEmit` | 执行 TypeScript 类型检查 |
| `npm run dist` | 构建 Windows portable 与 ZIP |
| `npm run dist:win` | 构建 Windows portable 与 ZIP |
| `npm run dist:mac` | 在原生 Mac 上构建 APP、ZIP 和 DMG |
| `npm run dist:all` | 构建当前宿主支持的已配置平台；不代表所有平台已经验收 |
| `npm run license:check` | 校验第三方依赖的许可证文件 |

只构建 Windows 单文件便携版：

```powershell
node scripts/build-bridge.cjs
npm run build
npx electron-builder --win portable
```

产物位于 `release/`。版本号来自 `package.json`，portable 文件名由 `build.portable.artifactName` 自动生成。

`build` 包括主进程、预加载、渲染器以及原生和离线皮肤辅助程序。单独 Vite 渲染器构建只能证明界面编译成功，不替代完整生产构建。不要手动升级或降级本批锁定的 Electron 44.3.0 来掩盖平台问题。

当前 Mac ARM64 发布在 Apple Silicon 上执行 `node scripts/pack-mac.mjs arm64 --package-only`，生成 APP、ZIP 和 DMG，然后执行对应原生启动及功能验收。跨平台压缩一个目录不能代替对应架构的原生构建。本批不提供 Intel 原生验收结论；发布包、DMG、ad-hoc 签名与公证状态以 `.github/workflows/mac-build.yml` 和 `.github/workflows/mac-dmg.yml` 的实际产物和记录为准。

## 3. 代码分层

```text
src/renderer/  Vue 页面和组件，只通过 src/renderer/src/api.ts 调用后端
      │
      ▼
src/preload/   暴露受限的 invoke / send / on API，不直接开放 Node.js
      │
      ▼
src/main/ipc.ts IPC 通道注册、参数边界和错误转译
      │
      ▼
src/main/core/ 业务模块：版本、账号、下载、启动、联机、资源等
      │
      ├─ src/shared/types.ts 共享类型、IPC 常量和事件契约
      ├─ native/               Windows 原生辅助程序
      └─ bridge/               Fabric Bridge MOD（游戏内本机服务）
```

页面入口和导航集中在 `src/renderer/src/App.vue`；前后端共享契约集中在 `src/shared/types.ts`。新增功能时，优先复用现有 `core/` 模块，不要在 Vue 组件里直接读写文件或启动进程。

当前模块边界：

- `src/renderer/src/views` 负责页面组合；独立组件与 composable 承担确认、队列、草稿和画布交互。页面退出可以卸载展示，但后台任务生命周期由应用级注册表保持。
- `src/renderer/src/api.ts`、`src/preload`、`src/shared/types.ts` 定义受控 IPC 合同，前端不直接导入主进程服务。
- `src/main/ipc.ts` 注册业务入口；外观资产入口独立在 `src/main/assetsSettings.ts`，资产事务在 `src/main/core/appearanceAssetActions.ts`。失败时先保留旧设置和图片，不先删除再保存。
- `src/main/core` 的下载、安装事务、存档、Java、账号、联机、更新和文件验证分别维护自己的契约；`src/shared` 只放共享类型与纯策略。
- 更新来源探测在 `src/main/core/updateSources.ts`，正式下载适配在 `src/main/core/updateDownload.ts`，共用原有下载引擎；测速流不能当作已完成附件，也不能改变官方哈希信任来源。

运行 `node scripts/audit-module-boundaries.cjs BASE_COMMIT out/module-audit.json` 对比静态导入图。它区分类型边和运行时边、列出循环及越层依赖；不等价于完整调用图或功能验收。公共核心服务的既有调用关系不能为了报告好看随意拆断。

个性化配置的 `data-ui` 标识及完整父路径属于持久化兼容合同。提取 Vue 组件时须固定旧标识、保留父层结构，并用真实旧配置验证；新的文件名自动生成标识可能使旧自定义失效。

## 4. 新增一个 IPC 功能

按以下顺序修改，避免出现“前端有按钮但后端没有处理”的半成品：

1. 在 `src/shared/types.ts` 的 `IPC` 中增加通道常量，并定义参数/返回值类型。
2. 如果是主进程推送，在 `IPC_EVENT` 中增加事件名和事件数据类型。
3. 在 `src/main/ipc.ts` 或它接入的专属入口模块注册 `ipcMain.handle`，对路径、URL、ID 和枚举值做校验。
4. 将实际业务放到 `src/main/core/<feature>.ts`，不要把长流程全部写进 IPC 回调。
5. 在 `src/renderer/src/api.ts` 添加类型化封装。
6. 在对应 Vue 页面调用 API，并处理加载中、成功、失败和取消状态。
7. 在 `tests/` 增加核心逻辑测试；涉及页面行为时补充 UI 回归测试。
8. 运行类型检查、相关测试和一次完整构建。

IPC 约定：

- `invoke` 用于请求-响应操作；长任务通过 `IPC_EVENT.progress`、`taskDone` 等事件反馈。
- 主进程错误要转换为用户可读信息，不能把 token、密码或完整命令行写入日志。
- 文件路径必须经过现有目录解析器和边界检查，不能信任渲染进程传入的绝对路径。

## 5. 修改 Minecraft 启动流程

启动相关逻辑主要位于：

- `src/main/core/launch.ts`：命令行、Java 进程、Quick Play、结束与重启
- `src/main/core/versions.ts`：版本 JSON、继承链和库文件
- `src/main/core/gameSession.ts`：运行会话状态
- `src/main/core/gameWindow.ts`：游戏窗口处理
- `src/main/core/launchPreparation.ts`：启动前资源、Java 和完整性检查
- `src/main/core/instanceCenter.ts`：实例复制、备份、恢复和运行诊断

修改启动参数后至少验证：

- 原版、Fabric、Forge 或 NeoForge 各一个实例
- Java 版本自动匹配和实例独立 Java
- 启动失败时状态能回到 `error`，且日志可导出
- 正常结束、快速重启和启动器关闭行为
- 带服务器地址的 Quick Play 路径

不要用实例显示名推断 Minecraft 或 Loader 版本；应读取真实版本 JSON、继承链和 Maven 坐标。

## 6. 测试方式

测试入口是 `tests/all.test.ts`，其中汇总了下载、版本、模组、联机、皮肤、主题、启动和 UI 回归测试。

运行全部测试：

```powershell
npm test
```

运行单个测试文件：

```powershell
npx tsx --test tests/direct-connect.test.ts
```

测试原则：

- 网络请求、临时目录和进程句柄优先使用测试替身，不依赖个人 Minecraft 目录。
- 写文件的测试使用临时目录，并在结束时清理。
- 修复回归问题时，测试名应描述用户行为或根因，而不是只写版本号。
- 修改公共类型或 IPC 后，先运行相关测试，再运行完整测试集。

新增测试须登记 `tests/all.test.ts`。先执行相关单元与事务测试，再执行完整测试、类型检查、生产构建和许可证检查。测试使用独立临时配置与实例，只控制所属测试进程；禁止按 `electron.exe` 或 Java 名称杀死所有进程。

界面须在最终生产渲染器上使用真实坐标操作，记录实际视口、系统 DPI、缩放、主题、截图与失败。IPC 夹具、真实网络读取、本地 HTTP 回放、实际落盘和真实游戏启动必须分别标注。软件 GPU 或云端原生桌面不能冒充真实用户图形硬件；没有设备或原文件的项目保留“未覆盖”。

本批专项入口：`tests/community-121.test.ts`、`tests/appearance-assets-actions.test.ts`、`tests/update-mirrors121.test.ts`、`tests/compatibility-121.test.ts`。隔离界面入口是 `scripts/verify-appearance-121-ui.cjs` 和 `scripts/verify-community121-ui.cjs`；`scripts/verify-mac-batch121.cjs` 在原生 Mac ARM64 CI 上协调最终生产渲染器的四外观主题、六社区主题、最小/1366 窗口及 100%/125% 矩阵。隔离 IPC 与软件 GPU 不能代替现有真实 APP/DMG、启动、游戏、工具和更新验收。

513 MiB 嵌套包回归会流式生成约 1 GiB 临时磁盘数据，退出后清理自己的目录，原始用户包不参与公开测试。

## 7. Bridge 与原生辅助程序

构建 Windows 原生辅助程序由 `electron-vite build` 自动触发：

```text
native/WindowMaterial.cs  → out/main/WindowMaterial.exe
native/GameWindowFocus.cs → out/main/GameWindowFocus.exe
native/StartupFeedback.cs → out/main/StartupFeedback.exe
```

构建 Bridge MOD：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
node scripts/build-bridge.cjs
```

Bridge 只监听 `127.0.0.1`，通过游戏目录中的 `.kamucl-bridge.json` 发现端口和一次性 token。构建脚本会从固定依赖地址下载并校验 Fabric Loader 和 Gson，生成 `bridge/dist/kamucl-bridge-1.0.1.jar`；实例可按需启用此 MOD，但完整生产构建必须先生成内置 JAR，缺失会阻止构建。

## 8. 数据目录与调试

默认用户数据目录是 Windows 的 `%APPDATA%\KAMUCL`（macOS 为 `~/Library/Application Support/KAMUCL`），设置文件位于 Electron `userData` 目录下。开发调试时建议使用独立临时目录，避免污染个人账号和游戏实例。

调试重点：

- 渲染进程：开发者工具 Console、Network 和页面状态
- 主进程：终端输出、启动器日志和 `event:launchLog`
- 下载任务：任务面板、`event:progress`、`event:taskDone`
- 启动问题：从“设置 → 诊断”导出日志，不要直接复制包含凭据的完整命令行

## 9. 提交前检查清单

- [ ] `npx tsc --noEmit` 通过
- [ ] 相关测试通过，必要时 `npm test` 全量通过
- [ ] `npm run build` 成功
- [ ] 没有把 `node_modules/`、`out/`、`release/` 或个人数据提交进 Git
- [ ] 没有提交账号 token、密码、私有地址或本机绝对路径
- [ ] 用户可见行为、协议或安全边界变化已同步到 `docs/`
- [ ] 如果修改版本号，确认构建产物名称和发布说明同步

## 10. 发布与数据保护

每批同步更新 `package.json`、`package-lock.json` 根版本及 `src/shared/updateNotes.ts`，日志日期采用香港本地 `YYYY-MM-DD HH:mm`。master 与 main 保留独立历史，通过 cherry-pick 同步意图明确的提交；main 的已有文档差异需人工合并保留。不操作 wuhui，不强推。

成品须干净解压、启动、核对 ASAR 版本和附件 SHA256，源码须使用已提交的 Git 原始 blob。排除用户账号、配置、私钥、整合包、存档及无关文件；构建缓存和运行证据不直接整目录放入源码。标签显式绑定最终 master 提交；Release 发布后核对公开状态、标签、提交和全部附件的大小与哈希。

项目许可字段为 `SEE LICENSE IN LICENSE`。原始 KAMUCL 贡献的 MIT 范围、第三方许可及源码条件分别见根目录 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`licenses/` 和[对应源码说明](CORRESPONDING_SOURCE.md)。执行 `npm run license:check`，未解决许可来源时不能发布。

相关文档：

- [功能树](FEATURE_TREE.md)
- [提交规范](CONTRIBUTING.md)
- [好友直连说明](features/friend-direct-connect.md)
- [Yggdrasil 提供商格式](auth/yggdrasil-provider-card.md)
- [历史版本验收记录](releases/)
