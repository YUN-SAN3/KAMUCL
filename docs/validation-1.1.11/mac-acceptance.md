# macOS 1.1.11 验收边界与待补证据

2026-10-04 09:02（Asia/Hong_Kong）当前快照：第六 [37163779043](https://github.com/kamubaba-i/KAMUCL/actions/runs/37163779043) 绑定 `69c1e89ba23a007535c77bae65052f19b6d87f58`，两架构各 864 项为 860 通过、0 失败、4 项既有平台 skip。15 作业为 12 成功／3 UI 失败：2 打包、2 官方 Demo 游戏、6 限定集成、ARM DMG 四主题限定 GUI 和独立 Intel GPU 诊断成功。原生四个包实际读取 Contents/Resources/kamucl-mac.json 内嵌 source69／runtime44.3／ABI／最低 macOS13；strict ad-hoc 签名不是 Developer ID／公证。旧摘要的 kamucl-build.json 计划名作为 historicalSnapshotErrors 保留。

ARM DMG 四主题实际 GUI、可见皮肤步行、焦点和受管壁纸通过。ARM APP 90 个原 CDP 帧中，frame-0055.jpg 的 timestamp=1791072915.597551，frame-0056.jpg=1791072915.595933，倒退 1.618 ms；原算术 FPS=60.53927763443197，但 formalTimingUsable=false，原失败不改写，不用 DMG 补 APP。精确 [Chromium152 PageHandler源码](https://chromium.googlesource.com/chromium/src/+/152.0.7977.78/content/browser/devtools/protocol/page_handler.cc) 的 wall-clock 元数据与异步编码顺序可解释为何需要更可靠原生观测，但尚不能证明本样本的因果；第七强制 SCK 用途明确的原始 BGRA／PTS／status 采集尚未原生验证，不排序旧帧、不放宽时间或 FPS。

Intel APP／DMG 默认运行时真实 WebGL 失败。单独诊断作业成功只表示采集完成；默认与 explicit Metal 两个独立变体仍没有画布、WebGL1／2 均失败，gl=disabled／angle=none 不证明最初失败后端。实际 Metal 探针与 driver／设备信息单列，不通过切换旧 Electron、软件渲染或调整门槛治愈原正式失败。

两个新实际游戏任务覆盖 26.2／Fabric0.19.5 官方 Demo 初始化、窗口／焦点／Dock恢复、正常退出0后读取 level.dat 与 region 原字节 SHA，世界文件不入公开包。试玩覆盖层、授权账号、无遮挡地形输入、旧版及其他 loader 未覆盖；Intel CI-only MoltenVK 条件保留。第五轮世界未采集 SHA 的旧缺口没有回填。启动是裸44.3 runtime的 coordinator harness，tools 为真实平台下载和仅本次daemon/session，update 是本地同版本签名事务／篡改／回滚夹具；它们不是完整签名启动画面、外部玩家联机或公开在线升级。第七源 SHA=null、新原生验收待运行，全部平台完整资格 false、三项评分 null、无 Release。以下旧快照保留。

本批第七完整本机公开测试为 874 项：873 通过、0 失败、1 项 Linux 原生 shell skip，duration=117970.8989 ms，TypeScript 通过。这覆盖原冻结的 QA／合同测试；全套之后追加的 Mac 原生 BGRA 证据收集修订另经针对性校验，不能笼统称全部最终 QA 都在 874 项之前冻结。它们不能替代 Mac／Linux 原生执行。本批黑橙 general refinement 实际 GUI 已通过，包含最小窗口、1.25／1.5 缩放、最大化与原报告中的有限交互；当前黑橙 ux110 可见步行／外观另在执行，尚不预填通过。四主题 final3 可见模型／步行／壁纸仍为上一 source69 已验证结果。新 Mac SCK 与 Linux 同进程 GPU 观察器尚未原生运行，源7提交 SHA=null、nativeRunsStarted=false；Windows 产品输入未改，不因 QA／文档重包装。所有平台完整资格 false、三项评分 null、无正式 Release。

第六旧源码／交接漏收 build/icon.png 和 build/icon-512.png，原审计 out/handoff111-history-source-closure-defect.json 保留；下一源码／交接必须重新核对完整构建输入闭包，尚无未来批次成功声明。

2026-10-04 08:02（Asia/Hong_Kong）第五轮历史快照：第五轮 [37160588297](https://github.com/kamubaba-i/KAMUCL/actions/runs/37160588297) 绑定 `5167500b6c27b9bbdd1e80f22d91d3f5904007eb`。两架构各 857 项为 853 通过、0 失败、4 项既有平台 skip；14 个作业中 2 个打包、2 个实际游戏、6 个限定集成成功，4 个 APP／DMG UI 失败。运行主机 macOS 15.7.9，包仍是 ad-hoc 签名；不是 macOS 13 实机或 Developer ID／公证验证。

ARM 的 APP／DMG 已实际显示窗口、WebGL 和编辑器，LOGO 原始 CDP 为 59.975／60.167 FPS，原生传送为 59.613／58.882 FPS，均达到该项 30 FPS 门槛；后续透明主题在受管壁纸实际存在断言失败，原记录 background={}，缺少原设置／读取／规范路径身份观察，原因尚未证实。原皮肤步行录像只有 1 帧、FPS 0，模型不在画面内；它仍不合格，姿态状态不能代替可见运动。Intel APP／DMG 在 30 次就绪观察中均无画布，正式原进程 gl=disabled／angle=none、WebGL1／2 创建失败；实际 EGL 初始化失败仍未解决。主机 Apple Paravirtualized 64MB／Metal2／30Hz 不证明初始 ANGLE 后端或因果根因；新增独立 GPU 诊断尚未执行，不绕过正式 GPU／帧率门槛。

两个实际游戏任务成功仅覆盖 Minecraft 26.2／Fabric 0.19.5 官方 Demo 世界初始化、对应游戏窗口／焦点、正常退出 0、保存日志及非空 level／四个 region 文件名。截图有试玩说明覆盖层，不证明无遮挡地形操作、授权账号或其他版本／加载器；Intel 保留原 CI-only MoltenVK argumentBuffers／heap=0 条件。原世界逐字节 SHA 未采集，旧世界已不在当前交接材料中，不得事后补造。新收尾／哈希门控必须在新游戏运行中得到真实正常退出后再记录。

六个限定集成的成功范围分别为：实际 44.3 运行时中的启动协调器 harness（不是完整签名启动器启动画面）；FRP／Terracotta 真实下载和仅本次 daemon 的本地 IPC（不是外部玩家联机）；签名当前包的本地同版本更新、篡改拒绝和备份恢复（不是公开在线升级）。本批新增内嵌提交／运行时身份、游戏哈希和独立 GPU 诊断仍待本次提交后的新原生构建及执行。Windows 最新四主题限定 GUI 与 864 项全套通过不能替代它们；全部平台完整资格 false、三项评分 null、无 Release。

2026-10-04 07:04（Asia/Hong_Kong）更新：第四轮候选 `e0b1210` 原生 CI 均结束。Mac `37158774374` 两架构各 855 项为 851 通过、0 失败、4 项既有系统 skip；两个打包及六个限定集成任务成功，4 个 UI 和 2 个游戏任务失败。双架构 ZIP／DMG 已实际生成，Electron 44.3.0、最低 macOS 13、ad-hoc 签名明确记录；不代表完整一致性通过。ARM UI 缺独立输出目录、游戏任务依赖跨任务窗口探针属于 QA 前置问题，已修正。Intel 原截图、30 个无画布样本及三轮 EGL／GPU 错误确认 3D 初始化真实失败，根因仍需原进程诊断。Linux `37158774429` x64 为 852 通过、0 失败、3 skip，三格式实际生成后因 builder 文件名映射失败；ARM64 为 851 通过、1 失败、3 skip，打包跳过。已改为精确命名和私有目录独占发布，取消夹具使用真实未完成传输门控，保留原时间线。最新 Windows 全套 857 项为 856 通过、0 失败、1 项原有 Linux skip；最终 tar 发布调用另经语法及 4 项专项复验。此次产品输入及 Windows 成品未变，QA／Linux 包装变化必须原生重跑。独立修正复核通过，但所有平台完整门控及三项评分仍未完成；没有正式标签或 Release。

2026-10-04 06:30（Asia/Hong_Kong）更新：第三轮 `2b1e6f1` 的 Mac run `37157548139` 与 Linux run `37157548122` 均完整结束为 failure，没有取消或死锁。Mac 两架构各 853 项为 846 通过、3 失败、4 项既有系统限定 skip；失败为测试临时目录别名 `/var` 与产品正确返回的 `/private/var` 规范路径不同。Linux x64 为 850 通过、0 失败、3 skip 后进入生产构建，但旧打包检查要求官方 Electron 44.3.0 已不含的 `libEGL.so`；ARM64 为 849 通过、1 失败、3 skip，合成 Windows classifier 被正确的 ARM 安全规则拒绝。已修正测试根目录和原生库夹具，按两份官方 ZIP／SHA 建立准确的运行时清单，保留 ELF、执行位、ICD、资源和许可检查。Windows 最新全套 855 项为 854 通过、0 失败、1 项原有 Linux skip。此次新增 Linux 打包校验变化，Windows 产品输入和成品未改变；完整原生重跑仍必需，尚无 Mac／Linux 成品、桌面／游戏或独立三项合格结论。原始失败日志及时间保留，不能改称通过。

本轮恢复 ARM64 与 Intel Mac，目标为 macOS 13 及以上；应用内容、主题、功能和动作时序复用当前共享实现。红绿灯、系统对话框和桌面材质沿用 macOS 原生行为，差异必须在最终评审中列明。

## 当前核查

- Mac 打包、任务驱动和 GUI 包装器语法检查通过，工作流 YAML 已解析核对：2 个打包、4 个 APP／DMG GUI、2 个实际游戏、6 个启动／工具／更新任务。
- 15 项 Java 架构、更新归档安全、Dock 状态观察和原生录屏观察器测试通过；这些是在 Windows 执行的纯逻辑测试，不是当前 Mac 原生运行证明。
- 旧 Intel 活动停顿观察文件仍为 7860 字节，SHA256 `96b26ac8b732b3f77063e50365f4f2a2be7ef8a259ba89b243a000bf4307479a`，130.627333 毫秒活动间隔未改写。旧 CDP／SCK 未达标结果继续保留，不借本轮源码修改或旧作业成功推断已修复。
- 2026-10-04 05:33（Asia/Hong_Kong）更新：workflow 标准授权已完成，候选 `ab54c5f` 已推送。Mac run `37154520494` 两架构停在 FRP 测试夹具的初始下载等待，已取消并保留原始日志；修复夹具后须完整重跑。该运行没有生成 Mac 成品，不能作为图形、动效或游戏运行通过证据。此前 OAuth 失败仍保留为历史。旧 run `37087543778` 对应旧提交 `a8496bf`，不是 1.1.11 成品或验收。
- 2026-10-04 06:05 更新：Mac run `37155930792`（`0d71da0`）两架构各已有 319 条可见通过、1 条旧 Windows EXE 更新夹具失败，停在重复等待 POSIX spawn 的测试后取消。原日志 ZIP SHA256：`b20d3328bf750c08f77a50bcb4f74576a162fc2cf4798ef1bfb2121406704a60`。等待契约和旧 Windows 夹具已修正，新增独立平台路由断言，原始失败不改为通过；没有生成 Mac 成品，须完整重跑。

## 必须收集的本轮证据

| 验收组 | ARM64 | Intel | 成功证据 |
| --- | --- | --- | --- |
| 原生打包 | 第六 source69 四包与实际内嵌身份通过 | 第六 source69 四包与实际内嵌身份通过 | 完整 source SHA、runtime44.3、最低mac13、Mach-O ABI、实际 ad-hoc 签名及 ZIP／DMG／ASAR 原摘要 |
| APP 与 DMG | DMG 四主题限定 GUI 通过；APP 原时序逆序失败 | APP／DMG 当前 WebGL 失败；单独诊断不放行 | 不同包／任务不拼接，通过全部页面、真实坐标、主题与当前功能矩阵 |
| 彩蛋与皮肤 | DMG 可见皮肤步行通过；APP 后续主题未完成 | 无画布，后续未完成 | 原始可见模型、焦点、计数／接触／音源、隐藏和关闭重试 |
| 原生动画 | APP 90帧原时间不可用；DMG各主题原观察单列 | 当前 WebGL 与历史低帧率保持失败 | 第七强制 SCK 尚未原生验证，原BGRA／PTS／status／既有帧门槛完整保留 |
| 游戏 | 第六 Demo 限定任务及正常退出后新世界 SHA 通过 | 同左，保留 CI-only MoltenVK 条件 | 第五旧SHA缺失不回填；授权账号、无遮挡玩法及其他版本／loader另验 |
| 启动／工具／更新 | 第六三个限定任务成功 | 第六三个限定任务成功 | coordinator runtime harness、真实工具下载ownsession、本地同版本事务不得冒充完整启动／玩家服务／线上升级 |
| 独立评审 | 待评审 | 待评审 | 本轮最终截图／录屏与证据，视觉／交互／动效各自达到 9 分且无关键缺陷 |

每个任务验证成品清单提交与检出提交完全一致；不同候选、架构、APP／DMG 或重试之间不拼接通过。失败仍上传当前截图、原始帧和诊断。原始 CDP 或 SCK 低于其既有显示器目标会失败，不降低门槛、不替换为旧 Electron、不补造帧或改变时间。

## 与自动化分开报告

本轮包仍采用 ad-hoc 临时签名，未具备 Developer ID 签名和 Apple 公证。真实 Microsoft 登录／上传、玩家 Keychain 升级体验、两社区真实服务、公网穿透、物理音效听感、用户私有 PCL 包在 Mac 实际游玩，以及仅提供 Intel natives 的旧游戏在 Apple Silicon／Rosetta 下运行，均须另有真实证据；纯逻辑、服务夹具、单个现代游戏或虚拟原生跑机不能替代。

最终原生结论由工作流 run、候选提交、下载回执及独立评审给出。本文件记录写入时状态，不能自行作为发布合格声明。
