# KAMUCL 1.1.11 独立平台一致性评审

评审人：独立子 agent `independent_platform_parity`。基线为 Windows 1.1.10，提交 `85bfe93c016a004b7ddbd397c6b8769bedd25c50`。本文件为实施中的证据清单和静态评审，不表示新平台已经通过验收。

## 当前结论

所有 1.1.11 平台的视觉、交互、动效分数暂为 **未评分**。尚未收到与最终源码及产物 SHA256 绑定的完整原生截图、原始录屏、功能操作和启动证据，不能依据共享代码、打包成功或历史 Windows 通过记录推断新平台通过。平台逐项状态见同目录 `parity-matrix.json`。当前库存为 15 个页面、280 个 IPC 通道、14 个需人工核对的动态表达式，14 组共 63 项功能场景；非 Windows 有 62 项适用，另列一项已批准的内存整理差异。JSON 完整性检查仅验证库存内部结构，不表示这些功能已运行通过。

目标：macOS 13+ Apple Silicon 与 Intel；Ubuntu 24.04／26.04 x64 与 ARM64；原生 HarmonyOS PC。Windows 1.1.11 作为本批公共代码的回归基准。macOS／Linux 使用锁定的 Electron 44.3.0；HarmonyOS 运行时版本差异必须在产物清单及行为验收中注明。

已授权的差异：系统窗口控件、原生文件对话框与桌面材质可遵从操作系统；非 Windows 不实现针对其他进程的 Windows PSAPI 内存整理；仅发布 x64 原生库的第三方模组必须准确提示架构不兼容。应用内容、主题、交互结果和已支持的游戏能力不得静默删除。操作系统原生安装器需要确认，不等于已完成升级或回滚。

## 逐平台放行条件

1. 每个 OS、架构及安装形式单独绑定源码提交、版本、产物大小和 SHA256、内嵌 ASAR／资源哈希、运行时版本、宿主架构、系统及显示环境。原生 ARM64 与 x64 均实际运行；模拟或跨架构运行不能替代对应原生验收。
2. 功能矩阵中的所有适用项目及接口合同通过，遗漏、未实现和未测项目均不能计入通过分子。接口库存由代码生成，包含声明的共享 IPC、字面量注册、前端调用以及需要人工核对的动态注册表达式；静态库存不等于运行证明。
3. 独立评审视觉、交互、动效三项分别达到 **9/10**，无关键缺陷。分数不得平均，也不得用其他平台的分数填补未测平台。
4. 同一组去隐私夹具、图片、主题、CSS 视口与缩放、动画状态用于 Windows 和目标平台截图。检查黑紫、黑橙、浅色、自定义；960×620 最小窗口和 100%／125%／150% 常用缩放；所有页面及加载、空、正常、失败、禁用、半选状态。只对已授权的系统差异使用比对遮罩。
5. 使用真实坐标、键盘和原生窗口焦点完成操作；程序直接调用 DOM／IPC 的结果作为对应层证据，不能冒充真实鼠标与外部服务验证。故障注入要同时证明失败恢复后的用户状态。
6. 原始录屏、帧时间、接触和音频事件保留。产品 rAF／DOM 更新计数不能代替屏幕呈现帧。沿用当前彩蛋采集门槛 `min(30 FPS, 实际显示器刷新率)`，缺失刷新率仍按 30 FPS；60Hz 正常原生启动按既有 55–63 FPS 门槛核对。低于门槛标为失败，不重采样、不插帧、不调整断言掩盖失败。
7. 声音混音峰值、音画接触时间及资源释放可测，但物理听感需另列实际听测；未听不能记为通过。减少动态效果与后台暂停另行验收。
8. 清洁用户目录冷启动、重启持久化、干净解压／安装、更新失败与回滚、卸载保留用户数据，以及实际 Minecraft 启动、进入世界、保存与正常退出均需对应产物证据。发行附件中不得含用户凭据、世界、PCL 私有包或无关未提交文件。

## 证据分级和状态

- `passed`：该项目有当前原生产物的完整证据，操作结果符合基线。
- `failed`：证据显示缺陷、低于固定门槛或必要的操作结果不符。
- `not-tested`：实现可能存在，尚无足够当前证据；不评分、不推断通过。
- `blocked`：原生运行链、SDK、硬件或外部条件缺失，阻断这一项完整验收；明确条件及已有证据，不能改称完成。
- `approved-exception`：用户已明确允许的 OS 差异。与通过项分列，不能扩展为其他缺失功能的豁免。

