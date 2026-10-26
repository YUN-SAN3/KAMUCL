# 原始失败与修复边界

- 真实 Microsoft：首个401 invalid_client/AADSTS70002；随后同身份/scopes设备码200。用户确认授权页KAMUCL，但旧代理轮询NETWORK_ERROR终止；修复后正常轮询至设备码过期。完整token/Xbox/XSTS/Minecraft链未认定通过。
- full Windows第一轮：5旧接口/ZIP断言失败，其中2个模组更新fixture构建前启动服务器却未注册失败清理，测试挂起。补新write-only getter mock、确保setup失败清理、保留新adm-zip更早的重复条目拒绝，相关46/46自然退出。
- full Windows第二轮：1694/1692/1fail/1skip；私有Electron上下文测试的证据文件覆盖rename EPERM。观察器和上下文销毁拒绝已通过。只改test为不可变阶段快照、确切PID通知和快照SHA，原退出码/时限保留；过渡ack方案第5轮仍失败的原记录也保留。最终专项10×8通过、最终full1694/1693/0/1。
- 独立审查确认FRP两文件清除第二提交失败部分写入：已修有界失败回滚与外部更新保护，组合6项+独立重放5项通过。不是掉电/崩溃跨文件原子性证明。
- Windows第一次打包停于重复下载Electron网络步骤；同一原始44.3.0安装runtime经实际运行和文件绑定后供给electronDist完成打包。ZIP初次因新增licenses/source目录被当文件读取EISDIR；递归包含文件并拒绝链接后实际两ZIP核查通过，没有漏供源材料。
- Windows初次原APP smoke未观察真实默认context便evaluate而失败（原CDP详细错误未保留，不将推断当已证明原因）；改为实际frame/context绑定后成品启动通过。
- 一次DPAPI测试错误使用打包EXE传外部脚本，该脚本未按预期执行并超时，无DPAPI receipt；不认定该次隔离或安全存储通过。替代测试仅用freshAPPDATA和原始同版本runtime，产品vault两进程真实DPAPI通过，分类不扩大为成品或真实账户验证。未收集或发布玩家账户内容。
- Mac第一新run38437160585漏bridge预备编译而build失败；run38438892183明确编译当前bridge后全部本批scope通过，保留旧run日志。
- UI早期离屏host白底使暗色shell失真，改用明确的合成中性底色，只用于控件可读性；不将其用于原生DWM/vibrancy评分。独立发现Esc、旧完成event及焦点/列表失败处理均修测后复评。
- 旧Mac整机Cmd-minus keyUp/GLFW/NSGL/可辨认现代游戏画面及原始帧时间问题保持未放行；本版专项、夹具、源码同源及世界保存日志不能替代完整游戏、动效、物理macOS13和人工听感验收。

原始完整失败输出保留在本机独立测试目录及对应GitHub jobs。此公共记录只给去私有定位和结果，原始账号/设备码/凭据/私有profile不纳入源码或交接。
