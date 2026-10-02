# VoxLink 对接核对（KAMUCL 1.0.91）

基准：VoxLink `main` 提交 `721c7fae05851971996e49a3ad0e595d5aa9a053`，完整阅读 `docs/launcher-integration.md`，并核对对应 Java 实现。参考克隆位于开发机 `out/voxlink-reference-1091`，没有修改该仓库。构建不依赖这个克隆。上游文档提及的服务端 `ws.go` 不在该克隆内，WebSocket 帧依据文档及 Java 客户端核对。

## 核对与适配

| 功能 | 上游依据 | KAMUCL 实现 |
| --- | --- | --- |
| 相关链接 | 契约第 1 节、RelatedLinksScreen | `shared/voxlinkLinks.ts` 与 RelatedLinks 弹窗，保留 8 项原名称和地址 |
| 信令 | 契约 HTTP/WS 章节、SignalingWsTransport | session/api：WS 优先、3 秒建连、id=0 推送、HTTP 兜底、重新登记 poll 身份、10/30/60 秒重连、90 秒看门狗、取消时释放请求 |
| 分级打洞 | PunchStrategySelector、PunchTuner、PunchProfile、ConnectionManager | punch/engine：按映射变化分级预测、正向/反向/并行策略、reverse_holepunch_offer 与 reverse_punch_info，限制探测速率与会话次数 |
| TCP 辅助 | TCPHolePuncher、P2PBridge | tcpPunch/engine：tcp_punch_info 与 tcp_punch_go，同端口拨号与监听、期望来源校验、原始 TCP 游戏流转发，取消释放全部套接字 |
| 恢复与竞态 | ConnectionManager | ICE restart 能力声明、3 次及 5 秒冷却，有限重连、UDP/TCP 胜出后取消另一条路径，关闭房间终止旧任务 |
| 中继 | TurnRelayClient、ConnectionManager | turn/turnTcp：3 轮各最多 5 次绑定、15 秒保活、UDP 不通自动切换同端口 TCP、16 位大端长度帧与 UDP 回环转换；角色冲突按上游视为首个绑定回复丢失，后续仍需对端通路成功 |
| 房主模组清单 | ModSyncHost、ModrinthClient、FileHasher、ModEntry、ModEnvironment | modsync/service：绑定所选实例的版本/加载器，SHA1 分块查询实际文件，两档 required/all，前置依赖遍历，排除纯服务端模组，unknownMods，256 项与 128 KiB 限制，缓存两档并响应 requestId |
| 房客同步 | ModSyncClient、DiffPlanner、ModDownloader、选择/重启界面 | check/answer 契约；12 秒检查上限，空清单/旧房主静默跳过；启用与禁用文件都按哈希比较，同名异哈希和不兼容项只提示；用户选择下载，SHA1/SHA512/大小校验，临时文件及排他复制，完成或部分完成提醒关闭游戏重启 |
| 故障日志 | LogUploadManager、契约日志上传章节 | connectionLog：可选、默认关闭，仅脱敏联机日志；按失败/早期掉线安排 gzip 上传，使用规定端点、SHA256 与元数据请求头，退出等待有上限，不上传游戏日志 |

所有路径均通过 `?route=` 对接；HTTP 外层统一 `success/data/error/message`。ModSync 使用 `/room/mods/request`、`/room/mods/answer`，清单版本 `modSync.v1`，scope 为 `required` 或 `all`。房主声明 `modSyncV1`；旧发布接口保留兼容。

## 启动器侧约束与改进

- 主进程持有同步计划与固定实例目录；渲染进程不能提供任意下载地址或落盘路径。切换页面不会把旧任务写进其他实例。
- 下载只接受 Modrinth HTTPS CDN、合法文件名和完整哈希；遇到文件冲突、禁用文件、目录变动或取消不覆盖已有模组。未知模组保留为手动处理项。
- 网络诊断尊重启动器开关，采用脱敏网络事件而非上游完整游戏日志；诊断失败不影响联机。
- 所有衍生文件标注 LGPL-3.0，第三方声明、来源清单及随包许可证已更新；源码随版本发布。

## 验证范围

自动化覆盖双清单构建、分块查询失败、依赖过滤、禁用/冲突/环境校验、固定目录与取消竞态、WS 优先及恢复、TURN UDP→TCP 与分帧/角色冲突、现有 UDP 游戏数据回环。便携包验证收藏排序与持久化、8 项链接、两档模组同步选择、弹窗关闭、窄窗口及最大化还原。

本轮没有真实双运营商 NAT 或 Java 模组与启动器跨公网端到端测试；本地回环和协议夹具通过不能代表所有 NAT、代理及公共中继环境均已验证。
