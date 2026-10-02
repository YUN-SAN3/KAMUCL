# KAMUCL 1.1.6 功能与验证入口

本批基于 1.1.5。默认配置兼容旧文件，新增启动前内存整理和收藏模组安装均默认关闭。

## 使用入口

- 皮肤 → 绘制皮肤：新建、导入 64×64 / 64×32 PNG、读取当前皮肤；经典/纤细、基础/外层、明确分开的绘制/旋转、各面视角、部位显隐、色板、撤销/重做、另存为及微软正版账号上传。退出或关闭窗口会处理未保存编辑。
- 资源管理 → 投影：扫描全部绑定目录及隔离实例，集中收藏、导入、导出、分发、拖出、定位和回收站。转换先分析差异，必须逐项确认后生成独立副本；重新读取并比较方块状态、坐标和带类型的实体数据，原文件保持不变。
- 模组列表/社区详情 → 收藏；游戏安装 → 同时安装收藏模组。按来源平台与项目记录，未知本地文件可先收藏再关联。安装时重新校验具体文件及必要前置，失败记录可重试或选择保留基础实例。
- 联机 → VoxLink → 我的工单：列表、未读、提交、追问、附件、撤回、软删除。仅点击提交或发送时上传附件；secret 通过系统凭证保护保存在主进程，不传给页面。
- 左上头像 → 七人互动舞台：q3、qiqi、碧月狐、红叔、卡慕、米洛、幕川北。完整着装、无披风、无音效；鼠标进入命中区一次触发，点击/键盘等价，计数本地保存、同分稳定排序。关闭及隐藏暂停动效，重置需确认。
- 设置 → 游戏设置 → 运行环境：Windows 手动内存整理、启动前整理开关和实际结果。依据 Windows EmptyWorkingSet 独立实现，跳过系统、Java 和已知游戏进程。Mac 显示不适用，继续提供内存信息与分配。

## 投影转换边界

格式：Litematic v6、Sponge v1/v2 导入与 v3 输出、旧 Alpha schematic、原版结构 NBT。
旧 schematic 只承诺格式导入；不能确认现代源版本时不提供跨版本转换。
现代目标注册表包括 1.20.x、1.21.x、26.1、26.2、26.3 已收录正式版。
26.2/26.3 的实际方块属性来自官方 server data generator，版本与来源摘要见
`src/main/core/projectionOfficialSchemas.json`；其余来源及生成脚本见第三方来源记录。

方块存在且属性合法才能保留；不存在的方块或属性要求用户选替代/舍弃。
没有验证过的跨版本实体/方块实体 NBT 迁移必须明确舍弃，不伪装成无损迁移。
附加标签在同格式复制时保留，跨格式/版本语义未验证时列入差异。
单区域格式合并区域需确认，重叠区域拒绝合并。原版结构放置偏移以
KAMUCLOffset 扩展保留，游戏忽略该扩展的事实会在转换前提示。
多候选原版调色板、未验证的实体包装和不一致坐标会明确报不支持。
压缩文件上限 64 MB、解压 NBT 128 MB、标签 200 万、方块 1600 万；原版结构输出另限制 18 万方块。
任务在线程内执行并可取消，内存和时限有界，取消保留原文件。

## 检查与证据

`npm test`、`npx tsc --noEmit`、`npm run license:check`、`npm run build`。
专项代码位于 `tests/extension-features.test.ts`、`tests/voxlink-116.test.ts`，
上游逐值常量测试使用固定提交的 Java fixture。
`scripts/verify-extension-ui.cjs` 在隔离 Electron 进程内检查新功能，
由 `scripts/verify-ui-refinement.cjs` 调用；测试数据及模拟 IPC 不写入正式产品代码。
`scripts/verify-skin-surfaces-ui.cjs` 补验两种模型的手臂、身体、腿部 UV，
以及编辑器在最小窗口和缩放后的滚动布局。
上传与工单 GUI 成功/失败测试使用隔离模拟账号和服务，并非真实账号上传成功的证据。

Windows：`scripts/verify-windows-package.cjs` 核对 EXE、中文路径 ZIP 解压、冷/热启动和完整运行包。
Mac：`.github/workflows/mac-build.yml` 在原生 ARM/Intel runner 上构建、签名、挂载 DMG、启动 APP，
运行新功能 GUI 和实际 Minecraft 检查。验证输出随 CI artifacts 保留。
Mac 使用 ad-hoc 签名；没有 Apple Developer ID 签名或公证。

本次结果：560 项测试通过；Windows 深色、浅色、自定义主题的全页面 GUI 回归通过，
两种原生 Mac 架构的 APP / DMG、公共功能、实际 Minecraft 26.2 和正常保存退出通过。
最终 Mac 运行：`36900960198`，代码 `d5f93ee`；后续提交仅包含交付文档及验证入口。
Windows 成品和源码干净构建证据见 `docs/validation-1.1.6/windows.json`。

没有覆盖全部投影 MOD 的游戏内加载、所有 26.x 后续版本、真实收藏项目的全部依赖组合、
Windows 启动前整理的真实游戏全过程、每种受保护进程和所有平台的新功能窄窗口组合。
这些项目不描述为已通过；未验证的投影数据迁移会在产品中明确提示或拒绝。

实际上游标准/旧 TURN 已在临时私有房间完成 5000 字节传输和哈希校验，随后释放中继并退出房间。
证据见 docs/validation-1.1.6/voxlink-live.json，命令为 node scripts/verify-voxlink-live.cjs --live。
公网对称 NAT、跨 Java 客户端、真实微软皮肤上传及真实工单附件提交仍需参与者验证。
回环 UDP/WebSocket、模拟 API 及 GUI 检查与这些真实网络验收分别记录，不互相替代。
