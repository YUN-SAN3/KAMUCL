# KAMUCL 1.1.18 — Windows x64

2026-10-07 14:54（香港时间）

- 自动Java按可信游戏要求及MOD/loader约束选择，旧版不再因只有Java21而误用。
- 默认材质包首次初始化后保留游戏内启用、关闭与排序；默认配置可为指定实例重新应用。
- 离线账号可应用64×64 PNG、绘制、历史恢复与重置，支持Classic/Slim，下次启动在自己的本机显示。首次校验下载authlib-injector，缓存后可离线；其他玩家显示由服务器决定。
- 社区已有必要前置检测及确认下载；本版补修精确前置被其他已装版本静默替代，冲突停止并保留旧文件。

附件为Windows便携EXE、紧凑ZIP、展开ZIP、源码、交接包、SHA256SUMS.txt。用户数据和旧实例保留；本批没有Mac，优化仍暂停。

1343项回归中1342通过、0失败、1Linux专属跳过；类型/许可/构建/完整包/四主题真实UI通过。最终EXE在原生26.3/Fabric演示世界正确显示离线皮肤，GPU PNG哈希一致，正常保存退出，关闭材质包后再启动保持关闭。

四JVM/认证库探针不冒称四版本完整游戏。社区事务用合成文件配合生产管线；用户原实例、旧Forge完整游戏、全部组合、两真实服务完整MOD游戏安装、多人显示、完整动效和人工听感未覆盖。Windows未签名。查看[验证范围](https://github.com/kamubaba-i/KAMUCL/blob/v1.1.18/docs/validation-1.1.18/README.md)与[独立评审](https://github.com/kamubaba-i/KAMUCL/blob/v1.1.18/docs/validation-1.1.18/INDEPENDENT_REVIEW.md)。

非实现者独立评分均≥8.5，最低外观8.6。蓝白主题窄窗待应用模型标签对比偏弱已记录，不影响主要操作，不宣称零缺陷。
