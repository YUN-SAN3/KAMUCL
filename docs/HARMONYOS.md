# 原生 HarmonyOS PC 接入与验收门槛

目标是鸿蒙电脑（`2in1`）上的原生 KAMUCL，使用当前同一份业务代码、Vue 页面、Three 模型和动效资源。手机、平板、Android 兼容容器、Linux 虚拟机、远程游戏不属于本交付。

## 当前状态

2026-10-04 已实际取得维护方 Electron 37.2.0 ARM64 运行时及其完整 ArkTS/HAP 工程，并完成产品接入与文件检查。工程可在 `out/harmonyos/project` 打开；不是仅展示页面的 ArkTS 占位工程。此状态**不等于可发布的鸿蒙版**。

| 门槛 | 实际证据 | 状态 |
| --- | --- | --- |
| 维护方运行时取得 | 完整 ZIP 364,103,698 字节，SHA256 固定；内层 TAR 也校验 | 已完成 |
| 原生工程接入 | `electron` entry、`web_engine` HAR、ArkTS XComponent 与原生 adapter | 已完成工程准备 |
| 同一产品输出 | main、preload、renderer 逐文件与当前生产输出比对 SHA256 | 文件检查已完成 |
| ABI 与数据隔离 | 四库均为 ARM64 ELF；不复制用户数据、上游签名、其他系统二进制 | 文件检查已完成 |
| SDK/Hvigor 编译 | 本机未安装官方 SDK；官方工具列表接口未登录返回 HTTP 401 | 未完成；未生成 HAP |
| 签名、JIT 授权与安装 | 没有产品签名配置、授权 profile 或真实鸿蒙电脑 | 未覆盖 |
| 原生界面、毛玻璃与动效 | Electron 37 与当前桌面 Electron 44 存在版本差异 | 未覆盖；不能由文件相同推断 |
| 本地 Minecraft JVM 与 native libraries | 尚无逐版本通过的 OHOS JVM/JNI/图形/音频组合 | 未覆盖，产品阻止错误平台回退 |
| FRP、安装器、更新与游戏进程生命周期 | 需要 OHOS 可执行文件、权限及实际服务/设备验证 | 未覆盖 |
| 维护方运行时完整第三方许可 | 当前二进制归档未附完整 notices；文档和源码许可证不能代替全部二进制许可 | 未完成，阻止公开 HAP 发布 |

`out/harmonyos/inspection-evidence.json` 是工程检查结果；`build-evidence.json` 是编译门槛结果；`compile-attempt.log` 保留未能开始编译的原始原因。它们均明确包含 `gamePassed`、`realDevicePassed` 或对应字段为 false，不能作为完整验收通过报告。

## 固定运行时与来源

