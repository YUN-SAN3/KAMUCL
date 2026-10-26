# 1.1.18 离线皮肤与社区功能独立评审

评审日期：2026-10-07 15:18（Asia/Hong_Kong）。评审者：`java118`。

结论：下列两个范围均达到三项各不低于 8.5 的交付门槛，未发现仍需阻止本次 Windows 交付的产品缺陷。结论只绑定本文列出的最终成品与证据，不适用于早期候选 EXE。

评审者负责过本批 Java 选择修复，以及 `offlineSkinLaunch.ts` 的取消等待修复；这两部分不参与本报告的独立评分。本次独立检查的是他人实现的离线 JVM 皮肤提供器、账号皮肤存储、皮肤页面/编辑器/IPC，以及社区页面状态保持、必要前置选择和执行时固定版本校验。未修改产品源码。

## 评分

分数为基于源码、实际成品和验证范围的评审判断，精确到小数点后一位；不是自动测试百分比。

| 范围 | 合理性 | 功能性 | 外观 | 评分依据与扣分边界 |
| --- | ---: | ---: | ---: | --- |
| 离线皮肤 | **9.2** | **9.1** | **8.9** | 账号独立存储、不可变 PNG 快照、游戏 JVM 内提供服务，适合离线账号的本机显示目标。首次下载及校验 authlib-injector、缓存后断网使用、下次启动生效、其他玩家由服务器决定的说明准确。四主题实际 UI、四个 Java 的官方 authlib 和最终 26.3 游戏均有证据。旧版完整游戏和多人服务器仍未覆盖；小窗口编辑器依赖正常滚动，说明文字较密。 |
| 社区状态保持与必要前置 | **9.1** | **9.0** | **8.8** | 页面快照释放 DOM，保留搜索条件、结果、页信息和位置；晚到响应有代次隔离。默认选择缺失必要前置，取消时阻止不完整安装，失败可重试。固定 fileId 的依赖在执行阶段也校验实际哈希，不能被同 ID 的其他版本静默替代。真实 EXE 页面操作和真实文件事务相互补充；GUI 平台数据是合成 fixture，未把它当成平台联网可用性证明。社区外观实测主要为黑橙主题。 |

## 成品与证据绑定

独立重新计算最终 EXE SHA256：`a0427950efe94c5ffc5f05cca9dcc33b79bab96293cfde7e0c89a2f7198be887`，文件大小 97,323,101 字节。实际 `release/win-unpacked/resources/app.asar` SHA256 为 `b9481c10abfe8256d6889dec2224337a4f6d57a1e313554880a13c8f2f187247`，与[包验证](evidence/build/windows-package.json)一致；便携 EXE 与 ZIP 的中文目录冷/热启动均通过。

实际 ASAR 中 `out/main/modFavorites-BkLfw7T-.js` 的 SHA256 为 `3435a1e62ea8ad8d3ff18debb6896f6e59dbc2d96b79cfb8ca38523fc09329a7`，确认包含固定依赖校验代码。实际解包的 `kamucl-offline-skin.jar` SHA256 为 `5c6d9d267a78fc169c48fc92a93b25cef0c1859715d2da5de49d2a3067cdc185`；六个 class 全为 major 52，并与本批生成的对应 class 字节一致。

已独立校验四主题各 20 张皮肤截图，以及社区摘要中的 11 张截图：共 **91 张，哈希不匹配为 0**。人工查看过各主题的主页面、确认弹窗、小窗口颜色/HEX 控件、账号切换，以及社区状态保持/取消前置和真实游戏截图。公开副本与原始摘要的 SHA256 一致。完整文件绑定见 [EVIDENCE_BINDINGS.json](EVIDENCE_BINDINGS.json)；本文仅声称独立校验了上述截图、下表关键摘要和包装条目，没有把所有录像帧计为逐帧人工审查。

