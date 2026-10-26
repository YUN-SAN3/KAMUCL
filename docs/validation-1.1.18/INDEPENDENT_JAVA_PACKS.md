# 1.1.18 独立评审：Java 与默认材质包

评审者：`/root/offline118`。日期：2026-10-07，香港本地时间。本人未实现本次 Java 和材质包产品代码；本报告不评价本人实现的离线皮肤存储、皮肤页、编辑器或其 QA 模块。本文只新增评审文档，没有改动冻结产品或版本。

最终 Windows EXE SHA256：`a0427950efe94c5ffc5f05cca9dcc33b79bab96293cfde7e0c89a2f7198be887`。评审时重新读取 EXE 计算哈希；Java、模组元数据/扫描、启动、加载器、诊断、材质包及 KeysView 共 12 个相关源文件与 [冻结输入](evidence/build/production-inputs.json)逐项一致。原生 Java 收据中 5 个运行时相关源文件哈希也与当前源码一致。旧 `d0dad965…` 候选证据不冒称最终成品证据。

在以下明确的 Windows 已测范围内，Java 和材质包三项均达到 8.5，未发现未修复的发布阻断问题。六项分别判断，不计算平均分，也不把未覆盖组合算作通过。

| 项目 | 合理性 / 10 | 功能性 / 10 | 外观 / 10 |
| --- | ---: | ---: | ---: |
| Java | 9.2 | 9.0 | 8.8 |
| 默认材质包 | 9.3 | 9.1 | 8.7 |

## Java 结论与证据

**合理性 9.2。** 自动管理选用游戏推荐且满足已知加载器/模组约束的 Java 主版本；完整、健康的同版本运行时可复用，不因已装高版本而随意替代。手动选择保留真实的较高版本兼容空间，同时约束旧 Forge、已知 ASM 上限、架构和模组声明。重命名实例以校验过的客户端证据解析游戏版本；快照和未来版本读取校验 SHA1、来源及 ID 的 Mojang 元数据，不猜测年份或回退到 Java 21。共享准备允许每位调用者独立取消，最后消费者离开才终止共享工作。相关实现位于 `javaCompatibility.ts`、`javaMetadata.ts`、`javaPreparation.ts`、`java.ts`、`modMetadata.ts`、`modScan.ts`、`launch.ts`、`loaders.ts` 和 `instanceDiagnostics.ts`。

**功能性 9.0。** 独立运行 `npx tsx --test tests/java-compatibility118.test.ts tests/default-resourcepacks-118.test.ts`，37/37 通过，原本地日志 `out/review-java-packs118-focused.log`。Java 部分覆盖旧 Forge 的 Java 8、1.20.1 的 Java 17、手动较高版本、损坏候选、错误架构、模组主/补丁版本区间和冲突、官方元数据离线缓存、缓存写失败、共享取消与诊断实际入口。此前独立发现的诊断未使用客户端证据、可选缓存失败阻断选择、扫描不能及时取消及补丁区间冲突问题，当前源码和回归已处理。

[原生 Java 收据](evidence/native-java/receipt.json)真实探测 Windows x64 Java 8、17、21、25，并验证游戏版本选择决策、21w18a/21w19a、24w13a/24w14a 和 26.3 官方元数据。收据中的 `requestedDownload` 是准备策略请求安装的观察值，测试回调返回已经存在且通过探测的运行时；它不证明本轮重新从网络下载了每个 JRE。最终真实 26.3/Fabric 游戏进入世界并保存退出，证明这一组合的实际运行链，而非所有旧 Forge 组合。

**外观 8.8。** 本批 Java 主要改变后端选取与启动反馈；设置的自动管理/手动选择语义明确，日志和错误能指出推荐版本、来源及不兼容原因。评审读取最终游戏准备事件，并查看既有 Java 运行时设置截图作为辅证。此次最终四主题专项截图是材质包页，未将既有 Java 截图冒称最终 a042 成品的四主题 Java 页面验收，也未推定所有小窗口和缩放组合均已通过。此项评分的可视覆盖比材质包窄。

## 材质包结论与证据

