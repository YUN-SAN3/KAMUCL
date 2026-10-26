# KAMUCL 1.1.11 多平台接续状态

2026-10-04 09:02（Asia/Hong_Kong）当前快照：第六轮精确绑定已推送 master `69c1e89ba23a007535c77bae65052f19b6d87f58`；main `bb41072b907d8ade365e9beadc4a71ee7e69a6ca` 经 cherry-pick 保留独立历史。Mac run [37163779043](https://github.com/kamubaba-i/KAMUCL/actions/runs/37163779043) 和 Linux run [37163779037](https://github.com/kamubaba-i/KAMUCL/actions/runs/37163779037) 已结束，均不构成完整平台合格或正式发行。版本仍为 1.1.11，本批不再修改 03:59 的内置更新日志或递增版本。

Mac 两架构各 864 项为 860 通过、0 失败、4 项既有平台 skip；15 个任务中 12 成功、3 个正式 UI 失败。成功任务为 2 个打包、2 个实际 Demo 游戏、6 个限定集成、ARM DMG 的限定四主题 GUI 和 1 个独立 Intel GPU 诊断。ARM DMG 的实际可见皮肤步行、焦点和受管壁纸均通过；ARM APP 的原始 CDP 90 帧在第 55→56 帧倒退 1.618 ms，原算术 FPS 60.53927763443197、formalTimingUsable=false，保持失败。Intel APP／DMG 实际 WebGL 初始化仍失败；独立诊断收集成功也仍无画布，不能把它当产品修复。第六四个 Mac 成品实际内嵌文件为 Contents/Resources/kamucl-mac.json，sourceCommit、Electron 44.3.0、架构、最低 macOS 13 和签名均有实际核对；旧摘要的 kamucl-build.json 计划名在 summary.json 的 historicalSnapshotErrors 保留。

Linux 两架构各 864 项为 861 通过、0 失败、3 skip；六个 AppImage／DEB／tar.gz 原生包的干净解压、ELF、执行位、摘要及内嵌 source69／实际 Electron 44.3.0 身份通过。三次 Xvfb 已启动实际应用，均在 ANGLE／Mesa llvmpipe 的 WebGL 创建失败后触发 skin canvas missing，原失败和时间保留，finalizer 没有再遮蔽首错。软件驱动 blocklist 是强线索，最终根因仍待同一进程 GPU 状态诊断；不能宣称 Vulkan 驱动缺失。没有 Ubuntu 24／26 两架构的真实 GNOME／KDE／XWayland 硬件桌面主机或完整验收。

本批第七完整本机公开测试为 874 项：873 通过、0 失败、1 项 Linux 原生 shell skip，duration=117970.8989 ms，TypeScript 通过。这覆盖原冻结的 QA／合同测试；全套之后追加的 Mac 原生 BGRA 证据收集修订另经针对性校验，不能笼统称全部最终 QA 都在 874 项之前冻结。它们不能替代 Mac／Linux 原生执行。本批黑橙 general refinement 实际 GUI 已通过，包含最小窗口、1.25／1.5 缩放、最大化与原报告中的有限交互；当前黑橙 ux110 可见步行／外观另在执行，尚不预填通过。四主题 final3 可见模型／步行／壁纸仍为上一 source69 已验证结果。新 Mac SCK 与 Linux 同进程 GPU 观察器尚未原生运行，源7提交 SHA=null、nativeRunsStarted=false；Windows 产品输入未改，不因 QA／文档重包装。所有平台完整资格 false、三项评分 null、无正式 Release。

全部平台 completeQualification=false，视觉／交互／动效分别为 null；没有 v1.1.11 正式标签或公开 Release。第六源码／旧交接的build/icon.png 与 build/icon-512.png 两个构建图标漏收已由独立审计记录，下一交接按根文档与完整 source prefix 闭包核对，不能以旧包运输验证冒充源码闭包完成。第五轮旧世界 SHA 缺失继续保留；第六真实正常退出后的新 Demo 世界 SHA 单独记录，不补造旧世界。用户图片、设置、收藏、历史计数、私有账号／世界／整合包和未提交文件保留，不纳入公开包。以下旧快照只描述各自记录时点。

2026-10-04 08:02（Asia/Hong_Kong）第五轮历史快照：第五轮绑定已推送提交 `5167500`，Mac run `37160588297` 和 Linux run `37160588146` 均已结束。Mac 两架构各 857 项为 853 通过、0 失败、4 项既有平台 skip；2 个打包、2 个实际 Demo 游戏和 6 个限定集成任务成功，4 个 APP／DMG UI 任务失败。Linux 两架构各 857 项为 854 通过、0 失败、3 skip，六个三格式包的原生干净解压与包检查通过；三次 Xvfb 预检因缺少 `xdpyinfo` 失败，随后 finalizer 的 `scandir out ENOENT` 遮蔽首错，应用未启动。这是 QA 前置失败，不能算应用失败或桌面通过。

本批已冻结 QA 和包装身份修订，Windows 产品构建输入无变化。Windows 最新全套为 864 项：863 通过、0 失败、1 项 Linux 原生 shell skip，TypeScript 通过；四主题最新 final3 实际 GUI 的可见模型、原帧时间、真实像素变化、焦点及受管壁纸解码断言通过，仍属限定本机回归。Mac／Linux 新内嵌 sourceCommit／runtimeVersion 身份必须在本次提交后的新原生构建中验证，目前尚未重建。本批源码 SHA 和 Delivery 外部回执须在提交后更新，不能给第五轮旧包绑定未来提交。全部平台完整资格仍为 false，视觉／交互／动效评分均为 null；没有 v1.1.11 正式标签或 Release。

2026-10-04 07:04（Asia/Hong_Kong）更新：第四轮候选 `e0b1210` 原生 CI 均结束。Mac `37158774374` 两架构各 855 项为 851 通过、0 失败、4 项既有系统 skip；两个打包及六个限定集成任务成功，4 个 UI 和 2 个游戏任务失败。双架构 ZIP／DMG 已实际生成，Electron 44.3.0、最低 macOS 13、ad-hoc 签名明确记录；不代表完整一致性通过。ARM UI 缺独立输出目录、游戏任务依赖跨任务窗口探针属于 QA 前置问题，已修正。Intel 原截图、30 个无画布样本及三轮 EGL／GPU 错误确认 3D 初始化真实失败，根因仍需原进程诊断。Linux `37158774429` x64 为 852 通过、0 失败、3 skip，三格式实际生成后因 builder 文件名映射失败；ARM64 为 851 通过、1 失败、3 skip，打包跳过。已改为精确命名和私有目录独占发布，取消夹具使用真实未完成传输门控，保留原时间线。最新 Windows 全套 857 项为 856 通过、0 失败、1 项原有 Linux skip；最终 tar 发布调用另经语法及 4 项专项复验。此次产品输入及 Windows 成品未变，QA／Linux 包装变化必须原生重跑。独立修正复核通过，但所有平台完整门控及三项评分仍未完成；没有正式标签或 Release。

2026-10-04 06:30（Asia/Hong_Kong）更新：第三轮 `2b1e6f1` 的 Mac run `37157548139` 与 Linux run `37157548122` 均完整结束为 failure，没有取消或死锁。Mac 两架构各 853 项为 846 通过、3 失败、4 项既有系统限定 skip；失败为测试临时目录别名 `/var` 与产品正确返回的 `/private/var` 规范路径不同。Linux x64 为 850 通过、0 失败、3 skip 后进入生产构建，但旧打包检查要求官方 Electron 44.3.0 已不含的 `libEGL.so`；ARM64 为 849 通过、1 失败、3 skip，合成 Windows classifier 被正确的 ARM 安全规则拒绝。已修正测试根目录和原生库夹具，按两份官方 ZIP／SHA 建立准确的运行时清单，保留 ELF、执行位、ICD、资源和许可检查。Windows 最新全套 855 项为 854 通过、0 失败、1 项原有 Linux skip。此次新增 Linux 打包校验变化，Windows 产品输入和成品未改变；完整原生重跑仍必需，尚无 Mac／Linux 成品、桌面／游戏或独立三项合格结论。原始失败日志及时间保留，不能改称通过。

基线为已公开的 Windows 1.1.10，master `85bfe93c016a004b7ddbd397c6b8769bedd25c50`。本文件描述已完成的代码与本地验证，不宣称多平台全部一致。正式发布前必须补齐逐平台原生验收和独立评审。

## 代码范围

复用同一 Vue、Three 模型、纹理、音频和动画时间线；新增平台／架构／安装形式与能力信息，独立识别鸿蒙，避免误落入 Linux。保留设置、图片、收藏、人物计数与旧格式，不打包私人运行目录和 `pelican-bicycle.html`。

Mac 两架构锁定 Electron 44.3.0、macOS 13+，移除 Electron 33.4.11 构建覆盖；分别构建、核对 Mach-O、ASAR、签名和 APP／DMG。当前签名为 ad-hoc，不是 Developer ID 或 Gatekeeper 公证。此前 Intel 焦点／动画停顿及低采集帧率保留为失败；新流程的就绪观测和当前运行时配置尚需真实 Intel 复测，不能描述为问题已解决。

Linux 增加两架构原生构建和 AppImage／DEB／tar.gz、桌面入口、X11 游戏窗口正常关闭和聚焦。更新按安装形式处理：DEB 交给系统安装器确认；便携包受控替换并在新应用未就绪时恢复旧包。AppImage 缺少 FUSE 或处于解压运行时拒绝自动替换并保留原程序与下载包。ARM64 使用同版本可信原生库、下载哈希与 ELF 校验，无法取得的第三方原生库准确报错。

Linux 凭据拒绝 `basic_text` 或未知安全后端；没有密钥服务时使用会话登录并给出说明。密钥环锁定时保留原密文；修复刷新后磁盘密文缓存可能被旧缓存覆盖的问题。联机工具两架构资产和固定摘要、权限、中文／空格路径及沙箱要求已纳入流程。系统级内存整理保留为非 Windows 的已批准例外，统计、分配与启动器资源回收保留。

鸿蒙固定实际维护方 37.2.0 原生运行时及 HAP 模板，接入相同 main／preload／renderer 资源，生成 DevEco 接续工程。固定 SDK 为 5.0.5(17)；缺少 SDK、签名、设备及完整第三方许可证条件，构建门控明确失败。没有 HAP、没有实机 JVM／JNI／LWJGL／GLFW／音频或游戏窗口证明，不能以界面文件一致作为移植完成。

## 验证分类

当前全量公开测试、TypeScript、生产构建和许可证检查的最终计数由同目录 validation-1.1.11/summary.json 给出。新增平台规则、凭据锁定恢复、Linux 更新安全与失败回滚、发布门控负例采用合成夹具／故障注入。Windows 上明确跳过的 Linux 原生 shell 测试不计为通过；这些结果不替代原生桌面、真实服务或游戏。

最新 Windows EXE 和两 ZIP 在中文／空格独立目录完成干净解压、冷／热启动、完整 payload 与 ASAR 摘要核对。四类主题的实际隔离 GUI 已验证真实 WebGL 行走恢复、彩蛋让位、图片随机播放、MOD 图标、颜色与玻璃、最小窗口及 125% 选择操作；社区、账号和资源安装中的夹具响应不是实际在线服务。单人彩蛋、皮肤编辑、色板、图片、导入和选择必测模块的最终结果另列原始日志。采集帧时间保留，不插帧、不改门槛。

完整库存为 15 页面、280 IPC、63 场景；当前 Windows 有限回归不覆盖新的全部运行矩阵，Mac／Linux 尚无当前原生完整证据。独立子 agent 对各平台的视觉、交互、动效均保持未评分，不复制历史分数，也不使用平均分放行。新发布门控要求每条证据绑定源码提交、全部产物摘要、实际原生命令回执、原始日志和采集文件，并读取逐项结果；静态完整性只能验证记录一致，不能代替独立人工审阅和设备来源核对。

## 历史失败和未覆盖

- Windows 验证曾发生测试过早读取尚未完成的 ZIP、Node 测试缺少 Electron app、以及 DEB 操作文案迁移导致静态测试失败；原始失败日志保留，修复后的结果单独记录。
- 初版发布门控可接受仅声明布尔值／分数的文件，已改为核对原始证据和完整库存，负例测试防止缺失、夹具冒充和删减库存。
- 历史 Intel 活动帧间隔 130.627333 ms，APP／DMG CDP 29.4646775／28.8180105 FPS，SCK 21.6706034／27.6948752 FPS，保持失败。详见 mac-acceptance.md，Windows 当前数据不能替代它们。
- Mac 当前 Keychain 真实登录重启、Intel GPU／合成恢复与完整游戏玩法未验；第五轮两个官方 Demo 游戏任务实际通过世界初始化、保存日志和正常退出，但试玩覆盖层、旧世界未采集 SHA、Intel CI-only MoltenVK 条件及其他加载器仍单列。Linux 四种正式系统／架构的 GNOME／KDE／XWayland 真实桌面、真实联机、游戏和更新回滚未验。Xvfb、软件渲染与交叉构建不能替代。
- 物理耳机／扬声器听感、当前全平台微软登录上传、社区真实在线安装和所有第三方原生模组兼容性未验。没有鸿蒙 SDK／合法签名／实机验收。
- GitHub 标准 OAuth 曾缺少 workflow 权限，实际拒绝推送、直接授权超时及代理代码过期记录保留。2026-10-04 05:33 更新：授权已完成，`ab54c5f` 已推送 master，main 通过 cherry-pick 同步为 `db13257`。首次 Mac `37154520494`／Linux `37154520531` 四个原生架构均停在 FRP 测试夹具的初始下载等待，已取消并保留原始日志；修复夹具后完整重跑，不计为验收通过。
- 2026-10-04 06:05 更新：`0d71da0` 原生运行已通过 FRP，但在重复等待已发生的 POSIX spawn 事件的旧测试挂起，并报告一个 Windows EXE 更新夹具误走原生路由的失败。修复等待／超时，准确隔离旧 Windows 夹具，并新增四个平台／架构的真实 getter／clear 路由夹具；后续同型 default-config 夹具亦已修正。保留两次取消、原始时间戳与已报告失败。修后 Windows 全套 853 项为 852 通过、0 失败、1 项 Linux skip；这些 QA 变更没有改变已验证 Windows 产品输入或成品。

## 成品与发布状态

本地保存 Windows 接续候选 EXE／两 ZIP，以及第六精确绑定 source69 的 Mac 双架构 ZIP／DMG 与 Linux 双架构 AppImage／DEB／tar.gz。十个新原包的大小、SHA、内嵌来源及实际运行时观察见 summary.json；第五轮和更早原包、失败帧与日志原样保留。包完整性通过不代表完整平台资格。本轮第七 QA 的新成品／源码／交接须在提交后分别生成和验证，没有合格的 Mac／Linux／鸿蒙公开下载。

第六 master `69c1e89ba23a007535c77bae65052f19b6d87f58` 已推送，main `bb41072b907d8ade365e9beadc4a71ee7e69a6ca` 经 cherry-pick 保留独立历史；当前第七 QA／文档批次的 SHA 仍为 null，提交后才更新外部源码／Delivery 回执。新原生测试与全部必测、三个独立分数分别至少 9、无关键缺陷后，才能显式绑定最终 master 的 v1.1.11 标签并发布对应附件。不强推、不覆盖远端更新、不操作 wuhui。