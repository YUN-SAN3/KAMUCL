# Microsoft Client ID 审计与整改（1.1.22）

检查日期：2026-10-13（Asia/Hong_Kong）。本报告仅列公开应用标识和安全边界，不包含玩家账户文件、授权代码、令牌、API 密钥或应用 secret。

## 原问题与来源

修改前 `src/shared/types.ts:975–978` 明确将 Prism Launcher 注册的 Azure 应用作为默认值，公开 ID 为 `c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb`。`src/main/core/settings.ts:61` 将其写入默认设置，旧设置优先覆盖默认值；旧 Mojang legacy 标识 `00000000402b5328` 也被迁移为该默认。账号没有记录令牌所属 Client ID，刷新时直接读取全局设置，因此替换默认值并不能正确迁移旧授权。

可追溯的首次 Git 记录为 `73a68a3bb318c11847344beec0fbf461f492df98`（2026-09-03，0.4.1 基线）。这说明现有历史何时已包含该值，不推断更早来源或责任人。

[Prism 官方 CMakeLists](https://github.com/PrismLauncher/PrismLauncher/blob/develop/CMakeLists.txt) 的 `Launcher_MSA_CLIENT_ID` 使用同一公开值，并在相邻备注要求重新品牌化时更换平台 API keys。Client ID 是公开应用标识，公开不等于 KAMUCL 拥有该应用；它也不是用户密码或 token，单凭此值不能证明玩家凭据被盗。[Microsoft 对公开 Client ID 和 client secret 的说明](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications)

## 本批唯一正式身份

用户明确提供并要求使用 KAMUCL 自有公开 ID：`06cc8cf6-4b8f-4631-8459-b2bd828808f8`。

| 边界 | 实现位置 | 行为 |
| --- | --- | --- |
| 正式默认 | `src/shared/types.ts:1018` | 仅维护者提供的新 ID，无 client secret |
| 身份冻结 | `src/main/core/microsoftIdentity.ts:5` | 固定 consumers authority、`XboxLive.signin offline_access` 和应用名，无环境或第三方回退 |
| 配置迁移 | `src/main/core/settings.ts:144` | 旧 Prism、legacy、任意自定义值均不能覆盖正式身份 |
| 配置写入 | `src/main/core/settings.ts:228`、`microsoftIdentity.ts:49` | 不同 ID 的设置请求在任何写入前拒绝 |
| 账号绑定 | `src/shared/types.ts:18`、`src/main/core/accounts.ts:436` | 完整服务链成功且安全落盘后记录 `msOAuthClientId` |
| 旧账号 | `microsoftIdentity.ts:41`、`accounts.ts:95` | 绑定旧/未知身份需重新授权，保留账户 ID、UUID、选择及原加密凭据 |
| 登录取消 | `accounts.ts:348`、`:382`、`:518`、`:555` | 身份和操作编号冻结；首请求、轮询、下游、代理 CONNECT/TLS 均支持同一取消；晚回包不能继续或落盘 |
| 刷新 | `accounts.ts:564` | 仅新身份的原绑定令牌；去重、同 UUID、账户移除/更新保护；不发送旧 token 试探新应用 |
| 持久化 | `accounts.ts:129`、`:179`、`:228` | 全平台保留不能解密的旧密文；完整临时文件 fsync 后原子 rename；故障恢复原文件、内存账户和选择 |
| 对外状态 | `accounts.ts:360`、`src/shared/types.ts:63`、`:795` | `accounts:msStatus` 只返回公开身份、重新授权数量和受控错误；没有设备码或凭据 |
| 错误边界 | `microsoftIdentity.ts:31`、`:55`、`:64` | 分类应用拒绝、重授权、网络、证书、存储等；不回显原响应或任意 error_description |

同 UUID 重新登录保留原账户 ID，也不会改变已有选中账号。离线和外置 Yggdrasil 账号不参与微软身份迁移。禁止把新应用身份元数据与系统密钥锁定时遗留的旧密文组合保存；旧账户文件读取损坏时拒绝用空账户覆盖原文件。

## 注册与真实服务资格分别记录

该 UUID 的格式有效，归属依据为用户明确提供的自有身份；本批没有登录其 Entra 管理后台核验租户所有权。单独取得 Application Client ID **不能证明**个人 MSA、公客户端/device code、Xbox scope 或 Minecraft 服务准入已配置，也不能证明授权页应用名、拥有权、游戏启动及刷新成功。

`serviceValidation` 初始为 `unverified`；只有当前运行中完整 OAuth → Xbox Live → XSTS → Minecraft → 拥有权 → 档案 → 安全保存均成功，才为 `verified-this-session`。此状态是一次观察，不是 Microsoft/Mojang 永久批准证书。仍需使用自有注册和明确授权的测试账户进行真实交互；旧玩家令牌没有用于本批测试。[设备码协议](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)、[刷新令牌绑定](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)、[应用注册](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)

本轮第一次不带玩家凭据的自有 ID 设备码端点观察（香港时间 2026-10-13 23:24；原记录 `2026-10-13T15:24:47.993Z`）：HTTP **401**，OAuth `invalid_client`，错误代码 **70002 / AADSTS70002**，**没有取得设备码**。只读证据为 `out/ms122-endpoint-probe-ntPk5E/receipt.json`；未读取任何玩家 profile。该记录没有保存原响应、凭据或授权代码，`clientSecretRequired=false` 不能据此推断应给公共桌面程序嵌入 secret。此次 401 被归类为应用配置或许可问题，而不是玩家账号损坏；不能由这一瞬时结果推断永久不支持该应用，也不切换借用身份。

随后同 ID 的不带玩家凭据观察（香港时间 2026-10-13 23:41；`2026-10-13T15:41:55.330Z`）中，原 scope `XboxLive.signin offline_access` 已返回 **200 / hasDeviceCode=true**；诊断 scope `openid profile offline_access` 也返回 200。两项都没有 OAuth error。此证据只说明当次设备码端点可用，没有消费用户授权或签发/验证 token 链；产品 scope 未因诊断而更换。用户另外确认真实授权界面显示 KAMUCL，但一次实际授权测试在 token 轮询发生 `NETWORK_ERROR` 退出。以上后续观察不能擦除最初 401，也不能作为 Xbox/Minecraft 服务成功、拥有权、刷新或游戏登录通过的证据。

## 真实代理轮询失败与传输修复

定位到明确产品缺陷：原代理分支已建立通过证书校验的 TLS socket，却以 `https.request({agent:false,createConnection})` 发起请求。Node 24 在 `agent:false` 时创建新 Agent，忽略该 `createConnection`，实际建立第二条直连而使隧道闲置。在依赖系统代理的网络上，设备码或轮询因此会失败。

代理分支现在使用无 Agent 的请求和该已验证 socket；直连仍使用 `agent:false`。主机名、证书链、`rejectUnauthorized=true`、TLS 最低版本及官方端点限制均保留，结束/失败/取消时关闭隧道，不接受不可信证书。token 轮询对 `NETWORK_ERROR` 与 HTTP 429/502/503/504 使用同一冻结 ID、设备码和截止期，以 5 秒/10 秒（且不小于服务轮询间隔）退避；连续三次临时失败明确终止。重试不重新获取设备码，证书、应用拒绝及取消直接停止。

新增六项专项后，身份测试 **34 项通过**，与原 TLS/release104 联合 **43/43 通过**，类型检查通过。真实本机 HTTP CONNECT → 受测试 CA 信任的严格 TLS → HTTPS 完整 POST 回归证明：已有 socket 实际被使用、只有一次连接、没有第二次直连/DNS、代理只能看到加密数据、所有专属 socket 最终释放。错误域名与不可信 CA 的反例均在发送正文前拒绝。测试 CA 和私钥仅在专属临时目录生成并清理，没有安装到系统信任库，也未提交测试私钥；这些测试仍不是 Microsoft 真实 token 链通过。

代理修复后的另一次自有应用真实服务记录为 `out/microsoft122-private-f6Zl2y/receipt.json`（只读取去凭据 receipt，未读取 profile）：香港时间 2026-10-14 **00:17–00:32**（UTC 2026-10-13 16:17:00.357–16:32:02.720）。设备码已取得，随后正常等待至服务返回 **DEVICE_CODE_EXPIRED**，没有再次出现 `NETWORK_ERROR`；本次没有收到用户授权回复，不能将等待结束解释为登录成功。记录保持 `complete=false`、`fullServiceChain=false`、`restartRefresh=false` 和 `serviceValidation=unverified`。receipt SHA256 为 `f5f467b1daecbbbb61c0e7f01f3b90a2d9942483c6fcc2b78295d17fe94190b4`。最初 401、人工确认授权页显示 KAMUCL 和旧轮询网络失败记录均保留；真实 token、Xbox/Minecraft 服务链、拥有权及重启刷新仍须新一轮明确交互验收，未调用已存玩家 token。

UI 交叉审查随后发现旧完成事件可能在“取消 → 重新开始”后到达，而原事件没有可比对的操作身份。公开协议因此增加随机 `operationId`：设备码展示信息和完成/失败事件使用同一 UUID，ID 不由设备码或任何凭据派生。主进程 callback 保留旧一/两参数调用者的兼容性，新 IPC/UI 必须携带并核对该 ID。增加成功/失败关联及新流程 ID 唯一性行为测试后，身份专项 **35/35 通过**，类型检查通过；原 release104 精确两参数源码断言因追加第三参数而失败，记录为旧协议测试待同步，不将它视作新版行为通过。根任务负责相应 IPC/UI 和旧事件注入验收，尚未用旧截图推断此新逻辑已通过。

香港时间 2026-10-14 00:38 的独立重复中，身份 35 项与实际 Vite 监听/策略 8 项联合 **43/43 通过**，进程正常退出（测试总时 2942.5952 毫秒，exit 0），不是强制 `process.exit` 结束。此记录仅说明专项的受控连接释放正常；全套共用进程的残留句柄另行定位，不据专项通过推断全套通过。

之后对全套测试的只读句柄诊断定位到历史 `mod-update-reliability-1079` 两个夹具：它们先监听再构建，缺少新 `getCurseforgeApiKey` 模拟接口使构建失败，清理尚未注册而遗留测试服务器。原日志另有两项社区夹具缺少 `getSettings` 及一项新 adm-zip 在枚举前拒绝重复条目却不符合旧中文消息断言，共五项失败。Node spec reporter 使用 `✖`，没有 `not ok` 不能作为通过依据。已只修改四个测试文件的接口契约和夹具清理，不修改产品来隐藏失败；重复条目仍必须拒绝，只额外识别精确的上游 duplicate 错误。追加“setup 失败也关闭真实 listener 并删除任务临时目录”后，相关 **46/46 通过并自然退出**，历史失败日志与创建栈保留在 `out/auth122-handle-diagnostic/`。诊断失败进程按其确切任务 PID 单独停止，没有全局结束 node/electron 或其他应用；该中断不计作全套通过。完整全套仍由根任务重新执行并记录最终结果。

下一次全套已自然退出：1694 项、1692 通过、1 失败、1 Windows 下的 Linux 原生项跳过。唯一失败来自 `linux-update-observer-111` 的真实 Electron 私有观察夹具：主进程、隔离渲染上下文和导航均已通过观察，但它反复覆盖同一 receipt 时，Windows 返回原始 `EPERM`，子进程以 1 退出。原始子输出和错误 receipt 在 `out/linux-context-proof-8Tu00L/`。初步改为导航写盘后的真实 PID acknowledgment，重复第 5 轮仍遇同类覆盖失败，保留在 `out/linux-context-proof-6vICgM/`；不将最初几轮成功当作稳定结论，也不推断 EPERM 必然由父读取独自导致。

最终仅修改该测试夹具，采用不可变阶段 receipt、独占暂存文件原子发布、导航 acknowledgment 后核对任务目录、文件名和 SHA256，退出时只写一次最终 receipt。失败仍必须返回非零；原启动/导航期限、隔离窗口偏好、正确运行时、旧执行上下文销毁后不重试 IPC、最终 exit 0 都没有放宽，也没有注入产品修复或重新启动观察对象。连续 **10 轮真实 Electron 专项，每轮 8/8 通过并自然退出**，原始日志 `out/linux-observer122-immutable-r1.log` 至 `r10.log` 保留；这些是 Windows 上的浏览器协议验证，明确 `nativeDesktop=false`，不是 Linux 原生桌面功能验收。完整全套最终结果仍由根任务记录。

## 自定义服务密钥的追加整改

区别于公开 Client ID，用户填入的自定义 CurseForge API key 是秘密。原实现将它作为普通 `Settings` 字段明文写入、返回 IPC、外观及其他 Settings 响应。整改后 `curseforgeApiKey` 仅可作 write-only 输入，返回对象只有 `curseforgeApiKeyConfigured`。`src/main/core/settingsCredentials.ts:22` 管理主进程专属内存状态，文件仅保存 `secureCredentials.curseforgeApiKey` 的系统 safeStorage 密文；`src/main/core/settings.ts:46` 的主进程 `getCurseforgeApiKey()` 是唯一取值入口，`curseforgeChannel.ts:10` 保留环境变量 → 自定义密钥 → 内置公开应用密钥 → 无密钥镜像的原选择策略。

`settings.ts:58` 统一独占临时文件、fsync、原子 rename，旧明文迁移、普通设置、关联外观迁移和配置重置备份都使用同一安全写入边界。密钥服务不可用时不持久化新的秘密，也不覆盖旧密文；未迁移的旧明文保留原文件并阻止关联设置写盘，直至可安全迁移或用户明确清空。所有失败保持原缓存、凭据及文件；不能解密但已有密文时显示已配置，主进程取值明确报密钥服务错误。备份不复制新的明文密钥。用户此前已有的历史文件/备份没有被全局扫描或删除。

新增 `tests/settings-credentials122.test.ts` **17 项通过**，使用真实设置/主题/外观草稿/资源设置路径、独立临时文件及合成密钥服务。覆盖 write-only 和所有返回路径、迁移、跨平台锁定、原密文保留、相关外观写盘、失败回滚、输入校验和注入、明确清空及加密重置备份。最初联合身份和既有目录/下载目录回归 **55/55 通过**；追加代理修复的六项后，最终此组 **61/61 通过**。一次新增响应路线测试错误读取已在 apply 后按产品语义删除的草稿，17 项中 16 通过、1 测试失败；已改为先检查保存草稿，再执行 apply 并断言删除，未修改产品行为。合成密钥服务不是 Windows DPAPI 或 macOS Keychain 原生验收，不能用此测试声明两平台系统密钥服务或真实 CurseForge 认证已通过。

香港时间 2026-10-14 **01:25**，`scripts/windows-native-storage122.cjs` 另行完成 Windows 原生加密验收：使用同一固定 **Electron 44.3.0 原始未打包运行时**和其原始 DLL，无模拟 `safeStorage`；两个独立进程在新建 APPDATA、LOCALAPPDATA、明确 `--user-data-dir` 及专属 profile 中执行真实 `SettingsCredentials` helper。系统安全存储可用，即时加密/解密及第二进程重启后读取同一加密快照均通过，密文 SHA256 一致，读取未改写文件，公共字段没有明文或密文。两个进程均自然 exit 0，合成私有 profile 已删除；未读取或修改任何既有玩家账户或配置。公开证据为 `out/windows122-native-storage-receipt.json`，SHA256 **`0d20371cbfb5c438c9d5a183aae810370ba08bf0f9685d0a9abbedbb048cd8fe`**，原阶段 receipt 和子进程原始输出保留在 `out/windows122-native-storage-EE2fz4/`，其中只有状态、密文摘要和公开运行时信息。

此项准确分类为原始运行时的 Windows DPAPI 与产品凭据 vault 原生验证，**不是打包 KAMUCL EXE 的 DPAPI 验收**，也不是实际微软/CurseForge 服务调用或 macOS Keychain 验收。此前向打包 EXE 传入外部验证脚本被其 main 忽略、超时且没有生成预期 receipt 的尝试仍失败，不能被本项替换成通过。原始运行时和 DLL 摘要、实际脚本及 helper 源哈希列于 receipt，以便与成品运行时分别核对。

## 验证范围与历史失败

最初 `tests/microsoft-identity122.test.ts` 28 项通过（后续真实代理修复新增六项达到上节的 34 项）：实际产品函数、独立临时文件和受控 HTTP/安全存储响应；覆盖 ID 强制、旧账号零请求、冻结、替换/取消晚回包、完整链及绑定、同 UUID、刷新去重、账号移除、应用拒绝、OAuth pending/slow_down、错误不泄漏、部分文件写入/rename/加密失败、密钥锁定及坏原文件。轮询等待仅在测试调度器中加速，不修改产品代码或时间戳，不用于性能评分。

其中两项测试通过实际 Node HTTP/CONNECT 和 TLS 客户端连接本机专属测试代理，观察取消后的客户端 FIN；代理不连接 Microsoft、不签发认证响应，不允许请求凭据发出。它们验证真实传输取消，不能替代真实 Microsoft 登录。

联合现有 TLS、Linux 安全存储、1.0.4 回归：45 项，44 通过、0 失败、1 项 Linux 原生更新测试在 Windows 跳过。`npx tsc --noEmit` 通过。

第一次新增本机代理测试结果为 45 项：42 通过、2 失败、1 跳过。测试服务器保持 CONNECT 半开连接，已收到客户端关闭却未关闭自身一半，错误等待服务器 `close`。已改为显式观察客户端 `end`/FIN 后关闭测试服务器自己的连接，保留并增强实际取消断言；产品取消实现没有为该失败放宽。授权页名称的用户确认、Windows 原始运行时 DPAPI 的独立验证已在前文单列；真实 Microsoft/Xbox/Minecraft 全链、正版游戏启动、打包成品的系统凭据链及 Mac Keychain 原生交互仍待单列验收。