**合理性 9.3。** 全局列表作为首次默认；已有游戏目录的空列表、仅 vanilla、启停及排序均是明确选择，后续自动启动保留。新增默认包只补充可选文件。用户显式“重新应用”时只重设受管理选择，保留个人资源包、原 ZIP 和无关配置。旧 `file/` 与裸名称记录可迁移；实际客户端资源格式用于兼容标记，没有证据时不猜测覆盖。修改前校验源与目标，检测并发变更；配置暂存、备份和双文件失败回滚减少半写状态。运行/启动中的实例目录由后端拒绝。相关实现位于 `defaultResourcePacks.ts`、`defaultResourcePackApply.ts` 和 `KeysView.vue`。

**功能性 9.1。** 上述独立测试中的材质包场景实际使用临时文件系统和 ZIP：首次应用、后续全局变化、旧记录迁移、空/vanilla-only 选择、BOM/CRLF/空行保留、格式区间、源/副本修改、发布失败回滚、并发变更及无法回滚时保留恢复副本、目标实例守卫均通过。失败边界是故障注入，不冒称真实磁盘耗尽。

最终 EXE 四主题生产 IPC/UI 摘要均 `complete:true`。真实坐标操作测试了实例选择、一次合成 state-file rename 失败、实际重试、旧/新资源包标识、关闭全局默认后显式重设、原 ZIP/已复制文件保留及重载持久化。客户端 JAR 是仅含元数据的夹具，GUI 用例没有启动这些“1.12.2/26.2”实例。

| 最终主题 | 原始运行标识 | 公开证据 |
| --- | --- | --- |
| 黑橙 | `9ac25265-039a-4182-8923-1894ca85bf8f` | [摘要](evidence/ui/packs/black-orange/summary.json)、[完整观测](evidence/ui/packs/black-orange/live.json) |
| 白蓝 | `b8381c53-d750-4cad-8cd0-967fac6959b4` | [摘要](evidence/ui/packs/blue-white/summary.json)、[完整观测](evidence/ui/packs/blue-white/live.json) |
| 透明 | `0bf23209-2e85-45d7-921b-e7700a52bd74` | [摘要](evidence/ui/packs/transparent/summary.json)、[完整观测](evidence/ui/packs/transparent/live.json) |
| 自定义 | `b46b82e8-597f-487a-8860-fad1a33146ba` | [摘要](evidence/ui/packs/custom/summary.json)、[完整观测](evidence/ui/packs/custom/live.json) |

最终[真实游戏收据](evidence/native-game/proof.json)对应 `game118-0eaa2258-90ed-4458-85cb-c17eeca71211`：原生 26.3/Fabric 实际世界首次加载 `Native-pack118.zip`；实际游戏关闭该包并正常保存退出后，`optionsAfter` 与 `optionsSecondLaunch` 均为 `resourcePacks:["vanilla"]`。这是实际保存/再启动证据。评审查看了[原游戏截图](evidence/native-game/game-2026-10-07_15.13.51.png)及游戏侧 receipt；测试包只证明加载与选择，不证明任意第三方包的图像内容、兼容性或性能。

**外观 8.7。** 实际查看最终四主题各 4 张原始 PNG，共 16 张：`manual-failure-rollback.png`、`manual-controls-1360-zoom-1.png`、`manual-controls-960-zoom-1.25.png`、`persisted-instance-priority.png`。列表、启用轨道/白色滑块、优先级按钮、目标实例及明确重新应用入口在四主题中一致可辨；失败与成功通知文字/颜色可区分。小窗口需滚动，但目标和重新应用按钮能容纳在卡片中，无横向截断。短时间同时显示的旧失败/新成功通知会遮挡列表上部，这降低了观感分数，未遮挡关键重新应用控件；不声称每张截图同时展示全部页面内容。

几何证据记录的是请求 1360×860/zoom 1 与请求 960×620/zoom 1.25 的原生窗口 DIP，宿主 DPI 为 120（Windows 125% 显示缩放）。小窗口实测 native bounds 962×623、content 961×622、renderer inner 769×498、fractional visual 约 769.28×497.92；这些分别有最小尺寸和取整约束，不能称严格 960×620 物理像素或物理 1366×768 机器验收。原始 PNG 为完整 compositor 视口，未裁剪重建；透明主题截图不构成 OS 桌面背景材质专项验收。

