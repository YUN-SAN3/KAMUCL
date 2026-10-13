# KAMUCL 1.1.22 安全、历史与供应链审计

审计日期：2026-10-14，Asia/Hong_Kong。本报告区分源码修复、合成故障验证、既有 1.1.21 成品检查和待执行的 1.1.22 原生成品验收。原任务书要求“仅审计”；本次人类用户另外明确授权自有 Client ID 接入、确定问题整改及公开致歉，因此本批有代码整改。原任务书和无关未提交文件未改动。

## 结论及证据范围

在下述已扫描字节及人工分类范围内，**未发现已确认的私密 Microsoft/GitHub 令牌、OAuth Client Secret、云服务私钥或真实玩家账号文件被提交到公开源码/1.1.21 分发包的证据**。这不是“整个项目没有秘密或安全风险”的证明。Prism Client ID 是公开应用身份，实际应用身份复用见 [CLIENT_ID_AUDIT.md](CLIENT_ID_AUDIT.md)，不能推导为玩家令牌已经泄漏。

已确认的产品存储缺陷是旧樱花穿透访问密钥明文落盘并返回界面，以及用户自定义 CurseForge key 的普通设置存储。FRP 的 schema 3 加密、旧配置原子迁移、界面/IPC 边界已经整改并经过隔离测试；CF 设置整改由认证/设置任务负责，最终复验见总报告。源码里还有一个内置 CF 应用 key：归属及允许客户端分发的依据只有源码声明，仍需维护者材料，不将其认定为 Prism key、真实玩家密码或已证实盗用。

官方 npm advisory 的修复前结果是 **18 个受影响包条目：7 high、11 moderate、0 critical**；最小兼容补丁后的实际结果是 **14 个受影响包条目：3 high、11 moderate、0 critical**。这是依赖条目及传播影响的计数，不是 18 或 14 个独立漏洞，也不是当前启动器全部可达的利用链。原结果分别保存在 [NPM_ADVISORY_AUDIT.json](NPM_ADVISORY_AUDIT.json) 和 [NPM_ADVISORY_AUDIT_AFTER.json](NPM_ADVISORY_AUDIT_AFTER.json)，未删掉剩余告警。

## 覆盖与方法

