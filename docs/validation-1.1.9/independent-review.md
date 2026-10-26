KAMUCL 1.1.9 Windows 独立交付评审

本轮仅 Windows。用户直接调整范围：“暂时不输出intel arm64的mac版本”；“暂时不做intel arm64的mac版本”。complete=true / passed=true 仅限 deliveryPlatforms=[windows]，不表示全部平台通过。

| 分项 | 独立评分 | 主要依据 |
|---|---:|---|
| 视觉 | 9.0/10 | 黑橙、蓝白、自定义主题原截图；紧凑入口、固定编辑器操作栏、统一图片列表和社区收藏入口可见且可读。 |
| 交互 | 9.1/10 | 真实坐标/键盘手势、关闭与失败恢复、原始保存PNG/状态账本、收藏夹具边界、生产窗口最小化/恢复及资源关闭证据。 |
| 动效 | 9.0/10 | 已逐帧观察2270张关键原帧；三主题十次接触与六段125%/150%反馈，接触/回弹/手印淡出/回位完整。 |

三项分别达到9，未发现当前 Windows 关键缺陷；未使用平均分或测试契约代替视觉观察。评审复用独立已完成的原始 Windows 报告，SHA256 0c1444b90526e0271f7cd8a9818292d594848e1873c172477f582d8412954735，核过6083件原件/276183196字节及17件搬迁元数据原字节。正式原采集FPS为100.0925/100.0091/100.3397，原门槛及诊断 false 保留。两次原 collector/wrapper1 基础设施失败和只收集恢复0分别记录，未重跑GUI或改写退出码。

实际 Windows 产品为 07a1d87c0710ab070b763172d27dcf7cebd6547b，EXE SHA256 11a8f16142a0f40519adb2203a91ee7bf74b2ab35ef456729e5034a8fc0aafef，renderer index-rFSz7oqx.js。真实 Windows GUI/补验 QA 为07；最终源码 QA a8496bf81efc1f815dc89b7a3e078f8b6ed89b74 仅桥接源码来源，不把新 QA 当作旧 GUI 的执行源。实际生产最小化暂停258.0939毫秒、恢复6次计数/6独立声音来源、关闭2音频上下文/2WebGL上下文；不推断内存GC或整窗析构。

Mac 暂停且排除本轮交付。a849 原报告保持部分完成，Intel正式APP原帧34→36的130.627333毫秒可见停顿未解决；正式CDP和SCK whole的false仍为false，六例ABA与新增三A仅为诊断。ARM/Intel官方artifact仅以原SHA引用，不生成Mac成品，不宣称全平台合格。

未覆盖：真实硬件听感、微软账号真上传、线上收藏项目真正安装（metadataFixture / mockedPlanOnly / committed:false）、实例专属图运行优先（仅源码）、私有world游玩、冷CDN下载、Mac三主题及后续Mac评分。原始帧观察并非实时视频播放。源产品、旧正式评审文档、Git和History均未修改。
