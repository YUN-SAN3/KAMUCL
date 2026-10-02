# VoxLink 1.0.94 对接整改记录

参考版本：AUGUHDAR/VoxLink `main`，提交 `924845e897d8fb36dca2474ade30e675278559d0`。
契约：该提交的 `docs/launcher-integration.md` 全文，重点 §5、§7。
Java 路径前缀：`fabric/1.20_1.20.1/src/main/java/icu/wuhui/voxlink/`。
参考 checkout 仅拉取，无源文件修改。

## 参数和机制定位

| 启动器文件 | 上游来源 | 核对内容 |
| --- | --- | --- |
| punchProfiles.ts | network/PunchProfile.java | 8 档全部字段、5×11 个 SendParams 值、11 个 SymParams 值；逐字段来源注释 |
| punchPolicy.ts | network/PunchTuner.java、PunchParams.java | 9 个常量、失败分类后的参数调整、晚周期调整 |
| punchPolicy.ts | network/PortPredictor.java | 回归 0.6 + 增量 0.4；四分位截尾 EMA；按样本数置信范围 |
| punchPolicy.ts | network/NatClass.java、PunchStrategySelector.java、PunchFailureClassifier.java | NAT 矩阵、正向/反向策略、失败分类顺序 |
| punch.ts | network/UdpHolePuncher.java | 渐进扫描、完整范围随机采样、多 socket、PPS 3000、bomb/spray、衰减、防火墙检测、单个有效控制包移交 socket |
| punchRounds.ts | room/ConnectionManager.java | 尝试/周期/持续轮次、失败类型计数、20 秒档位冷却、零收包终局及预测关闭上限 |
| engine.ts | room/ConnectionManager.java | 正反向独立 socket、房主多 socket 轮次、映射列表更新、额外端口尝试、LAN/IPv6/TCP、同一玩家的连接赢家和取消 |
| stun.ts | network/StunProbe.java | 首个可达 STUN 后固定目标顺序采样、重发抖动 |

`scripts/extract-voxlink-profiles.cjs` 从未修改的 Java 源码生成参数表。
`tests/fixtures/voxlink-924845e/` 保存原始 Java 参数文件；自动测试独立解析并逐字段核对。

## 文档与源码差异及明确约束

- 按用户确认采用最新 §7.5：`/room/join` 成功后服务器注入 `join_request`，失败重试重新加入；不存在客户端 1.5 秒重发定时器。
- §7 参数表的 `SEND_WIDE.jitterBaseMs` 为 600，实际 Java 源码为 **500**，移植按源码 500。
- Java 定义了发包模板的 jitter 字段，但当前发送器没有使用它们；保留原值，不自行添加调度抖动。STUN 实际使用的重发抖动单独移植。
- Java NIO selector / 接收线程以 Node UDP 事件实现；PPS 使用单调时钟，计时精度受 Node 事件循环和 Windows 调度影响。
- 12 秒是 DEFAULT 的单次尝试模板值，120 秒是房主单组 socket 生命周期，均不是整个联机会话的放弃期限。持续轮次不设 50 轮/8 轮上限。
- `PREDICTION_OFF_CAP=50` 是 §7.5 明确的正交限制，不是总轮次；仅整会话从未收到有效包时生效。曾收到包的会话仍持续尝试。
- 自动 TURN 的三条路径全部移除。满 20 秒只显示入口，玩家点击才分配；失败保留手动重试，不自动重打。手动选择后取消同一玩家的 UDP、TCP、反向与额外端口尝试，迟到回调受所有权和会话代次约束。

## 玩家界面

入口、连接进度、成功地址分别展示。加入/创建后自动进入进度；成功显示本地地址、复制按钮和“进入游戏 → 多人游戏 → 直接连接”。阶段变化清理旧地址及阶段。相关链接在顶部；公共大厅为卡片网格；日志按阶段折叠并区分详细、阶段、提醒、错误。

创建房间保留端口自动探测及手动输入；无游戏时提示“请先启动游戏并对局域网开放世界”。ModSync 主进程文件未修改，选择实例、两档清单、校验与重启提示保留。

## 验证边界

参数逐值测试、算法测试、本机 UDP/RUDP/TCP 数据往返、取消与手动 TURN 状态回归，以及 Windows 界面/便携包检查随本批执行。它们不能替代两台不同运营商网络、真实对称 NAT、CGNAT 和公网 TURN 节点的实机互联验收；未将本机通过描述为所有 NAT 环境都已验证。