- 初始当前 tracked 范围为 **11,504 个文件**；2026-10-14 01:08 香港时间補扫为 **11,568 个文件、655,384,252 字节**，包含本批新源码、测试、许可和报告路径，精确清单见 [SECURITY_SCAN_COVERAGE.json](SECURITY_SCAN_COVERAGE.json)。每个实际读取文件都有 size/SHA256；HEAD 是工作区基线，不能把多人修改期间的逐文件读取说成某个 clean commit 的原子快照。原始补扫前覆盖保存在 `SECURITY_SCAN_COVERAGE_BASELINE.json`。必要生成结果自身和无关根目录未提交文件被明确排除，未检查私有 `out` 测试账户或真实玩家配置。后续代码/报告变更不能冒充这个时点已读取的字节。
- 最新所有本地 refs 可达 **809 个提交、18,647 个对象、14,277 个唯一 blob、705,085,777 字节**均完成原始字节扫描，没有历史大文件截断。早期基线为 806 个提交／14,274 blobs，两次之间其他任务更新了本地 refs，原覆盖记录保留。包括分支、远端跟踪 refs 和标签可达内容；扫描器没有修改任何 ref。未覆盖 dangling/reflog-only 对象及未 fetch 的远端历史，不宣称 GitHub 的全部历史都已取得。
- 历史扫描发现 594 个候选，其中 562 个是公开应用 ID；其余 32 个分布在 17 个唯一值指纹中，逐项人工核查。前一轮当前候选为 505 个，其中 488 个公开 ID、17 个其他候选；补扫包含本批新的合成测试，数量变化在 JSON 中保留，不能当作新增真实泄漏。判断和脱敏定位见 [SECURITY_REVIEW_CLASSIFICATION.json](SECURITY_REVIEW_CLASSIFICATION.json)。
- 既有发布源码 ZIP 11,505 个 regular entries、648,755,329 解压字节；Windows 兼容 ZIP 28 个 regular entries、328,715,399 字节；紧凑 Windows ZIP 21 个 regular entries；Mac ARM64 ZIP 67 个 regular entries、270,218,617 字节均读取，没有 512 MiB 单条审计限制触发。没有 `accounts.json`、`auth.json`、`credentials.json`、`.env`、PFX/P12/JKS 状态文件名命中。
- Windows 实际 ASAR `1b6b85d8…` 内 382 个 packed files、18,860,296 字节；Mac ASAR `75981e18…` 内 444 个 packed files、19,780,237 字节逐个解包扫描。ASAR unpacked 的原生组件从实际外层包扫描，两平台各两个内置 JAR 又解码检查 22 个文件，包含 `.class` 常量及资源原始字节。二进制检查覆盖完整 ASCII 字节和 PE UTF-16LE 字符串；**没有反编译、反汇编或执行这些二进制**，压缩/混淆的未知隐藏格式不是已验证范围。EXE 内 NSIS 压缩 payload 的内容结论依赖实际同批兼容 ZIP/ASAR 和既有成品来源绑定，不能仅凭 EXE strings 无命中证明无秘密。DMG 文件系统/签名由原生包流程另验，Windows 没有把 DMG 当作已挂载扫描。
- 依赖锁共 552 个条目；读取 435 个本机存在的依赖 manifests，115 个当前平台缺少的条目列出而非假装检查过。424 个 URL 解析项均有 integrity，405 个 npm 官方 registry、19 个 npmmirror，其余 128 项没有解析 URL。镜像不是已证实恶意来源，integrity 存在也不证明包作者可信。
- 检查实际四个 npm install/postinstall 实现及 60 个含 lifecycle 元数据的 manifests；Electron 44.3 的下载入口另外静态核查。`prepare` 只是包 metadata，不应宣称这些 60 个钩子都在 `npm ci` 执行。桥接编译依赖固定 Maven URL+SHA256；自有 C#/Swift/Java 组件有源文件及构建脚本，Koffi/Electron 的二进制/许可来源见其他审计材料。

使用 Git、Node、官方 npm advisory 元数据和自定义脱敏离线扫描。Gitleaks、TruffleHog、Trivy、Syft、ScanCode、licensee 在本机未找到，**未运行这些工具，也没有伪造其结果**。检测器不执行 hooks、不访问已发现 key、不读真实用户账号、不上传源码/秘密。npm audit 仅向官方 registry 发送公开依赖名和版本，不是源码上传。官方 Action 来源核查只用匿名公开 Git/REST；REST 的 403 原样记录并改用隔离 Git 对象校验，不借用任何发现的令牌。

可复现命令：

```text
node --test scripts/audit-security122-tests.cjs
node scripts/audit-security122.cjs E:/KAMUCL --history --artifacts
node scripts/audit-advisories122.cjs
npm audit --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json
node --import tsx --test tests/frp-secure122.test.ts tests/frp-service-clear122.test.ts tests/frp-manager.test.ts tests/frp-worker.test.ts tests/security-devserver122.test.ts scripts/mac-auth122-tests.cjs
node scripts/review-security122-classification.cjs
```

`--artifacts` 明确指既有 **1.1.21** 四个 ZIP，不是 1.1.22 产物。Action 解析/固定脚本包含已授权的工作流修改，只应在重新明确整改时执行，不能称纯只读审计命令。新成品尚需使用实际 release 路径再次调用导出的 `scanZip`，并绑定正式源提交和成品 SHA。

## 发现、条件与整改

