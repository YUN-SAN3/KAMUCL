# KAMUCL 1.1.23 中文 MOD 部分名称检索

本报告记录 2026-10-14 的实现、映射来源与验证边界。它不是 Minecraft 游戏启动、完整账号登录或所有平台功能验收报告。用户图片、收藏、游戏目录、账号与玩家数据不参与这些检索夹具。

## 实际行为

- 中文 MOD 查询允许输入登记中文名的片段，例如“无尽”“机械”，无需记住完整中文或英文名称。已知一字名称或简称继续兼容；普通英文查询、整合包、材质包、光影与数据包沿用原分页入口。
- 原中文源站查询、本地登记名称对应的英文检索、百科明确相关项目链接并行进行。精确名优先，但不会删除独立的相关改版或附属。
- 来源项目保留自己的 `source`、`projectId`、`slug`、英文原名与下载入口。只有来源和 slug 核对一致的名称关联才追加中文标签；宽泛英文相关结果不冒充本体，不根据“第一个搜索结果”生成下载身份。
- 精确名称、百科明确的斜线别名、前缀、包含关系依次排序；同层按下载量、名称、真实身份稳定排序。最多下载和最新发布作用于整个已确认集合。
- 补充阶段保留已显示项目的顺序，新确认项目追加；每批结束才统一排序。界面使用真实项目键，并恢复可见卡片与操作焦点。
- 查询固定来源、版本、加载器与排序。首次进入默认全部版本；已有手动条件与返回页面的关键词、已显示前缀、滚动位置继续保留。零结果不会自动放宽条件，“查看全部版本”须由用户明确点击。
- 每批共同截止为 10 秒；全社区传输最多四路，百科最多两路。百科每批最多读取两页搜索与五个词条，源站任务另有受控批量上限。剩余候选可继续补充，失败不当作“没有兼容项目”缓存。
- 相同进行中的新检索共用工作和传输。取消仅解除自己的订阅，最后一个订阅退出才中止对应请求。旧直接分页查询保留独立的显式刷新，仍受共同四路预算约束。

## 接口与状态

新增搜索入口为 `community:searchStart`、`community:searchContinue`、`community:searchCancel`；进度事件为 `event:communitySearchUpdate`。现有 `community:search` 及下载、收藏接口保留。

- Start 使用公开随机 `requestId` 和冻结的查询条件，立即返回快照，后台继续补充；事件仅发送给请求者的 renderer。
- 快照包含递增 `revision`、冻结 `query`、`phase`、完整可见前缀 `items`、已确认集合的 `total`、`totalKind: confirmed`、剩余发现状态和可选 cursor。`total` 不估计尚未核对的源站结果。
- Continue 区分 `page`（显示更多已确认项目）和 `discover`（继续一批发现）。旧 cursor 或重复操作不会重复推进；快照替换前缀，不将同一批结果重复追加。
- 来源、请求 ID、筛选条件或 revision 不匹配的晚到消息不能覆盖当前查询。离开页面取消订阅；返回保留快照，继续时使用新请求 ID。
- 可见前缀恢复的 Start limit 最多 1000；它不改变源站单请求最多 50 项的限制。继续分页增加已确认前缀，不代表一次读取数千条远程数据。

实现位置：`src/main/core/communitySearchSession.ts`、`communitySearchBudget.ts`、`mcmodSearch.ts`；前端会话与协议处理位于 `src/renderer/src/communityProgressiveSearch.ts`。IPC 绑定以实际发送者 ID 隔离会话，并在其销毁时清理该发送者订阅。

## 本轮新增映射的来源

只登记公开名称、项目身份和出处，不复制百科正文、素材、访客列表或 MOD 文件。2026-10-14 读取的官方项目页与生产元数据相互核对如下：