| 关键证据（仓库内公开副本） | SHA256 |
| --- | --- |
| [黑橙皮肤摘要](evidence/ui/offline/black-orange/summary.json) | `7e9fff12c55f6c917e284334debc8bee2d849159a5780fb8ee27d67e61873a02` |
| [蓝白皮肤摘要](evidence/ui/offline/blue-white/summary.json) | `c43209d5e38801e3243bf075c8a9edcbc1da9205a2febeb9e03316eb260e9bae` |
| [透明皮肤摘要](evidence/ui/offline/transparent/summary.json) | `51fbed5391ab3c6784102ce6803039a9421856df3b62c012bcb2aaa1274a79cd` |
| [自定义皮肤摘要](evidence/ui/offline/custom/summary.json) | `c616e56749688cfd6032f4e4674d1899f6fec86db772c1745d6773be2950596d` |
| [社区实际 UI 摘要](evidence/ui/community/summary.json) | `f23989a0870ffde045b17b8aa2ce63544740764a05afe40b0f070bc0fd56399f` |
| [四 Java 官方 authlib 实测](evidence/native-authlib/receipt.json) | `c5d65f8b774b915dbc49654b5b2bceabe7ebf7c60bda7287eb109b875f88953d` |
| [最终实际游戏摘要](evidence/native-game/proof.json) | `e698cb6842d185867210d1df8f04065b228eeb4987a071220a945f8d372bafae` |
| [最终游戏截图](evidence/native-game/game-2026-10-07_15.13.51.png) | `d0614a3feaea6b718d40cab2ce243a768c0c7b33d8e6fa98e67347fa4700050d` |
| [固定依赖修复前复现](evidence/history/pinned-before.json) | `addf5d2f1aede9ddb2ce68b90244f742045fdf6331fcbaa3e757d599bc1e2c14` |
| [固定依赖修复后复现](evidence/tests/pinned-after.json) | `78f0ec60457ecdc87d0a7ec3ac54564525b247f573002c26228a5e138c3568e3` |
| [最终全量测试日志](evidence/tests/final.txt) | `2fd0ad1d89f1232de2fc9cbd6cbdf86fe9bd8cf5785f42e316a51a15ec672afe` |
| [Windows 包验证](evidence/build/windows-package.json) | `1c58dc3fdab8b55869d096f999101fb3cb49888029f1c7a5e82505c459b7cc9b` |

## 离线皮肤检查结果

- 存储按账号隔离，编辑器提交绑定打开时的账号。实际 UI 中 A 的延迟回复不会把 A 的皮肤/历史写到 B 的当前预览；提示明确说明 A 已应用、当前账号保持不变。生产 PNG 解码、磁盘 manifest、历史恢复和账号切换为实际操作；延迟回复本身是受控调度 fixture。
- 提供器只监听回环地址，以随机 nonce 和明确账号 UUID/标准离线 UUID 别名限定请求；签名和 PNG 字节来自本次启动的不可变快照。未发现全局替换其他账号纹理或对外公开服务的问题。提供器运行在游戏 JVM 内，启动器关闭后的游戏进程不依赖启动器继续提供 HTTP 服务。
- Java 8/17/21/25 分别用真实官方 authlib 1.5.25/4.0.43/7.0.61/10.0.77 验证安全纹理解码与 PNG。评审者独立核对了证据中的 40 个不同官方库文件 SHA1 和 authlib-injector SHA256，均匹配。此处验证的是皮肤提供器兼容性，不是本人的 Java 自动选择修复评分。
- 最终 EXE 通过生产安装、皮肤应用和启动 IPC 启动真实 26.3/Fabric demo 世界。游戏实际读到 `gpuTexture=true`、`model=SLIM`；上传 PNG 与 GPU 对应缓存 PNG 的 SHA256 同为 `3e2df3fa1bad7ec6848581085c925f314ae24974dd447452093c0f340a6f1fe7`。[实际游戏画面](evidence/native-game/game-2026-10-07_15.13.51.png)显示合成离线玩家。纹理资源 ID 是 URL 派生值，不误当成 PNG SHA256。
- 游戏保存退出，默认资源包实际首次启用；玩家在游戏内关闭后，第二次启动仍为 `resourcePacks:["vanilla"]`。该项只用于排除本次皮肤真实游戏验证被首启/退出流程破坏，不作为默认资源包模块的独立评分。
- 四主题均通过最小请求窗口 960×620 DIP、Electron zoom 1 与 1.25：每种几何下 9 个皮肤控件、14 个编辑控件可见、可命中且未被 inert 遮挡。Windows 实际 DPI 舍入尺寸有单独记录，不声称截图是严格 960×620 物理像素。颜色区与 HEX/RGB/HSV 有实际截图，固定底部动作区清晰可用。