使用[维护方 v37.2.0 release](https://gitcode.com/CPF-Electron/Electron/releases/tag/v37.2.0) 的 `v37.2.0-openharmony-arm64.zip`，固定 release target `cc29ebbebf505ea8e68290e998212eec6b4b4e3b`，资产 ID 64049。完整来源、两层归档摘要和四个库的摘要保存于 `platforms/harmonyos/runtime.lock.json`。

SHA256：`57bf0314ce3f5be80fc7a7ebc4f47a2fe82a5e4afcf5fe856ad9cfc342618946`。该摘要来自本次完整下载后的本地计算，不冒充维护方签名。维护方[源码分支](https://gitcode.com/zhangqingnan_codeing/Electron_CPF/tree/v37.2.0-openharmony) 的当前提交另有记录，不能假定其与二进制构建提交相同。

实际 release 工程的兼容 SDK 为 `5.0.5(17)`、Hvigor modelVersion 为 `5.0.0`；新维护文档提及的 SDK 26 不应直接当作这份旧二进制的已验证编译环境。正式编译需记录实际 DevEco、SDK、Hvigor、ohpm 和签名工具版本。

维护方工程提供原生 ArkTS 窗口、文件选择、权限及系统接口；应用资源位于 `web_engine/src/main/resources/resfile/resources/app`。产品入口 `entry.cjs` 验证原生平台、ARM64 和运行时版本后加载同一 `out/main/index.js`。主窗口、预加载和全部前端仍由现有生产构建产生。详见[维护方接入指导](https://gitcode.com/CPF-Electron/Electron/blob/main/README.md)。

## 可复现工程准备

在仓库完成 `npm ci`。准备脚本依赖根锁文件已有的 `adm-zip`、`json5` 和 `tar`；它们只用于构建工程。

```powershell
npm run build
node scripts/prepare-harmonyos.cjs
node scripts/verify-harmonyos.cjs
node scripts/build-harmonyos.cjs --check
```

准备脚本下载固定归档到忽略目录 `out/toolcache/harmonyos`，校验大小和 SHA256，再提取真实维护方工程。生成项目仅覆盖具有本脚本标记的 `out/harmonyos/project`；不会覆盖手工工程或启动器数据目录。

工程处理包括：

- 清除维护方个人签名资料和路径，生成未签名 build-profile。
- 设置 `com.kamucl.launcher`、当前版本、KAMUCL 图标和标签，仅面向 `2in1`。
- 保留 ArkTS 原生窗口与重复启动的实际路由，移除模板的多应用实例声明。不会调用维护方明确不支持的 Electron 单实例锁接口。
- 将相同生产 main、preload、renderer 原样复制，包含现有许可证文件；不复制 Windows/macOS/Linux 辅助执行文件或 Windows 专用 koffi 本机库。
- 固定维护方 ArkTS adapter 的 inversify 6.0.1、reflect-metadata 0.1.13，实际 ohpm 安装后仍须保存并核查其完整依赖锁文件。
- 以白名单复制应用构建和锁定依赖，不读取账号、收藏、图片、游戏目录、存档或用户设置。
- 缩减模板中当前产品不使用的定位、相机、蓝牙等权限；保留网络、文件授权、剪贴板、麦克风和运行时所需权限。自定义 JIT 权限仍需签名 profile 与设备确认，声明权限并不等于获得授权。

`frontend-parity.json` 保存每个生产文件的来源、大小与摘要。共享产品代码修改并重建后，必须重新准备与检查；旧工程检查不能为新产物背书。

继续实施新增固定模板适配：`scripts/harmony-native-adaptations.cjs` 校验十个原 ArkTS 文件的 SHA256，再接入关闭确认、真实 Browser 就绪、多目录授权及失败重试。标准 Electron 对话走 `DialogAdapter`，Chromium 的目录选择走 `FilePickerAdapter`，两者都等待真正授权和记录落盘。`native-adaptation-evidence.json` 保存修改前后摘要；该源码适配尚未经官方 SDK 编译或真机执行，不构成设备通过证据。授权激活失败会明确提示，默认不启动；可重试，或者明确继续后重新选择目录，后者不会被记录成授权已恢复。

本次检查曾因并行的公共生产构建更新而拒绝旧工程的 `out/main/index.js` 摘要；该失败保留，重新准备后才通过。单独的负向检查实际篡改一个预加载文件、临时放入空的 `settings.json`，以及在 Windows 执行鸿蒙入口，三项均在预期原因被拒绝并恢复工程。负向检查只证明相应保护有效，不证明鸿蒙实机功能。

## 官方 SDK 编译与签名

由具有下载权限的开发者通过[华为官方 Command Line Tools 指导](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/ide-command-line-building-app-V14) 取得官方工具；本次未绕过登录、读取浏览器凭证或使用 OpenHarmony/Linux 工具冒充 HarmonyOS SDK。

工具目录应包含 `bin/hvigorw.bat`（其他系统为 `hvigorw`）、ohpm 和 SDK。对已授权的安装路径设置：

```powershell
$env:KAMUCL_HARMONY_COMMAND_LINE_TOOLS = 'D:\Tools\command-line-tools'
node scripts/build-harmonyos.cjs
```

该脚本先重新检查工程、记录 Hvigor 版本、执行真实 `ohpm install --all`，再执行真实 `assembleHap`。没有官方 SDK、依赖安装失败、ArkTS 编译失败或无 HAP 输出均返回非零；保留原始日志，不创建假 HAP、不将低于门槛的结果改为通过。工具自身所需 JDK/Node 和 SDK 环境按官方文档配置，不修改用户全局依赖源。

签名文件留在仓库外，通过 DevEco 配置本人的证书、profile 和 keystore；不得提交密码、密钥或复用上游示例签名。官方文档说明未签名 HAP 不能在真实设备运行，且需要启用代码签名。安装后还须确认原生 Chromium/Electron 的 JIT、文件持久授权、窗口、音频和进程权限。

当前构建脚本只生成工程内的未签名产物和证据，不把未签名包上传 Release。签名、许可完整性和设备验收通过之前，`publishable` 始终为 false。

## 原生游戏运行门槛

Electron 的原生 HAP 能力不自动提供 Minecraft 的原生运行链。后续必须逐项取得并验证：

1. 各受支持游戏/加载器版本要求的 OHOS ARM64 JVM，含动态库加载、JIT、堆内存及本地进程生命周期；不能下载 Linux ARM64 Java 当作鸿蒙 Java。
2. 对应版本的 JNI、LWJGL、GLFW、OpenGL/OpenAL 等 OHOS 原生库，确认显示、键鼠、音效、模组和关闭保存行为；不能使用 Linux classifier 补齐。
3. Forge/Fabric/NeoForge 等实际安装和启动过程，以及子进程、执行路径与签名/HNP 权限。
4. 实机启动普通实例及真实用户整合包；核对资源、存档和下载校验，使用隔离测试目录，不修改原包或旧实例。

现在共享平台描述将 `openharmony/ohos` 独立映射为鸿蒙，游戏运行状态为“需验证”，明确拒绝 Linux/Windows native 与 Java 回退。这个保护不代表游戏功能已经实现；完整鸿蒙版只有在上述门槛通过后才可交付。

## 后续验收与公开发布

使用真实鸿蒙电脑记录三类主题、最小窗口与缩放下的功能截图、原始录屏和帧时间。覆盖皮肤绘制及关闭确认、卡慕互动和声音同步、导入、收藏、登录、文件授权、更新、托盘/焦点和实际游戏启动。分别记录真实服务与夹具结果，进行独立视觉、交互和动效评分；未经实际听测的音效单列未覆盖。

补齐运行时第三方 notices、对应源码和许可后，才能生成可公开分发的签名 HAP。最终源码、工程、HAP、SHA256、设备/系统/SDK版本及原始失败记录应一致绑定最终提交；工程准备的成功不能代替这些验收。
