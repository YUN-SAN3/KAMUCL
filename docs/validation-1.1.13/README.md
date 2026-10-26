# KAMUCL 1.1.13 验证范围与证据规则

2026-10-06 11:54（Asia/Hong_Kong）：按用户最新要求，只交付 Windows x64；Mac ARM64 制作暂停，资源优化及十组/十对门控撤回。现有改动保留，Windows 仍须完成收藏、功能/界面、便携成品、许可/隐私及每项 ≥8.5 的独立评审。本页下方 Mac 和完整资源协议是保留的原计划，不再作为此次 Windows 发布的门槛，也不能据此填补尚未通过的数据。真实服务、夹具、故障注入和人工听感继续分别记录。

本轮仅制作 Windows x64 与 macOS ARM64，沿用 Electron 44.3.0。收藏安装不再将查询失败或空选择静默当作仅安装游戏：可安装项默认选中，不兼容和未关联项列明跳过，查询失败与无可靠文件须重试或明确跳过。零项须明确确认不安装收藏模组。实际完成结果读取目标 MOD 文件并校验哈希，区分收藏、必要前置和跳过项目；失败保留基础实例与补装入口。

## 原生专项入口

```text
node scripts/verify-favorites-113.cjs <Windows便携EXE或Mac.app> <x64或arm64> <portable或app或dmg>
node scripts/verify-mac-job.cjs favorites arm64 app
node scripts/verify-mac-job.cjs favorites arm64 dmg
node scripts/verify-windows-package.cjs
node scripts/verify-download-location-112.cjs <最终成品路径> <x64或arm64> <portable或app或dmg>
```

收藏专项使用独立资料目录，以真实坐标从 Modrinth、CurseForge 搜索并收藏，在实际版本安装弹窗选择 Minecraft 1.20.1 / Fabric，核对所选文件、原请求、必要前置和落盘哈希。真实 Quick Play 生成世界、保存与正常退出、重启持久化分别记录。服务失败、观察器失败及强制清理不能写成游戏验收通过。四主题、960×620、125% 的原始截图与操作单列。

## 资源采集入口

```text
node scripts/resource-native-win113.cjs
node scripts/resource-baseline113.cjs baseline --groups=10
node scripts/resource-baseline113.cjs compare --groups=10 --candidate=<最终Windows便携EXE>
node scripts/resource-mac113-native.cjs
node scripts/resource-mac113.cjs --groups=10
```

测试仅控制自行启动的独立实例。完整进程树包含根进程、渲染、GPU、辅助与启动反馈，按 PID 和创建时间绑定；Java 探测、实际游戏与联机工具单列。Windows 使用原生私有提交、工作集、CPU、缺页及 GPU 指标；Mac 使用内核实际物理占用，并记录可取得的其他指标与权限限制。不同指标不互相冒充。工作集整理或强制 GC 后的下降不计真实资源优化收益。

正式同机采集先完成至少十组 1.1.12，冻结每项原始自然波动，再完成至少十组基线/候选交替对照。核心采集固定黑橙主题、相同窗口、缩放、素材和设置；四主题与最小窗口外观另行验证。覆盖冷暖启动、20 张完整轮播、皮肤、32 次卡慕队列、1000 模组、128 MiB 合成整合包、隐藏恢复及 20 次编辑器开关。保留原始时间戳和采样，不插帧、不删除异常值。冷启动不代表操作系统磁盘缓存已清空；采样峰值也不能覆盖两次采样之间的瞬时峰值。

以下是算法或工具资格验证，不能替代完整原生应用验证：

```text
node scripts/benchmark-mod-resources-113.cjs <1.1.12完整提交SHA>
node scripts/resource-stream-bench113.cjs
node scripts/resource-java-probe113.cjs
node scripts/resource-production-workers113.cjs
node --test scripts/resource-mac113-tests.cjs
```

微测试区分文件指纹、目录扫描、图标队列、计划释放、流式哈希与 ZIP、只读 JVM 探测及最终生产 worker。新增 Java 探测堆限制只用于版本、路径、模块和诊断探测，不改变实际游戏堆或用户分配。小压缩包保留原解码路径，大包采用目录元数据和条目流；所有格式、安全限制、CRC/哈希、取消与事务回滚继续验证。

## 放行与未覆盖项

正式采集前冻结协议第 3 版：两平台均先完成全部正常前台负载及二十次编辑器开关，再进行原生隐藏/恢复。Windows 公开 1.1.12 已确认恢复时原生可见且聚焦，但原 Chromium 文档晚报告隐藏、步态和回调停止，因此不能把停止动效的资源指标当作正常恢复的对照。仅 SHA256 完全匹配公开 EXE、完整原始三秒步态/回调、真实进程树/前景窗口及 DWM 遮挡证据符合精确签名时，将该旧版缺陷保留为 `functionalPass=false`；`collectionComplete` 只表示原始采集和自然退出完整，`complete` 仍表示全部功能通过。所有 Windows 恢复后的指标在冻结前统一排除性能收益/等价比较，包括偶尔正常恢复的旧版运行；候选必须全部功能通过且另做连续二十次原生恢复。Mac 不允许旧版 Windows 例外，全部阶段仍须通过并比较。其他正常前台、隐藏指标继续执行十组原版噪声冻结及十组交替对照，任何未知失败仍阻止放行。此前失败和旧 CPU 单位错误的资料只作历史原件，不回填通过。

运行 `npm test`、`npx tsc --noEmit`、`npm run license:check`、生产构建、成品完整性及干净启动。独立子 agent 根据最终截图、录屏、资源原值、落盘清单分别评估合理性、功能性、外观，每项至少 8.5/10 且无关键缺陷。收益需超过预先冻结的自然波动；可重复退化、持续增长、漏图、漏声或功能失败阻止发布。

逐项收益、舍弃的候选、首次失败、最终原生结果、真实服务/合成夹具/故障注入/听感及公开成品身份在该版本交付记录中单独列明。不能证明归属和无人使用的旧运行缓存不删除；已有分页、懒加载及历史释放机制不重复计作本轮收益。Mac ad-hoc 签名不等于 Developer ID 签名或公证；人工听感未完成时保持未覆盖。

个人图片、账号、凭据、用户整合包、存档及 `pelican-bicycle.html` 不进入公开源码或交接包。其他六人的历史计数及用户原目录保留，wuhui 不操作。
