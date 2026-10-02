# KAMUCL 1.1.8 发行验收记录

记录时间：2026-10-02 15:37（Asia/Hong_Kong）。基于 1.1.7 db54f58；功能见 [FEATURES_1.1.8.md](FEATURES_1.1.8.md)。本轮保留用户图片、收藏、计数、设置及未提交文件。没有操作 wuhui。

## 已验证

- 自动化测试：629/629，通过，0 失败、取消或跳过。TypeScript、生产构建和许可证检查通过；日志来自 out/*-118-settled，交接时固定保存。最终源码 ZIP 另行从全新目录安装依赖、编译 Java bridge、检查类型、构建和检查许可；逐文件摘要及源码不变性见交接证据 source-audit.json。
- Windows 最终便携 EXE、紧凑 ZIP 中文路径解压后的冷／热启动，以及 unpacked ZIP 文件完整性通过。最终 EXE SHA256 为 1eae5169245c4c7095cd8ba4fbb46b59e86942ad6c601c7502aae0f97b494c10。本报告只采用 Final-Settled-Windows-* 和 Final-Settled-Mac-* 固定目录，三主题快照与实际 EXE 摘要一致。
- 深色、浅色、自定义三种主题成品 GUI 均完整通过，布局溢出记录为 0。各自覆盖五种皮肤窗口／缩放条件；Windows 最小实际视口 641×415、预览135px。关闭和固定底栏可见，滚动到工具后真实 HEX 输入及返回模型绘制通过。小屏调色区在模型下方，需滚动往返；不声称所有控件同屏。原生忙碌关闭／退出、上传中断等段落恢复960×620@1，不冒充所有关闭场景都在最小视口完成。
- 真实坐标中键、Alt＋左键旋转改变模型画面而不改 PNG RGBA；左键整笔绘制、撤销、重做、图层透明度、吸色同步、保存取消／失败、关闭意图和焦点恢复有成品记录。最新附加取证记录可信 pointerdown／move／up 和实际命中坐标。
- 全身正反横扫、停留去重、局部掌印、七人独立反馈、最高计数人物迈步到最左、排序不误计数、键盘、幂等保存、隐藏暂停和关闭释放通过。正向每人一次七个真实音源，反向合计十四个；处理浏览器原生合并事件时逐样本取证。连续 compositor 录屏未经插帧，Windows 三主题分别约 100.02／100.29／100.28 fps。音画接触误差检查小于12ms；完整混音峰值分别 0.861／0.875／0.889，均未到满幅。无声动作视频与实际音频录制分开保存。
- 七人舞台保留原几何、姿态、逆转置法线、UV 和原始材质数据；硬件路径保留 PBR 光照，42 个基底方块合并为1次GL调用、504三角面。真实软件GL环境改用同一几何的 CPU 逐像素深度与最近纹理采样，每帧0次GL调用、1次Canvas2D上传、504三角面输入；使用原创哑光漫反射近似，不宣称与 PBR 完全等价。真实方法钩子、纹理／遮挡和资源释放测试确认两路径，未删人物或面。打开互动时装饰皮肤预览暂停但相机仍可操作；软件环境同时暂时让出背景模糊，关闭恢复主题与原预览。
- 图片真实受管文件、混合排序、停用不删文件、全关／单图计时和主题字节往返有最终 EXE 三主题 GUI 及规则测试记录。实例图片优先仅经源码核对，没有专门实际 GUI 断言。收藏管理保留既有数据；两平台卡片、详情、旧项目关联合并、真实收藏文件、批量拒绝提示／重试及逐个安装入口已检查。在线平台资料和安装计划使用夹具，详见下面边界。
- Apple Silicon 和 Intel 在对应原生 macOS runner 上验证架构与 ad-hoc 签名，分别运行 APP 和挂载 DMG 中 APP，六类扩展 GUI 的 functionalComplete=true，录屏 benchmark 独立列示；默认皮肤、系统材质及本轮皮肤编辑等公共功能有截图／原始录屏。实际 Minecraft 26.2 显示窗口、进入世界、写入 region 文件、正常关闭、焦点及 Dock 再开；Java fallback、FRP、Terracotta 和本地更新／回滚验证通过。Mac 录屏保留实际小数，按30fps与当前原生窗口对应显示频率的较低值检查，缺失或异常频率维持30，不四舍五入或插帧。Intel约30Hz屏幕不宣称达到60Hz流畅度；早期绝对30门槛与带追踪的失败原始证据仍保留。Mac GUI 使用黑橙主题；三主题完整回归是 Windows 成品覆盖，不能推断 Mac 所有主题均实测。

## 原生录屏性能指标

- arm64: 原生 run 36969490673，构建提交 `83ba094d418ee09c4520da451f585e8ad8272cc4`；发行 ZIP／DMG 摘要已与该固定证据的 source-verification.json 一致性核对。
- x64: 原生 run 36973966441，构建提交 `45674cdfdf312f70987245e7b043d5295e83f420`；组合证据：attempt1 安装包/UI/游戏/更新，attempt2 仅工具补充，原attempt1仍为failure；发行 ZIP／DMG 摘要已与该固定证据的 source-verification.json 一致性核对。

功能检查的 complete 与录屏速率分别记录。录屏目标保持 min(30, 实际活动显示器 Hz)，没有降低数值、四舍五入或插帧；指标失败不阻止后续功能取证，也不描述为通过。独立动效评分依据真实逐帧画面及动作时序。

| 架构 / 启动方式 | 渲染路径 | 实录 fps | 目标 fps | 指标 |
| --- | --- | --- | --- | --- |
| arm64 / app | webgl-pbr | 60.13228944346047 | 30 | 通过 |
| arm64 / dmg | webgl-pbr | 55.42890631719211 | 30 | 通过 |
| x64 / app | canvas2d-depth | 28.989502481591487 | 30 | 未达标 |
| x64 / dmg | canvas2d-depth | 29.9897292895263 | 30 | 未达标 |

**本批仍有原生录屏速率未达标项，见上表。** 不宣称双架构性能指标全部通过；早期失败记录保留。

附加 Windows 软件环境回归使用相同最终EXE：Final-Settled-Windows-CPU-black-orange覆盖全部六类扩展模块（不含全页面记录），CPU-blue-white与CPU-custom仅覆盖顶栏。三者均以实际软件GL检测选择Canvas2D，不外推为对应主题的其他功能已复验。

## 保留的原生失败记录

既有五次早期 APP 录屏失败原始证据继续随交付保存；另保留 fac7965 的两次尝试、83ba094 的 APP 调色板失败、763791a 的键盘重新打开焦点失败及 45674cd 的 FRP 下载停滞，不覆盖成功阶段或旧失败结论：

- run 36965271517 / attempt 1 / artifact 11210310890；阶段 game/version-json。APP and DMG all six GUI modules completed; APP benchmark below target remains false. Minecraft installation failed while obtaining version metadata, before game/world verification. Actual URL, HTTP status and underlying cause were not captured; tool/update receipts do not prove game success.
- run 36965271517 / attempt 2 / artifact 11209988762；阶段 dmg/header/foreground-audio-restore。APP all six GUI modules completed. DMG header failed at the original fixed 300 ms foreground AudioContext check: window and stage visible, audio still suspended. Post-show lifecycle calls were not freshly captured, so delay versus persistent defect remains unknown. Remaining DMG modules, game and later independent tool/update steps were not run; later bounded-wait QA does not retroactively pass this attempt.
- run 36969490673 / attempt 1 / artifact 11211022844；阶段 app/palette/custom-delete。APP header and skin modules passed. Foreground audio recovered with real running/visible/focused evidence after 191 ms; capture 29.99478185497284 fps below target30 remains false. Palette failed because #1177ee remained in the settings snapshot after the original fixed500 ms wait; without later samples this does not establish persistent product failure. Remaining APP modules, DMG, game and tool/update stages were not run. Subsequent condition-based QA does not retroactively pass this attempt.
- run 36971712581 / attempt 1 / artifact 11211552907；阶段 app/header/keyboard-reopen-focus。APP header failed when activeElement.dataset.hit was empty after real Space plus a fixed700 ms wait. Failed-time stage readiness, focused element and native foreground were not captured, so initialization delay versus persistent focus defect is not established. Audio had actually restored in217 ms. Raw45-frame capture19.360154537671548 fps below target30 and five main-thread long tasks remain failures. Remaining APP modules, DMG, game and later tool/update stages were not run. Subsequent observation-based QA cannot retroactively pass this attempt.
- run 36973966441 / attempt 1 / artifact 11213780109；阶段 extra/network-tools/frpc-download。Both APP/DMG six GUI modules and actual Minecraft26.2 window/world/save/focus/close/Dock-reopen passed; updater/rollback passed. FRP official frpc_darwin_amd64 download stalled; HTTP status and underlying network cause were not recorded. Terracotta was not reached. APP28.989502481591487 and DMG29.9897292895263 fps below target30 remain false; keyboard ready223/259 ms provides no >700 ms readiness evidence. Later supplemental tools proof must not retroactively mark this job successful.

侧栏修复前后的开发构建原图、延时图、DOM JSON 和完整日志另存为 sidebar-development-before/after-*，独立定位记录为 sidebar-development-review.md。这里只保留正式样式注入前的原始截图及正式产品 CSS 的开发试跑，两组目录附带的五张临时 CSS 诊断图不作为产品证明。这些材料用于解释缺陷与修复过程，不将旧成品 8.5 分或开发试跑改写为最终通过；最终分数只依据下面新成品证据。

附加 Windows 顶栏键盘观察记录基于同一成品 EXE、QA 45674cdfdf312f70987245e7b043d5295e83f420，实际 119ms 内由产品自动将焦点交给保存顺序首位，七个目标和模型均已就绪。它是独立的顶栏辅助验证，不改写 Final 三主题原记录。两次早期开发诊断分别为观察器读错 modelBounds 结构和录屏后各人物额外加2；后者缺少完整输入轨迹，原因未定，两次失败记录均保留。

## 独立复评分

子 agent 使用真实生产截图、连续原始帧和操作记录复评：视觉 **9.0/10**，交互逻辑 **9.1/10**，动效画面 **9.0/10**，逐项达到9分；已审阅范围没有剩余可复现关键缺陷。完整报告与历史问题／修复表位于交接包验证材料 independent-review.md。评分范围是实际已审阅画面及事件逻辑，不替代未人工听测的声音主观验收，也不声称所有未覆盖项已通过。

## 未覆盖验收与交付边界

- **未人工用硬件扬声器／耳机听测原创掌击音色。** 真实音源和混音波形／峰值只支持数值检查，不能证明 pia 音色、连续听感或硬件无爆音。
- 未执行真实微软账号皮肤上传；GUI 的忙碌／失败注入不替代账号成功请求和缓存同步实测。
- 实例专属图片优先及失效时回退全局轮播仅按源码核对，未做本轮专门 GUI 断言；不列为实际界面通过。
- 未执行真实 Modrinth／CurseForge 在线文件下载和安装提交；资料响应及计划采用隔离夹具，单个安装记录 committed=false。CurseForge 单项安装计划未单独实跑；真实网络限频／鉴权、生产依赖冲突和实际下载校验仍未覆盖。
- 走位遮挡的同帧实际几何契约通过，但事件为非可信；额外可信 CDP 端点保持项仍可能 inconclusive，详见各 mascot-header-ui JSON。不能把前者描述为可信端到端遮挡测试通过。
- 部分原生系统文件拖拽、所有窗口／缩放、Mac 三主题遍历、真实磁盘满／拒绝写入和全部无障碍路径未逐项实测。保留功能的公网 NAT、真实工单附件、投影游戏内加载和内存全过程等边界继续沿用1.1.6／1.1.7记录。
- 参考图片隐藏像素按服装补全，不承诺原始皮肤逐点一致。Mac 采用 ad-hoc 签名，无 Apple Developer ID 签名或公证。

## 成品与复验

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| KAMUCL-1.1.8.exe | 97279794 | `1eae5169245c4c7095cd8ba4fbb46b59e86942ad6c601c7502aae0f97b494c10` |
| KAMUCL-1.1.8-windows-x64.zip | 97311363 | `0c661505fdd3e0317a74716dddf030070c3e8c0c188492da90d6b11f22700713` |
| KAMUCL-1.1.8-windows-x64-unpacked.zip | 143043471 | `bdf6f7b64f03b0c2a8144911ed40db269fa68455a47cc3f2b18b948b409b5c0e` |
| KAMUCL-1.1.8-mac-arm64.dmg | 108654258 | `1599eb47d8065874e0befd43a228942f00a40fbe206172a7506eead388aeae68` |
| KAMUCL-1.1.8-mac-arm64.zip | 100148696 | `72c3d0d62da7471a5652754676702be76e8c9e0097cd6d60750915aba6f9541d` |
| KAMUCL-1.1.8-mac-x64.dmg | 115859912 | `ef5f19bf0e3874b89bcb32b1c0826949ed5a9ec59013864c78d5bed604f6c120` |
| KAMUCL-1.1.8-mac-x64.zip | 106288716 | `2baf9ebcf36234e6f0edefca56a4dab6d3b86e8c1fee72358d99493b07fc8cc2` |

独立源码包、交接包和以上成品的外层摘要统一见 Release 的 SHA256SUMS.txt，避免源码文档自引用摘要。交接 ZIP 包含源码、成品和去除浏览器 profile／缓存的真实验证材料；_handoff/manifest.json 记录逐文件摘要。

主入口 START_HERE.md；构建／验收命令包括 npm test、npx tsc --noEmit、npm run build、node scripts/check-licenses.cjs、node scripts/verify-windows-package.cjs、node scripts/verify-source-archive.cjs。Mac 原生流程见 .github/workflows/mac-build.yml。Windows 最终打包采用本地已安装 Electron 44.3.0 的 electronDist；Mac 使用 Electron33.4.11。产品实现与最终证据构建保持一致，后续提交仅补充 QA 和文档。

master 与 main 使用独立历史，批次提交 cherry-pick 到 main；原 main 五份文档差异按字节保持。公开 Release 显式绑定 v1.1.8 与最终 master 提交，脚本核对标签提交、全部附件大小及 GitHub SHA256。发布完成情况以公开 Release 和交接外部审计记录为准。
