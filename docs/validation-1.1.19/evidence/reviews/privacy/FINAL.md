# KAMUCL 1.1.19 公开证据隐私与原始字节审计

审计者：packs118。范围为当前 `docs/validation-1.1.19` 新批证据；不评价本人实现的 MRPACK 功能。审计仅读取输入，另写本报告；未重新运行 GUI、游戏、构建或修改产品。

**通过，未发现发布阻断。** 当前清单 **377 条、42,820,091 字节**，每条公开文件与 original 的大小和 SHA256 均一致。新增的 9 份最终报告、验证记录及日志 **323,393 字节**全部原样；没有未列出的 evidence 文件、重复目标、越界来源或非普通文件。清单 SHA256：`0269f1b3a676b88b25820653abc9497de488bd0d169ec97588c6764cbbdcf646`。核对时清单未变化。

- **图片与时间：** 101 张公开 PNG 均与原 proof 的 SHA256（以及原记录提供的大小）一致。189 张 JPEG 原帧均在清单内，公开 recording.json 与原件完整字节一致，frames 数组、receivedAt、timestamp 等字段未改写、重基准或插帧。
- **制品关联：** 最终 EXE SHA256 为 `7b11d4979f1d3afc72397b501770130e3c5e23e2e246deaa70a06276f6a61a65`，ASAR 为 `42697b9e8e9e1ef75ae7f9e6fa75eb41658002f235ed9f1bd2ec324c9454e2a1`。17 份保留 EXE/17 份 runtime ASAR 重新读取均匹配。16 份 proof 和 owned-child ledger 的原 SHA、PID、父 PID、启动时间、关闭结果及 EXE 出生时间关联均一致，其中 13 份完整、3 份历史未完成记录原样保留。
- **隐私：** 74 份公开 JSON/MD/TXT/LOG（包含新增 9 份审查资料及 README/清单）没有发现非脱敏凭据字段、常见 GitHub/AWS/JWT/Slack 令牌或私钥标记。未发现用户整合包、世界负载、用户图片来源、账号凭据文件或 `pelican-bicycle.html` 纳入新证据。
- **合成夹具：** 15 个公开包逐一读取；5 个成功 MRPACK 只有指定 index 和两份 synthetic/client 配置、files=[]；5 个损坏包只有故意损坏的 index；5 个 JAR 为 9 字节 synthetic 占位。源码明确生成这些夹具与虚构的“界面验证账户”，并注明真实窗口操作、合成安装与未进行游戏/在线账号请求的区别。
- **公开表述：** README、两份最终评审及单独绑定记录均把制品关系说明为运行后核对。未把原 proof 回填成启动当时观察到 process.execPath/EXE hash。

关联强度为**事后保留字节 + 原文件时间 + 唯一 owned-parent PID/ledger 关联**。这不能升级为当时已记录可执行文件路径或哈希；旧辅助模块也不能自动获得逐轮 PID 绑定。原始录屏时间未改，亦不意味着对未记录事件补充了当时观察。

限制：本报告未扩大到既有全仓历史或后续新附件。所有 PNG/JPEG 均核对字节与来源，但隐私目视只抽查了黑橙 blank-outer-painted.png 与 frame-0001.jpg，未宣称逐图 OCR 或所有隐蔽编码排查。原资料中保留 QA 主机用户名 ROG、专属临时目录、PID、端口和时间等环境标签；不宣称完全匿名化。未进行新的 GUI/游戏或在线服务验证，未自评 MRPACK 的功能性/外观。

结构结果见 [review119-privacy.json](review119-privacy.json)。