记录服务类别：真实平台／CDN、真实操作系统及文件／WebGL、合成夹具、故障注入、静态审计、原始屏幕录制、物理听测。每条证据应有相对路径、SHA256、来源分类、平台／架构、源码／产物身份、采集时间、预期与实际结果。历史失败必须留存并关联修复后的复测，不能把历史报告改为通过。

## 静态问题与复核记录

| ID | 问题 | 当前状态 |
|---|---|---|
| QA-001 | 旧验收仅 `1.1.9` 进入单卡慕测试，`1.1.10` 错用七人横扫；导入、选择与本轮 UX 漏测。 | 当前入口已改为 `ui-capabilities.cjs`，Mac 必测清单加入单卡慕、PCL、选择与四主题 `ux110`。代码已复核，原生执行证据待收。 |
| QA-002 | Mac 旧材质验收按黑紫 96% 底色说明，与 1.1.10 的 30%／26% 基线不符。 | 当前 Mac 脚本说明已修正，保留真实桌面底色切换的透明效果检查。新版视觉实测待收。 |
| AUTH-001 | `accounts.ts` 的磁盘密文缓存仅在加载时更新；刷新令牌保存后密钥环锁定，再次保存会覆写回旧密文。 | 已发送主 agent；当前 `persist` 成功写入后已同步清空并重建缓存，静态修复复核完成。锁定恢复和删除账号的回归证据待收。 |
| UPDATE-001 | 初版 Linux 更新器在新应用未确认就绪时仅保留备份，未自动恢复旧程序；与既有失败回滚结果可能不一致。 | 当前代码已加入未就绪回滚：只终止 PID 与进程启动时间均一致的本次应用，再核对新旧摘要、恢复备份并重启旧版。TAR 也拒绝空路径段和重复目标。静态复核完成，真实桌面故障注入与原生安装器交接仍待测。 |
| GATE-001 | 原发布门控仅查摘要、布尔值与分数；一份声称 `synthetic fixture only`、无原生帧的 JSON 可在隔离负例中代替全部证据并放行。 | 已修复为下述 schema 2。41 项协议测试通过，包含真实文件哈希、伪来源、旧身份、漏项、低采集帧率及不足 9 分的拒绝。协议测试使用临时合成文件，不是新平台产品验收。 |
| QA-003 | `ux110` 文本日志仍打印 `PASS 1.1.10`。 | 收到的四主题 JSON 与截图显示实际版本 1.1.11；不能按文字日志推断执行旧版。最终证据仍需补源码身份和原生命令回执，当前限于局部回归。 |
| QA-004 | 最新 gallery118 在旧 `metadataRequests.length===2` 处失败，实际为 8；1.1.10 自动图标补元数据与手动关联共用查询，旧总数不再对应两次关联。 | 已独立复核修订：真实 favoriteLink handler 包装精确记录两次参数、先拒绝后确认，并保留实际存储 keys、收藏时间、SHA1 合并与对话框关闭断言；详情检查每次为正确 MOD 来源，并要求两平台都实际调用。所有元数据请求继续保留。修订是替换无效观测点，没有放宽真实业务结果；复跑证据待收，历史失败不得覆盖。 |

## 已复核的 Windows 局部回归

实际 EXE 为 `release/KAMUCL-1.1.11.exe`，大小 **97290244**，SHA256 **dd584c92935c71ebdcd5ca379d0f1f851c9a07b604a9dcdfd6f2a1986e8142c7**。四主题 `out/appearance-motion-<theme>-110.json` 均为 1.1.11，`complete=true`。每个结果、原始帧清单、日志及已查看截图的摘要已记录于 `parity-matrix.json` 的 Windows 局部证据；该记录没有原始源码提交绑定，因此不提升为最终身份验收。

已逐一查看四主题首页与收藏页截图：所采样布局中未见文字截断、缺字或原生蓝色复选框；首页壁纸实际渲染，黑紫自定义主题表面为 30%／侧栏 26% 混色；旧、新收藏均显示解码后的图片。收藏图片和项目元数据来自注入夹具，不能据此宣称真实 Modrinth／CurseForge 图标接口通过。主页模型也是纯色测试皮肤，不能据此评估卡慕纹理还原度。