## 社区检查结果

实际最终 EXE 输入 `中文搜索保持116`、Minecraft `1.20.1`，随后滚动并离开/返回社区。前后都是 20 条相同结果，来源“全部来源”、加载器“Fabric”保持一致，`scrollTop` 同为 `393.0804138183594`，`community:search` 调用数前后均为 **4**。这证明该实际往返没有通过偷偷重新查询来伪造恢复。源码与 session 单元测试另覆盖来源、加载器、已加载页/offset 等快照字段；该 GUI 用例没有实际切换来源或加载器，也没有切到后续结果页。

必要前置实际 UI 默认勾选。取消选择时安装按钮禁用，红字解释缺失前置并且不写入所选 MOD；关联项可查看项目。合成查询失败保持明确失败，重新检测恢复前置选择，确认后 ledger 记录 `mods:commit(..., true, ...)`。所有 fixture IPC 恢复原处理器，剩余计划为 0。该用例的元数据和提交回复是合成数据，不声称真实平台下载成功。

独立执行 `npx tsx --test tests/mod-workflow.test.ts tests/community-116.test.ts tests/community-117.test.ts`：**39/39 通过，0 失败**。其中实际临时目录/HTTP fixture 事务覆盖直接和递归固定依赖冲突、相同哈希不同文件名复用、缺少远端哈希时使用已下载字节哈希、循环依赖固定 root、确认等待期间已安装文件变化、未固定版本兼容复用，以及精确文件 ID 不匹配。

修复前真实事务已经下载 `front-v2.jar`，执行时却复用 `front-v1.jar` 并安装 root；修复后同样输入明确报“前置版本冲突”，目录只保留未改变的 v1，没有写 root/v2。执行代码也在关闭自动前置下载的路径重新核对固定哈希，不能把被修改的已安装文件继续当成满足要求。

最终全量日志为 **1343 项、1342 通过、0 失败、0 取消、1 项 Linux 平台跳过**。这是对主任务最终日志的独立核查，不声称评审者重新运行了全部 1343 项。

## 已解决问题、保留限制与未覆盖项

1. **已修 P2：固定必要前置被同 ID 旧文件替代。** 修复前后复现、五个新增事务用例及实际 ASAR 校验形成闭环；未固定版本的兼容复用仍保留。
2. **已修措辞：下载组件来源。** 最终页面与确认弹窗明确说“作者官方来源下载并校验 authlib-injector”，没有把第三方组件说成 Mojang 官方组件。
3. **已修验证覆盖：颜色截图拍错滚动区。** 早期颜色截图只显示模型区域；最终四主题颜色/HEX 截图均在实际颜色区域，补充证据没有修改或拼接图像。
4. **保留原始失败：自定义主题前台窗口不匹配。** 三次运行因 foreground HWND 不等于绑定窗口而硬失败，未放宽断言或伪装成功；独占 GUI 后完整通过。失败见 `evidence/history/focus-failure-*.json`。现有证据不能将短命外部 PID 的抢焦点归因于产品；失败运行不计入通过数。
5. **P3 设计限制：历史纹理不做垃圾回收。** 可见历史最多 30 条，旧 PNG 文件可能长期保留。未做无证据 GC；长期大量换皮肤的磁盘增长未进行压力测量。
6. **未覆盖：** 完整旧版 Minecraft 游戏世界/渲染、多人服务器对其他玩家的显示、所有第三方 MOD 组合和长时间 JVM 服务压力；官方在线账号的真实上传不属于本次离线功能验证。四个 Java 的官方 authlib 验证不能替代四个版本的完整游戏验证。
7. **未覆盖：** 真实 Modrinth/CurseForge 服务故障、认证/限流变化和所有项目元数据；社区 GUI 使用合成平台回复，后端事务独立使用真实文件和 HTTP fixture。社区跨重启恢复不是承诺：session 只在本次启动内存中保留。社区实际往返外观主要覆盖黑橙主题，不借用皮肤四主题截图声称社区也有同等四主题覆盖。

本报告只批准所列两个范围与最终 Windows 成品的本次交付门槛；未给 Java 实现自评分，也未将已知未覆盖范围描述为通过。
