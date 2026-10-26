# KAMUCL 1.1.16 — Windows 验证范围

本批修复 VoxLink 可靠传输、社区必要前置与返回搜索、中文名查询、被遮挡的版本选择，新增默认关闭的窗口自适应，并修正生成运行文件的等待原因和嵌套语义阶段传播。保留 Electron 44.3.0、GPU、素材和原动效；资源占用优化已撤回。只交付 Windows x64，不将历史 Mac 失败视为本批通过。

## 成品与源码身份

最终 EXE SHA256：`1cd995f199944a4205f4e198eaa832f5ceb1a9ebbb832643af884ea43365fbec`。三份 Windows 成品及源码、交接包身份以公开 `SHA256SUMS.txt` 和归档外部交付回执核对。生产构建前冻结 [502 项实际工作输入](evidence/build/production-inputs116-prebuild.json)，构建后重新逐项核对。测试、QA 与文档的后续变化单列，不冒称成品由后补文档重新构建；源码归档保留 Git blob 字节，文本 CRLF/LF 等价性另核对，不承诺重新编译 EXE 字节完全一致。

证据 [bindings.json](evidence/bindings.json) 关联原始位置、公开副本、字节数和 SHA256。原始截图、帧时间、日志保留，不插帧或改写失败。公开内容为独立测试资料；用户原 ZIP、视频、账号、整合包和存档不公开。

[源码索引核对](evidence/build/source-index116-precommit.json)：500项源码中372项字节完全相同、128项仅CRLF/LF归一；另两份生成的bridge JAR与1.1.15冻结成品一致，其源码和构建脚本本批未改。502项是实际构建输入，不全部冒称Git内源码文件。公开证据用Git属性保留原始字节；源码隐私扫描和pelican排除另行核对。

## 已执行验证与分类

| 类型 | 验证内容 | 能证明的范围 |
| --- | --- | --- |
| 最终全量测试 | [1232 项：1231 通过、0 失败、1 Linux 专属跳过](evidence/build/test116-final.log)；类型与许可通过 | 产品逻辑、既有回归及本轮边界；不是全部真实账号/游戏服务 |
| 四主题真实成品界面 | 黑橙、白蓝、透明、自定义；原生前台 HWND/PID、实际坐标与真实 Ctrl 键；最小窗口及125%缩放 | 新控件、层级、路由恢复、失败恢复、默认关闭与设置保持；白蓝用干净紧凑ZIP，透明用干净展开ZIP |
| 进度界面 | 原产品 Forge 管线夹具事件回放至同一最终 EXE，准备/Java/生成/生成完成/任务完成及独立故障注入 | 原下载中心的真实组件和文案；Java及安装器子进程为合成，不是联网游戏安装 |
| 社区事务夹具 | [21项测试](evidence/tests/community116-tests.log)；本地HTTP文件、必要前置、哈希、取消与提交检查 | 原事务代码的实际落盘与拒绝缺依赖；GUI合成响应不算真实服务下载 |
| 真实服务元数据 | [Modrinth](evidence/services/community116-real-modrinth-04517b8b-18cf-42ca-b2ad-d9248e10ca69.json)、[CurseForge](evidence/services/community116-real-curseforge-da684f9c-8223-44ee-be6d-ecca5d9d0ce3.json)：“玉”“物品管理器”，MC1.20.1/Fabric，官方HTTP200 | 当前生产查询得到 Jade/JEI 等项目；不证明联网安装、前置实际下载或启动游戏 |
| VoxLink 真实本地协议对端 | [36项传输测试](evidence/tests/voxlink116-tests-final.log)与[官方 Java 3MiB 收据](evidence/voxlink/current-3mib.json) | 双向UDP丢包、重排、重复ACK、读端暂停、鉴权、FEC/重传和完整SHA；不是互联网NAT、游戏与语音 |
| Windows 自有进程 | 四主题逐份原始CIM PID/父PID/创建时间与成品 appMetrics；自然退出后所有已见身份为零 | 只核对独立测试实例，不按 electron.exe 名称控制，不结束其他游戏 |
| 干净包 | [Windows包验证](evidence/build/windows-package-1.1.16.json)、许可、解压及启动 | EXE/两种ZIP实际内容与运行；交接许可命令不能替代功能证据 |

VoxLink 当前3MiB往返12.341秒，双向各562次首发DATA故障、各561冗余包，哈希一致。相同受控1MiB条件，基线14.038秒、当前4.490秒，仅是协议故障环境对照，不外推实际网络速度。[官方传输源码](https://github.com/AUGUHDAR/VoxLink/blob/c475faa98cca16d4a2eeef4422c862c36091e1fc/fabric/1.20_1.20.1/src/main/java/icu/wuhui/voxlink/network/ReliableUdpTransport.java)原实现参与测试；周边日志接口为桩，不替换传输代码。

中文名补充覆盖维护的常见别名，同时保留原中文查询与筛选；不是任意自动翻译。每个扩展词最多100个候选并提示范围。必要前置默认选中；取消必要前置会阻止不完整安装并说明重新选择或先自行安装，查询失败可重试。

## 历史失败与处理

1. 最初UDP故障注入器额外制造非计划丢包，旧门槛未通过；修正测试接收缓冲后按原门槛复验，产品队列仍有界。旧记录保留。
2. 初期 Java 收据绑定旧源码；精确注释/换行差异公开记录，最终 a2c 源码重跑1MiB/3MiB，不把旧收据当成当前身份。
3. 安装状态嵌套传播首次严格断言失败，先修 waiting/done；补录真实界面前又发现 Java→处理器仍被外层节流吞掉。[原严格失败](evidence/history/installer116-phase-boundary-first.log)保留。新增可选语义stage并纳入变化比较后，13项相关验证与全量测试通过，重新构建为本页最终成品。旧 ec0 成品和原始证据保留私有历史，不发布为修复完成版。
4. GUI早期 IPC 包装恢复身份、CDP无法触发主进程快捷键及未隔离联网清单的失败保留；改为精确原处理器恢复、真实所属前台 SendInput 和明确合成清单。测试修正不冒称真实网络成功。
5. 旧 owned-close 中Windows库存不可用，只证明外层自然退出；最终额外采集完整 Windows CIM 归属记录。新进度回放定位失败单独记录，不放宽产品断言。
6. 首次构建联网取校验时未完成；只结束精确所属构建进程，改用已安装相同44.3.0运行时完成构建，未降级运行时。

## 独立评审与未覆盖

逐项合理性、功能性、外观须各 ≥8.5/10且无关键缺陷，最终分项结论见 [独立评审](INDEPENDENT_REVIEW.md)。不使用平均分抵消问题，也不让分数替代未执行的真实服务测试。

宿主实际工作区3072×1680 DIP、Windows125%缩放；最小请求960×620实际外框962×623、内容961×622，按内容计算适配。1366×768对应工作区经过政策单测，**未在物理1366×768显示器验收**。JPEG录屏透明背景的合成路径与PNG有差别，控件外观以原始PNG为主；所有原始帧间隔保留，不能凭静态页导航平均FPS宣称完整皮肤、彩蛋或游戏动画合格。

用户提供的ZIP只有视频，没有原卡住的整合包。因此未复现原包完整安装，不能把所有长期等待归因于状态传播。互联网两台主机/NAT、真实Minecraft和语音、人工听感、真实账号联网安装与进入世界、本次完整模型动效基准均未覆盖。Windows成品未做发行者签名。Mac ARM641.1.14历史失败保留，本版没有Mac成品。