最小请求窗口与 125% 缩放的坐标点击、Space 切换和重新加载保持状态有对应结果。保留实际 CSS 视口数值：最小请求 960×620 的采集结果为 962×622，1280×900、125% 的 CSS 视口为 1024×720；不把截图文件名当作实际测量，不改写这些数值。自定义主题最小窗口截图中随机播放卡、主题勾号与键盘焦点均可见。

原始 `Page.startScreencast` 帧逐个核对存在与摘要、时间严格递增，所有帧均保留。独立查看自定义主题的第 0、75 帧可见实际手臂和腿部姿态变化。下表是原始采集频率，不能称为显示器呈现帧率，也不能代表启动碎片和彩蛋的完整动效评审。

| 主题 | 原始帧数 | 原始时长（秒） | 按原始时间计算的采集 FPS | 最大原始间隔（秒） |
|---|---:|---:|---:|---:|
| transparent | 151 | 1.4869189262390137 | 100.87974357782058 | 0.014821052551269531 |
| black-orange | 151 | 1.4971139430999756 | 100.19277469916875 | 0.015316009521484375 |
| blue-white | 150 | 1.489361047744751 | 100.04290109884481 | 0.015627145767211914 |
| custom | 150 | 1.4893040657043457 | 100.04672882534065 | 0.015031099319458008 |

另核对 `out/windows-package-1.1.11.json` 与对应日志：干净目录的 EXE／ZIP 冷、暖启动及解包比较记录完成，ASAR 摘要为 `b03fe16bb64a0bb341069db58b736e3aaeffb8866495f45f1bc4c82dcc64b5f1`。这仍未覆盖全部 63 项功能、真实账号和服务、实际游戏及更新回滚、15 页与主题／状态／缩放组合、完整音效听测和最终源码身份。Windows 的三项分数继续为 **未评分**，完整一致性为未通过验收；其他平台状态没有被此证据填充。

## 发布门控证据协议

`scripts/platform-release-gate.cjs` 导出 `verifyPlatformRelease(root, version)` 和独立的 `verifyHarmonyRelease(root, version)`；只读检查，不执行发布。前者读取 `release/platform-acceptance.json`，必须同时覆盖 **windows-x64、mac-arm64、mac-x64、linux-x64、linux-arm64**。Linux 两个架构各须有 Ubuntu 24.04 与 26.04 的原生桌面运行记录。后者读取 `release/harmonyos-acceptance.json`，只接受 harmonyos-arm64；桌面放行不能代表鸿蒙完成。

顶层对象为 `{schema:2, scope:"desktop"|"harmonyos", version, sourceCommit, independentReviewer, platforms}`。源码提交必须等于本地 HEAD，版本必须同时等于包版本与独立库存版本。每个平台行为 `{id, artifacts:[{name,size,sha256}], evidence:[{id,kind,path,sha256}]}`；所有名称与数量必须符合正式范围，Windows 三种包、Mac 两种包、Linux 三种包、鸿蒙 HAP。文件格式／机器类型、大小、SHA256 实际读取核对。路径必须是仓库相对路径，并拒绝越界、绝对路径和通过链接逃出仓库。

每个 evidence 指向 JSON schema 1：

```json
{
  "schema": 1,
  "kind": "native-run",
  "source": "native-product",
  "version": "1.1.11",
  "sourceCommit": "最终提交 SHA",
  "platformId": "mac-arm64",
  "architecture": "arm64",
  "runtimeVersion": "44.3.0",
  "artifactSHA256": {"全部本平台最终附件名称": "实际 SHA256"},
  "host": {"platform": "mac", "architecture": "arm64", "osVersion": "macOS 13.7", "displayFrequency": 60},
  "run": {"id": "原生命令 ID", "source": "native-desktop", "command": "实际命令", "exitCode": 0, "startedAt": "ISO 时间", "endedAt": "ISO 时间"},
  "payload": {"nativeReceipt": "receipt.json"},
  "attachments": [{"id": "receipt.json", "role": "native-receipt", "path": "仓库相对路径", "sha256": "实际 SHA256", "size": 123}]
}
```

此例仅说明字段，省略具体观测，**不是合格的验收证据**。允许的原生来源为 native-product、native-capture、native-game、real-service、fault-injection；fixture、static、build-only 不可替代原生操作。截图／录屏／帧时间固定为 native-capture，游戏固定为 native-game；独立评审固定为 independent-review。