| 新登记 slug／名称 | 已核对来源和项目 ID | 公开依据 |
|---|---|---|
| `avaritia`／无尽贪婪 | CurseForge `233785`；不把同 slug 的未知 Modrinth 项目追加此中文名 | [MC百科 505](https://www.mcmod.cn/class/505.html)、[作者发布的 Avaritia](https://www.curseforge.com/minecraft/mc-mods/avaritia) |
| `avaritia-1-10`／无尽贪婪 1.1x | CurseForge `261348`，其原英文名称为 Avaritia 1.1x | [作者发布的 Avaritia 1.1x](https://www.curseforge.com/minecraft/mc-mods/avaritia-1-10)、[原版作者指向移植版的说明](https://www.curseforge.com/minecraft/mc-mods/avaritia)、[MC百科 505](https://www.mcmod.cn/class/505.html) |
| `re-avaritia`／无尽贪婪：重生 | Modrinth `QeB3NRC5`、CurseForge `623969`；两来源各保留自己的项目身份 | [MC百科 6439](https://www.mcmod.cn/class/6439.html)、[Modrinth Re:Avaritia](https://modrinth.com/mod/re-avaritia)、[CurseForge Re:Avaritia](https://www.curseforge.com/minecraft/mc-mods/re-avaritia) |
| `avaritia-endless`／无尽贪婪·伪 | CurseForge `624491` | [MC百科 6422](https://www.mcmod.cn/class/6422.html)、[作者发布的 Avaritia Endless](https://www.curseforge.com/minecraft/mc-mods/avaritia-endless) |

这些明确关联也建立了 `avaritia` 的英文家族拼写。独立的家族查询保留具有该英文名称或 slug 特征的真实源站项目，不凭家族相似性为其增加“本体”“重生”等中文身份。其他旧登记项目（例如 Create）同样可以发现英文名称或 slug 包含对应检索词的合法相关项目；并非只为“无尽”编写特例。

实际生产检索重新核对项目身份，表内项目 ID 是审计证据而非绕过查询、版本筛选或下载校验的静态安装目标。MOD 文件的下载、必要前置与哈希校验继续使用原有安装事务。

## 证据与范围

### 真实服务元数据

最终后端只读服务记录：`out/community-search123-live-84db485e-526e-401b-a808-b9712a81b519.json`。代码哈希、每次公开请求的 URL／状态、快照与原始毫秒计时均在记录中。该验证使用独立临时配置和正常 TLS 的本机代理传输，没有读取现有玩家账号，也没有向安装或游戏启动接口提交请求。

| 实际查询 | 已确认数量 | 第一项结果出现 | 本批 ready |
|---|---:|---:|---:|
| 无尽／全部来源 | 112 | 500 ms | 1902 ms |
| 无尽／Modrinth | 17 | 251 ms | 993 ms |
| 无尽／CurseForge | 96 | 84 ms | 1154 ms |
| 机械／Modrinth | 117 | 237 ms | 1679 ms |

无尽查询中实际出现原版、1.1x、重生和伪的上述项目身份；“机械”中实际出现 Create 的 Modrinth 项目 `LNytGWDc`。数量代表当次已确认集合，随服务数据变化，不是完整源站总数或固定性能承诺。

该记录的 `complete` 仅表示四个元数据案例进入 ready 且返回有效结果。部分百科请求发生访问受限或读取失败，相关警告和未核对候选均保留，不能因此宣称百科全部成功或检索已经穷尽。更早的记录 `out/community-search123-live-d0ea1e7c-18af-4234-9e7b-ffbbae7e9b38.json` 保留作为历史观察，其代码哈希与计时不代替最终版。

### 夹具、故障注入与协议

后端专项 17 项联合旧社区回归共 66 项自然退出、零失败。命令：

```text
npx tsx --test tests/community-search123.test.ts tests/community-116.test.ts tests/community-117.test.ts tests/community-120.test.ts tests/community-browse.test.ts
```

覆盖部分名称、精确名称、来源特定中文标签、假身份拒绝、各项目 ID 去重、全过程筛选、全集合排序、可见前缀、五条词条续查、一次 cursor、双订阅取消、双用户故障恢复、真实 10 秒截止、补充阶段不跳位、扩展汉字和旧分页刷新。

独立前端／IPC复核使用真实编译的 Vue 脚本与协议夹具：新前端／IPC专项 11 项，与旧 120 兼容组联合为 33 项通过；另运行 QA 观察器与证据门槛脚本 9 项通过。它们验证晚到 Start、先到进度、重复 revision、换条件、页面退出、保留前缀、新请求 ID、正确发送者与订阅释放。联合组中还包含旧后端回归，该部分不计入独立前端评分。夹具结果不能替代原生产成品的坐标操作。

原生验证脚本 `scripts/community123-native-smoke.cjs` 使用原成品、独立空配置、真实坐标输入和生产 IPC。其公开证据须以实际执行的最终 receipt、截图及 SHA256 为准；仅源码中存在此脚本不表示已经通过。`community123-live-probe.cjs` 的目标项目查询、详情与文件清单属于真实服务验证；独立完整网络字节检查仍须与启动器安装事务、游戏运行分开记录。

### 保留的历史失败

1. 首个新解析测试对相关项同级顺序的期望错误（标题长度决定候选读取顺序）；修正为明确的排序规则后通过，没有删除相关项断言。
2. 第一次联合运行 48 项中 8 项失败：3 项为旧“精确命中就删除相关条目”的期望，与新发现行为冲突；5 项为旧 Vue 测试 API 夹具缺少新接口。相关条目现分别验证来源身份；原 HTTPS、正文链接、错 slug 与陈旧标题的拒绝断言保留。
3. 全局传输去重最初合并了旧直接分页接口的并发显式刷新，使人工延迟响应的旧 count-revision 测试挂起。仅终止了自己的该次测试。整改为新可取消会话／事务共享传输、旧显式刷新独立执行且仍受共同预算控制；原并发恢复与 revision 断言未放宽，联合 66 项自然完成。
4. 实际服务中百科访问受限与条目来源缺链保留为部分失败，而非转换成“没有任何模组”或覆盖已确认源站结果。

前端独立代码复核另指出：缓存 ready 快照的“继续补充”应在同一次明确操作中真正继续一批；Start IPC 失败应终止正在补充的状态文案。这两项的最终修复及复验状态须随最终证据更新。

验收脚本原先仅对“重生”使用名称正则，现已改为固定来源／项目 ID／slug 三者一致（Modrinth `QeB3NRC5` 或 CurseForge `623969`）。已增加错 ID、错来源、错 slug 即使标题相似也不能通过的负例，证据门槛脚本复跑 9/9 通过。原生复验仍须绑定最终脚本与成品，不能将这个脚本单元结果当作原生运行结果。

本报告不对未查看的最终截图打外观分，不把人工听感、整合包导入、完整 Microsoft 登录、真实游戏启动或 Mac 历史图形问题计入本次检索验证。最终放行分数由独立 QA 依据最终成品、截图、操作和服务证据逐项给出。
