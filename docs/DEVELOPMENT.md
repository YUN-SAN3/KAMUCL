# KAMUCL 开发指南

这份文档面向第一次参与 KAMUCL 开发的成员，目标是让你能快速启动项目、找到正确的代码层，并安全地提交一个功能改动。

## 1. 环境准备

### 必需环境

- Node.js 22 LTS 或更高版本
- npm
- Windows 开发建议使用 Windows 10/11 64 位；macOS 构建需在对应架构的原生 Mac 或 CI runner 上进行

### 可选环境

- JDK 17+：构建 KAMUCL Bridge MOD
- .NET Framework：构建 `native/` 下的 Windows 辅助程序（系统通常已自带 `csc.exe`）
- Java：需要与目标 Minecraft 版本匹配；现代版本通常使用 Java 17 或 Java 21，具体实例可以在启动器中单独配置

安装依赖：

```powershell
npm install
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
| `npm run dist:mac` | 构建 macOS ZIP |
| `npm run dist:all` | 构建所有已配置平台 |
| `npm run license:check` | 校验第三方依赖的许可证文件 |

只构建 Windows 单文件便携版：

```powershell
npm run build
npx electron-builder --win portable
```

产物位于 `release/`。版本号来自 `package.json`，portable 文件名由 `build.portable.artifactName` 自动生成。

macOS 发布使用原生架构构建：ARM64 使用 `npx electron-builder --mac dir --arm64`，Intel 使用 `npx electron-builder --mac dir --x64`；发布包、DMG 和公证状态以 `.github/workflows/mac-build.yml` 和 `.github/workflows/mac-dmg.yml` 为准。

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

## 4. 新增一个 IPC 功能

按以下顺序修改，避免出现“前端有按钮但后端没有处理”的半成品：

1. 在 `src/shared/types.ts` 的 `IPC` 中增加通道常量，并定义参数/返回值类型。
2. 如果是主进程推送，在 `IPC_EVENT` 中增加事件名和事件数据类型。
3. 在 `src/main/ipc.ts` 注册 `ipcMain.handle`，对路径、URL、ID 和枚举值做校验。
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

Bridge 只监听 `127.0.0.1`，通过游戏目录中的 `.kamucl-bridge.json` 发现端口和一次性 token。构建脚本会从固定依赖地址下载并校验 Fabric Loader 和 Gson；它是可选组件，缺失不会阻止主程序构建。

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

相关文档：

- [功能树](FEATURE_TREE.md)
- [提交规范](CONTRIBUTING.md)
- [好友直连说明](features/friend-direct-connect.md)
- [Yggdrasil 提供商格式](auth/yggdrasil-provider-card.md)
- [历史版本验收记录](releases/)