除独立评审以外，每份结果均须附原始 `native-receipt` 与 `native-log`。回执为 schema 1，`fixture:false`、`nativeDesktop:true`，与外层的 source、version、sourceCommit、platformId、architecture、runtimeVersion、artifactSHA256、host、run 全部一致；`logAttachment` 指向 native-log。`observationsSHA256` 为 `payload` 删除 `nativeReceipt` 字段后，按原字段顺序 `JSON.stringify` 的 UTF-8 SHA256；`attachments` 为其他全部原始附件的 `{id:{role,sha256,size}}`。这样不能仅改外层来源、分数或结果，来重新包装旧回执与夹具。来源声明的真实性仍须审阅原始运行日志、执行环境和原生采集，不是数字签名或硬件认证。

八类证据全部必需：

| kind | payload 与原始附件要求 |
|---|---|
| native-run | `checks` 有 nativeBuild、nativeDesktop、credentialsRestart。`installations` 逐个列出全部附件，每项 `checks` 有 cleanInstall、coldStartup、warmStartup；`embedded` 有实际解包的 version、sourceCommit、runtimeVersion、architecture、applicationSHA256。必要检查必须 status=passed、expected=true、actual=true，不能把预期改为失败。 |
| screenshots | `captures` 每项有 attachment、theme、route、state、zoom、viewport、windowSize；对应真实 PNG／JPEG。必须有全部 15 页×四主题组合，以及 1／1.25／1.5 缩放与 960×620 最小窗口记录。windowSize 是实际原生逻辑窗口边界，viewport 是实际 CSS 视口，分别观测；不由文件名推断。 |
| original-video | `recordingAttachment` 指向 original-frame-manifest，`interpolated:false`；原始清单也绑定全部源码／产物身份，并保留 source 与 `frames:[{file,timestamp}]`。payload.frames 用 index、attachment、timestamp 精确绑定每个 frame 图片。至少 10 帧、0.7 秒，有像素变化，按原始时间计算达到 min(30,实测刷新率)；刷新率缺失按 30。原始录像也应保留，不能重采样改写原始时间。 |
| frame-timings | recordingRef 指向 original-video ID；fps、minimum、elapsed、frames 必须精确等于从其原始帧重算的数值。禁止四舍五入后伪称原始值。 |
| native-game | gamePID、launchCommand、world.saved、world.fileSHA256、normalExit.code=0、normalExit.saved、java.architecture 与 nativeABI，以及 game-screenshot、game-log。Harmony 必须 openharmony-arm64；Linux ABI 不能充当鸿蒙。Mac ARM 的旧 LWJGL 仅在显式 rosetta-legacy-lwjgl 时接受游戏 x64，并单列兼容路径。 |
| update-rollback | checks 有 upgrade、bad-payload-rejected、startup-failure-rolls-back、manual-restore，全部 true；beforeSHA256=restoredSHA256，并附 update-log。仅保留备份、仅下载或仅唤起安装器不满足。 |
| function-matrix | functions 与库存的全部功能 ID 一一对应，不能漏项、重复或新增未知项；每行 status=passed、evidenceRefs 引用实际操作证据。被引用 payload.functionAssertions 对同 ID 记录 name、status、expected、actual，预期实际一致。不能循环引用评分或功能矩阵本身。非 Windows 的 settings-04 仅接受 approved-exception 与 non-windows-memory-organizer；其他功能不可据此豁免。63 项当前基线与 15 页库存不能删行缩短验收；新增项目也必须纳入。 |
| independent-review | reviewer.role=independent、reviewer.id 与顶层一致；criticalDefects=[]、unverifiedRequired=[]；scores.visual／interaction／motion 各 9–10，不能平均。三类 evidenceRefs 分别关联截图、完整功能与游戏/回滚、原始录屏与帧时间；未知或自引用 ID 不接受。 |

当前四主题 Windows 局部报告缺少完整功能、最终源码绑定和上述原始回执协议，因此仍应保持 partial，不能用适配器补一个 `native=true` 即通过正式门控。合成协议测试正例仅验证读取规则，必须与真实产品验收分开保存。

## 收到最终证据后的评审步骤

先校验产物和证据身份，逐一对照库存及功能清单；查看所有主题／窗口截图和原始动作录屏，重核关键计数、保存、下载和生命周期结果。按 OS／架构填写三个独立分数与逐项缺陷；发现关键缺陷或不足 9 分即退回修复并要求新的、身份匹配的复测证据。最后单独列出批准差异、真实服务验证、夹具验证、历史失败和未覆盖项，给出该平台是否满足完整一致性结论。
