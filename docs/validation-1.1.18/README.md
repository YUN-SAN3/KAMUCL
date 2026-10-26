# KAMUCL 1.1.18 验证范围

香港日志 2026-10-07 14:54。最终 EXE a0427950efe94c5ffc5f05cca9dcc33b79bab96293cfde7e0c89a2f7198be887，97323101 字节，Electron 44.3.0。原生验收 Windows 11 26200 x64、125% 显示缩放。用户数据保留；本批不含 Mac、不恢复优化。

## 结果与分类

| 范围 | 结果 | 证据性质 |
| --- | --- | --- |
| 全量回归 | 1343 项，1342 通过、0 失败、1 Linux 专属跳过 | 单元/合成/原生子进程混合，见 evidence/tests/final.txt |
| 类型、许可、生产构建 | 退出 0，516 项输入冻结不变 | evidence/build/production-inputs.json |
| 成品 | EXE/两 ZIP 载荷、解压、冷暖启动通过 | evidence/build/windows-package.json；Node 模式启动不冒充 GUI/game |
| 离线皮肤 UI | 四主题，每档小窗口 23 控件可达 | 真坐标、前台、PNG/账号存储；迟到回复是时序夹具 |
| 默认材质包 UI | 四主题，目标/应用/失败回滚/重试通过 | 生产文件、合成 ZIP 和单次写入故障注入 |
| 社区 | 前置默认勾选、关联、取消、失败重试、返回保留搜索/滚动 | 真 UI，来源/响应夹具；真实事务另由测试覆盖 |
| pinned 前置 | 直接/传递、同 hash、异名、缺 hash、确认变化、循环冲突通过 | 合成 JAR/HTTP 经生产下载校验提交；非实现者独立重跑39项 |
| Java 决策 | 真实8/17/21/25健康；旧版选择/请求8或17；官方快照映射正确 | 官方元数据/本机运行时；下载选择回调不等于所有版本全新下载 |
| JVM/authlib | 1.12.2/1.20.1/1.21.11/26.3 官方库签名和PNG解码通过 | 真8/17/21/25；不等于四版本完整游戏 |
| 原生游戏 | 最终EXE 26.3/Fabric 演示世界，GPU/Slim/hash/存档/两次正常退出，关闭 pack 后重启保留 | 生产安装/应用/启动 IPC、官方客户端；测试 MOD 只驱动/读取实际游戏 |

离线皮肤仅自己的本机，首次下载作者官方 authlib-injector 并 SHA256 校验，缓存后断网。第三方缺乏可靠依赖元数据时不能猜项目；精确冲突不自动覆盖旧文件。

## 复验命令

依次执行 npm ci、node scripts/build-bridge.cjs、npm test、npx --no-install tsc --noEmit、npm run license:check、npm run build。

Windows：npx --no-install electron-builder --win portable --x64 --config.electronDist=node_modules/electron/dist --publish never；node scripts/pack-windows-zip.cjs；node scripts/verify-windows-package.cjs。

构建需JDK17+，实际JDK25.0.2。原创提供器以 --release 8 编译。真实探针入口 scripts/verify-java-runtime118.ts、scripts/verify-offline-skin-runtime118.ts，需要相应 Java/网络；回执记录的机器路径不是通用预置。

成品UI：设置 KAMUCL_EXTENSION_GUI=1、KAMUCL_EXTENSION_ONLY=1、KAMUCL_SKIP_EXTENSION_BASE=1；KAMUCL_UI_MODULE 分别 offline118、packs118、ux116、game118，执行 node scripts/verify-ui-refinement.cjs black-orange。前两项分别顺序跑 black-orange/blue-white/transparent/custom。不要设置 KAMUCL_GUI_DEV。仅专属测试账号、目录和进程，不向其他程序输入，不并发启动可能影响前台的工具；焦点变化硬失败。测试游戏驱动 tests/fixtures/OfflineGameProbe.java 不进入成品，不含私人世界。

## 证据与尺寸

EVIDENCE_BINDINGS.json 保留原始来源和公开逐文件 SHA；PUBLIC_EVIDENCE_AUDIT.json 核对显式选取的截图、录屏帧、元数据和回执。evidence/ui 分主题；evidence/recordings 存原 compositor 帧和时间戳，不插帧、不修改频率。截图完整视口，滚动覆盖图注明实际滚动，不冒称小窗一张图容纳整页。

125% Windows 下，请求960×620 DIP得到约962×623 bounds。原生content整数和CSS小数视口分别舍入；保持原<1 CSS像素阈值，用实测visualViewport并核对innerWidth/Height正确舍入、控件可见/命中/裁剪，区分请求/约束/实测，非物理960×620声明。

## 历史失败

- 初次CSS间距用已有spacing token修复；Electron报告非原子写入可能被读半截，改临时文件原子替换。原失败保留。
- 扫描逐消费者取消后，旧测试误要求Promise相同；现在核对worker去重、共享实际结果及取消不伤其他消费者。
- 整数视口误判保留完整失败和小数观测，门槛未放宽。
- 文案澄清作者来源后，旧QA逐字要求“经校验”失败；加强新准确校验语义、作者来源和组件名检查，失败保留。
- 自定义三次前台HWND/PID不同，硬停止并保留。独占顺序验证后通过；未全局最小化、关闭或向其他程序输入。已退出外部PID不足以猜测其来源。
- 首次实际游戏加载正确PNG，但测试误把URL缓存SHA1 ID当PNG SHA256。保留失败，改检查实际GPU引用cache PNG的SHA256，并另拍无遮挡inventory。
- 独立事务复现pinned v2被复用v1，修复前错误落盘与修复后明确冲突/原文件不变另存。最终成品已包含修复。
- d0dad965旧候选在后续产品更改后不作最终证据；新EXE另跑四主题和游戏。

## 未覆盖

用户原问题实例、完整旧Forge、所有loader/MOD组合、每个Java全新网络重下、两服务完整MOD安装进入世界、多人显示、物理1366×768、完整动效性能和人工听感未覆盖。Windows发行者签名未完成，其他平台未构建。不可变历史纹理保留以保护运行/已接受快照；Windows ownedInventory清单不可用，不能解释为后台全清零。

独立评分见 INDEPENDENT_REVIEW.md及各非实现者报告，分项不平均，不推断未测。源码采用最终Git原始blob逐项校验，交接工具未经修改；公开身份由外部DELIVERY和SHA256SUMS核对。

独立评分最低 8.6，均达到本批 8.5 门槛。蓝白主题窄窗待应用模型卡的 Classic 选中文字对比偏弱，为已记录的非阻断外观问题；原始截图和扣分依据见 INDEPENDENT_LOCAL_RUNTIME.md。
