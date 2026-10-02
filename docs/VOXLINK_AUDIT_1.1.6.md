# VoxLink 1.1.6 接入审查记录

审查基线：AUGUHDAR/VoxLink `c475faa98cca16d4a2eeef4422c862c36091e1fc`。
上一批来源为 `924845e897d8fb36dca2474ade30e675278559d0`。
接入文档保存在 `docs/launcher-integration.md`，对应固定提交，参考目录保持只读。
文档是技术参考，不覆盖用户授权、项目交付规则或文件保护规则。

## 变更对应

| 上游领域 | 启动器位置 | 验证 |
|---|---|---|
| StdTurnClient / ConnectionManager | stdTurn.ts、turnRelay.ts | 实际回环 UDP 的 401 挑战、认证 Allocate、Permission、ChannelBind、Refresh(0)、取消；独立 HMAC 与帧长度检查 |
| SignalingWsTransport | session.ts / ws | 15 秒原生控制 ping、35 秒半开判死、10 秒检查；真实 WebSocket 回环接收 ping；断开、重连与取消 |
| 加入/房间生命周期 | engine.ts / index.ts | 有界瞬态重试、操作代数、信令来源、退出原因、过期和取消守卫 |
| 活动打洞模板 / NAT | punchRounds.ts、engine.ts、voxlinkNat.ts | 两参数模板推荐、20 秒切换节流、显示分类分离；静态常量与 pin fixture 对照 |
| RUDP | rudp.ts | 直连 1400、TURN 1374；同 IP 双观察重绑在最小载荷门前；双路径接收、健康与清理 |
| TURN 生命周期 / 后台直连 | turnRelay.ts、turnBackground.ts | 玩家主动首次启用；300 秒窗口、30 秒轮询、60 秒热备请求；20 秒稳定观察、11 秒释放宽限；回环握手及调度器加速的观察/释放检查 |
| ModSync | modsyncService.ts / VoxLinkModSync.vue | 保留 required/full 两档、实例归属和哈希校验；五种门控结果、持久提示；不自动移动/删除不同版本文件 |
| TicketClient / Ticket UI | tickets.ts、ticketsIpc.ts、VoxLinkTickets.vue | 凭证保护、受控附件、重复追问、撤回、删除/未读、限频、取消；模拟 API 与隔离 GUI |
| RelatedLinksScreen | voxlinkLinks.ts | 对照固定提交的八个链接 |

## §9 逐值常量

`tests/voxlink-upstream-1094.test.ts` 从 `tests/fixtures/voxlink-c475faa9` 读取真实 Java 源码。
逐字段核对八个 PunchProfile、五套 SendParams 的 55 个字段、SymParams 的 11 个字段和 PunchTuner 九常量。
另检查 PortPredictor 融合、置信范围与钳制，NAT 推荐矩阵、连续零收包终局和预测关闭上限。
SOURCE fixture 保留 LGPL 来源；第三方通知与对应源码材料覆盖新增移植文件。

## 启动器适配与实际覆盖范围

工单 client 标签为 app；采用全启动器本地索引，并按服务地址隔离，用系统 safeStorage 保护 secret。
用户账号凭证、secret、任意文件路径不进入前端；附件使用窗口所有的限时选择凭据。
原生 WebSocket 使用 ws 控制帧，未使用文本模拟 ping。
Node 事件/AbortController 替代 Java 执行器、锁与 Future；常量按对应源码核对。

后台直连增加重新读取新探测 socket 的 STUN 映射，并在同一信号类型中回传实际映射；
避免使用已释放的初始 ICE socket 映射。热备请求也报告其待用 socket 的映射，
候选者回报新映射，房主只转发本次指定候选者的回执；重复通知复用同一探测。
玩家中继使用当前模板的 relaySocketCount，
在明确传入 punchAuth 的 KAMUCL 中继链路上按目标加入者 ID 派生同一密钥。
这些启动器适配通过回环检查，但尚未验证与所有上游 Java 客户端组合的公网互通。

Launcher 无法调用 Minecraft mod 内的程序化重连接口。
TURN 死亡后可建立热备玩家中继的新本地地址，UI 明确提示游戏可能需要重新连接。
不会宣称该场景保持了原有 Minecraft TCP 会话。
实际上游标准/旧 TURN 节点已通过临时私有房间的真实鉴权、绑定和 5000 字节数据校验，
释放和退出也已成功，证据位于 docs/validation-1.1.6/voxlink-live.json。
后台热备的跨 Java 客户端互通及公网对称 NAT 仍属于未覆盖网络验收。
回环网络测试和模拟协议测试不能证明上述真实网络组合已经通过。