| 编号 | 级别／置信度 | 证据与适用条件 | 影响与状态 |
|---|---|---|---|
| SEC-01 | HIGH／高 | 1.1.21 `src/shared/types.ts` 的 Microsoft 默认值及旧设置迁移；官方来源交叉验证见 Client ID 报告 | 已确认复用第三方应用身份。源码已替换为用户提供的 KAMUCL ID，旧账号不误刷新；新应用实际服务验证失败/未完整登录，不回退借用身份。不是私密 token 泄漏结论。 |
| SEC-02 | MEDIUM／中 | `src/main/core/curseforgeKey.ts:2`，脱敏指纹 `f0fe1a77e3852628`；历史 `community.ts` 同值及当前成品 main bundle | 内置应用 key 可从分发包读取是事实，归属和分发授权不能仅从“registered for KAMUCL”注释得到。待维护者/供应商确认，不测试其有效性，不输出值，不自动轮换。 |
| SEC-03 | HIGH／高 | 1.1.21 `frpManager.ts:12,21–34,64`、`frp.ts:118–137` 和 `frpService.ts:7–10`；key 原样 JSON 保存并回传 public 状态 | 已确认存储/进程隔离边界缺陷，未确认已被第三方取得。新版 `frpSecureStore.ts` 只把 key bag 写系统密文；old v2 和旧独立 config 在安全存储可用时原子迁移。锁定/解密失败保留旧文件，明确待解锁，不宣称旧明文已加密。public state/events 无 key；空输入在 main 复用，确认清除只停止自己 worker 并保留卡片。独立发现的两文件清除 P2 和状态提示问题已修，详见下节；AES-GCM/失败注入通过，实际 Windows DPAPI/Mac Keychain 和最终 UI 另验。 |
| SEC-04 | MEDIUM／高 | 原五个 `.github/workflows/*.yml` 共 74 个 `actions/*@v4/@v7` 标签引用 | 已固定为六个官方真实 commit SHA，没有升级 major 或更改权限、job gate、历史 QA 阈值。新增 `mac-auth122.yml` 的四次引用也使用这些已核实 SHA，共 78 次固定引用。每个官方 refs、fetched commit/tree、REST 403 及时间见 `ACTION_PIN_PROVENANCE.json`；不能说匿名 REST 核查成功。 |
| SEC-05 | HIGH／高（受影响依赖存在）；可达性逐项 | 锁定旧 adm-zip 0.6.0；small-pack、MOD/JAR icon、元数据、native 提取等调用。`modpacks.ts` 的路径/ratio/header 限制不能证明 header.size=0 的真实 DEFLATE 输出有界 | 升到官方 0.6.1。0.6.0 本地源码已修部分 STORED eager allocation，不能用 0.5.17 PoC 冒称当前也会预分配同样 1.8GB；但零 size/async inflate guard 缺口真实存在。完整回归与最终包依赖版本核验必须保留。 |
| SEC-06 | MEDIUM／高（依赖存在）；当前利用路径未证可达 | 旧 undici 6.28.0 的三个 GHSA；实际 `httpClient.ts:12` 只用 Agent/fetch，VoxLink `session.ts:4` 使用 ws | 已补到 6.28.1。当前未发现 Undici WebSocket 或 RetryInterceptor 的生产调用，不将公告直接当作 VoxLink 已遭攻击。Node/Electron 自带 fetch 是另一实现，npm 包升级不自动修它。 |
| SEC-07 | MEDIUM／高（剩余依赖告警存在）；条件式影响 | Vite 5.4.21、electron-vite 2.3；npm 仍报 14 个影响包。Vite 当前 5.x 无官方新 patch，最早相应补丁为 6.4.2/6.4.3，而 electron-vite 2.3 peer 只支持 Vite 4/5 | 新开发策略显式 127.0.0.1、限定 CORS/Host/fs，CLI 合并后公网 bind 也在 listen 前拒绝。真实 Vite 模块/HMR/负例通过；这是暴露面限制，**不是对 Vite 旧漏洞的 backport 或全部清零**。正式包不运行 dev server。后续 build-tool 兼容升级和其余 transitive patches仍待评估，不能自动用 audit 推荐 downgrade/major 覆盖现有构建。 |
| SEC-08 | LOW／高 | `frp.ts` Windows 固定官方 HTTPS URL 无附带 SHA256，既有本地 frpc 可由用户替换；Mac/Linux 分支有固定哈希 | 不能把 Windows 外部 frpc 的来源核验写成与内置 ASAR 相同。未证明恶意或已被替换；进一步做可信发布哈希及明确自定义客户端流程，不能自动覆盖用户选择的客户端。 |