## 历史失败仍保留

- [首轮全量失败](evidence/history/first-unit-failures.txt)：1326 项、1323 通过、2 失败、1 跳过；包括 KeysView 旧源码断言及 pinned renderer 测试 JSON 读取失败。旧日志仍然失败，不因最终通过而改写。
- [共享扫描测试失败](evidence/history/shared-scan-test-failure.txt)：1332 项、1330 通过、1 失败、1 跳过。旧用例要求两个调用返回同一 Promise；独立调用者取消需要分开的 Promise、共享同一工作。早退还导致夹具目录清理后的异步 worker 错误。当前测试验证共享 worker 与各消费者取消/排空，最终全量通过；旧失败未删除。
- 早期材质包 GUI `out/qa-packs118-black-orange-0303158c-7006-4385-81e1-bffd7caffcb2/failure.json` 为 `Missing coordinate target`，不是通过结果。脚本随后从实际启用 input 找到所属 label；旧失败原件仍在本地，该文件未在当前公开绑定中，本文没有虚构公开副本。
- [初次游戏断言失败](evidence/history/initial-game-assertion.json)为 `Actual game player must use the applied local hash`。最终用例读取实际 GPU 纹理缓存 PNG 的 SHA256，而不把 Minecraft 内部纹理标识当作原 PNG SHA256；最终匹配值为 `3e2df3fa1bad7ec6848581085c925f314ae24974dd447452093c0f340a6f1fe7`。本文借游戏收据验证 Java/材质包运行链，不对本人离线皮肤实现作评分。
- 验证目录另保留窗口整数几何失败、旧副本说明断言和三次前台焦点中止。它们不是最终通过轮；本报告不对这些离线皮肤用例自评，也不因串行重跑通过而删除旧记录。最终材质包原件仍要求每次坐标/截图的前台 HWND/PID 与所属窗口一致，没有放宽焦点断言。

## 验证身份及未覆盖

独立对 [EVIDENCE_BINDINGS.json](EVIDENCE_BINDINGS.json) 中本范围的材质包、原生 Java/游戏、构建/全量及相关历史/pack 日志共 **43 条、4,558,229 字节**读取原始文件和公开副本，大小与 SHA256 均一致，无不匹配。字节核对不代表逐项语义或图片全部验收；实际查看的最终相关图片数量为上文 16 张材质包 PNG 和 1 张游戏 PNG。[便携 EXE/ZIP 启动收据](evidence/build/windows-package.json)为 `complete:true`；最终[全量日志](evidence/tests/final.txt)为 **1343 项、1342 通过、0 失败、1 Linux 专属跳过**。独立针对性 37 项与最终全量是不同运行，不能相互替代。

未覆盖项：

- 完整旧 Forge 1.12.2、Forge 1.20.1、NeoForge/Quilt 等所有加载器版本的实际世界启动；8/17/21/25 探针及选择决策不能替代这些游戏组合。
- 每个 JRE 的本轮真实网络重新下载、所有镜像/代理/离线首次缓存为空情况；ARM64、32 位、Mac、Linux、鸿蒙实机运行。本次成品评审为 Windows x64。
- 全部 mod Java 条件、复杂嵌套包、第三方修补启动器、未知未来 ASM/游戏版本。解析器没有证据时拒绝猜测，不代表兼容性全覆盖。
- 真实用户原目录的升级/迁移、外部启动器并发写入、真实断电、磁盘耗尽或杀毒锁定；相关失败通过隔离故障注入及临时文件验证。
- 超大/海量 ZIP 的主线程响应、低端机器性能、所有材质包资源内容和渲染效果；本次测试包用于配置语义与加载证明。
- Java 设置页最终四主题专项小窗口截图、所有缩放组合、OS 透明背景与人工可访问性专项；材质包实际截图覆盖上述两档请求窗口。

最终 a042 成品在本文已测范围内合格，历史失败与未覆盖边界继续有效。