SEC-02 的初期引入及移位定位：`9db56e1f94cae10f7d34c5fe58189032d18e5a80`（及独立 main 的 `17b4abd9875516937cb8fd05cfefc476c9171adf`）中 `community.ts:186`；拆出 `curseforgeKey.ts:2` 的提交为 `b9760b02a38a3b72a3c53434e0cbb1807571eb55`（main 对应 `926aea984532313ff05f671b29889e5a11ef0920`）。`--find-object` 提供可追溯 blob 改变定位，不声称它证明某个 key 的外部注册日期或所有权。

## 依赖公告的实际适用性

最小补丁的版本、官方 npm tarball integrity、engines、peer 声明均在 [ADVISORY_RELEASE_METADATA.json](ADVISORY_RELEASE_METADATA.json)。没有把有效 SHA512 等同于许可证或作者身份批准。

- adm-zip 0.6.1 保持 Node >=14，官方发布列明 async 错误、权限位和重复 entry 等修补。[维护者发布](https://github.com/cthackers/adm-zip/releases/tag/v0.6.1)、[维护者分配公告](https://github.com/cthackers/adm-zip/security/advisories/GHSA-7q85-xj36-vmfc)。本项目有读取用户 ZIP/JAR 的实际入口，不能仅因“大包已经流式”忽略小包与图标路径。
- Undici 6.28.1 保持 Node >=18.17，修复未请求 WebSocket subprotocol、inflate error 和 retry framing；项目现有 HTTP 路径与公告接口区分。[维护者发布](https://github.com/nodejs/undici/releases/tag/v6.28.1)。
- sharp 0.35.5 的公告针对 glibc Linux/librsvg 特定 SVG 解码条件，本项目作为开发依赖使用且最终 Windows/Mac runtime 不包含 sharp；补丁提高 QA/素材工具安全，不能宣传成已经修复正式 Windows 图片功能中的远程 RCE。[维护者公告](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)。source-map-js 1.2.2 同为最小补丁；实际生产 sourcemap 关闭，构建工具不等于运行服务。
- Vite 网络暴露、NTFS ADS/8.3 或可预测 `.map` 内容是不同前置条件，默认 loopback 不等于 CVE 已消失，也不能把未来 `--host` 覆盖当成已经不会发生。[维护者 Windows 路径公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)、[维护者 `.map` 公告](https://github.com/vitejs/vite/security/advisories/GHSA-4w7w-66w2-5vf9)。旧 esbuild 的 development server 告警未发现 `esbuild.serve()` 生产调用；不因此删掉原 advisory 结果。

剩余 brace-expansion、fast-uri、http-cache-semantics、sprintf-js 及传播到 builder/get/roarr/global-agent 的条目均保留在 after JSON。Windows/Mac 成品实际嵌入的五个 runtime 依赖与开发构建链区分；能否到达某个 devserver、跨用户 cache 或格式化输入，尚没有完整动态利用验证。公开 registry 不存在 `http-cache-semantics@4.2.1`、`sprintf-js@1.1.4`，不能虚构补丁或强行改 major。后续可兼容包更新需各自回归，而非用一条 `npm audit fix --force` 掩盖结果。

## 已验证的边界与尚未覆盖

静态确认主窗口 sandbox/contextIsolation 开启、nodeIntegration 关闭；认证 HTTPS 端点采用受控域、证书及主机名校验、禁止带凭据重定向。诊断导出已有令牌/用户目录脱敏；1.1.22 认证错误改用阶段化安全摘要。插件运行界面仍属于额外受信任扩展边界，本次不是所有插件/IPC 的渗透测试，也未将任意潜在代码执行推断为已证实利用。

已运行 scanner 脱敏测试 **5/5**；FRP 原功能及 worker 17、加密存储 15、真实 service 两文件故障注入 6、真实 Vite 策略 8，加上 Mac 证据合同/真实小 ASAR 提取 5，最终专项共 **56/56** 自然退出，原始输出保存在 `out/security122-targeted-final.log`；TypeScript 检查退出 0。这些数量不代替父任务最终全量回归、原生 UI、生产包启动和 Mac 验收。AES fixture 不是实际 DPAPI/Keychain，ws/本地 sockets不是公开联机服务，未记录帧率、音频或游戏运行“通过”。Mac 合同曾因 Windows 宿主 ASAR 路径分隔符失败两次（各 4/5），修复读取表示后真实小 ASAR 复验 5/5；不是原生 Mac 功能失败，也不凭这五项宣称 Mac 已通过。

独立评审者保留 `out/compliance122-frp-clear-repro.json`：早期 service 先清除 `frp-config.json`、后写 `frp-tunnels.json`，第二次 rename 失败时旧独立配置已经改变，原注册表仍保留；当时“原文件不变”的全局表述不准确。整改后 service 使用同一存储事务预检两个文档及快照，对两个写入比较预期字节，失败时反向恢复本次已经提交且当前仍吻合的文件。真实 service 组合测试分别核对第二提交失败、可重试、外部修改拒绝覆盖、回滚本身失败、损坏次文件、陈旧主快照、rename 已提交但报告失败、密钥服务锁定；正常可恢复失败的两个原字节逐点相同。外部变化或恢复失败时明确提示“部分写入无法自动恢复”，保留其当前状态，不能再说所有原文件都保留。同步多文件回滚**不保证掉电/进程崩溃时跨文件原子性**；文件系统 compare-before-rename 也不是跨程序原子 CAS，不把未测试的极窄外部竞态推断为通过。

同一独立评审者在 `out/compliance122-frp-clear-recheck.json` 对实际新存储方法另做五组复现，**5/5**，将原失败 receipt SHA256 `4ac4f71c307c6a9b82db250a9d85707b74926c243ef78796b7d42bd34bebd80c` 绑定到复评。覆盖第二提交失败、提交后报错、外部改变、恢复失败、锁定下成功，并明确保留多文件掉电/外部 CAS 和真实 keyring 未覆盖限制；这五组不等于五项原生验收。

真实界面复评还发现：明确清除后系统仍锁定时，早期界面沿用“原密钥已保留”兜底文字。产品 `manager.list()` 和界面已改成区分“本机密钥已清除”和“系统安全存储仍不可用”；不能伪造解锁或隐藏不可用状态。实际 store/manager 回归核对清除后 `configured=false, locked=true`，随后解锁才恢复 `locked=false`。

新的 `.github/workflows/mac-auth122.yml` 只为本批变化创建原生 ARM64 成品和专项证据：完整 npm test/类型/许可/构建，原 ZIP 解压和只读挂载 DMG 的架构、来源、严格 ad-hoc 签名、ASAR及原始 runtime notices核验；两个原 APP 实际启动；从这两个成品 ASAR 提取原 renderer，使用同版本原生 Electron 执行隔离 IPC 的坐标验收；实际系统 safeStorage 在两个独立进程间加解密随机合成值。合同要求 Accounts、CF、FRP 各 16 个不重复的主题×视口×缩放组合及每项失败恢复标志，缺少任何必测矩阵直接失败。证据仅上传原包、日志、受控 receipt和截图，不上传 profile、账号、设备码、密文或 renderer临时目录；失败原样保留，没有 `continue-on-error`。流程实现及离线合同通过不等于任务已经在 Mac 实际执行；原 Mac 整个平台失败及未覆盖项目仍保留，专项成功也不能替代真实 Microsoft 登录、游戏、联机、动作或 Gatekeeper 公证验收。

真实新 Microsoft 应用的首次 device-code 请求返回 401/`invalid_client`，随后同一产品 scope 已取得 200/设备码，用户也确认官方授权页显示 KAMUCL；一次真实授权随后在 token 轮询出现 `NETWORK_ERROR`。这些是独立时点，不能抹去旧失败，也不能替代 Xbox/Minecraft 全链、拥有权、续期或游戏登录，后续最新绑定结果以 Client ID/最终报告为准。审计没有使用发现的第三方凭据去检查其他人的账户，没有轮换、撤销或改写历史。若以后发现真实秘密，应先完成受授权的轮换与公开历史处理方案；当前候选结果不能当作已经需要撤销其他人的应用。

发布前仍须绑定最终提交、全量测试及两平台实际新产物，再复核账户/FRP/CF 密文、界面边界、活动 ID、依赖补丁和许可附件。其他版权/许可待核实项以对应报告为准；本报告不能给出“整个项目已全面合规/可商业销售”的结论。
