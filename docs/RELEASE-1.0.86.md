# KAMUCL 1.0.86

2026-09-17 18:42（本地时间）

- 资源管理新增“录像”：汇总已登记游戏目录与实例中的 ReplayMod / Flashback 录像，提供搜索、格式和位置筛选、分页、多选、定位文件。
- 集中收藏位于启动器数据目录的 recordings 文件夹。支持手动导入、批量收集、提取到指定文件夹及复制到指定实例。保留源文件，同名自动编号；只处理已保存的 .mcpr / Flashback .zip，不转换成视频。自定义录像位置可手动导入。
- 文件传输流式校验源文件变化与 SHA256，后台任务支持取消。向实例写入及删除录像前检查游戏占用；删除进入系统回收站。普通 ZIP 或不完整录像不会作为有效录像导入。
- 联机入口移到左侧一级菜单，保留原有各联机方式与状态。
- 游戏安装弹窗新增“不安装 / ReplayMod / Flashback”选项，并提供匹配游戏版本和加载器的模组版本列表，标明版本类型与发布时间，支持选择旧版。列表错误可重试；不兼容或无版本时不能继续带模组安装。
- 主进程再次校验指定项目和精确文件 ID，并解析兼容必要前置；冲突明确报错，下载校验后才提交。选择录像模组会创建独立实例，避免影响其他实例。Fabric API 作为必要前置时，即使关闭独立的 API 可选开关仍会安装，界面有必要前置说明。
- 加载器尚未返回版本时，自动实例名不再出现非法问号。

验证：482 项测试、TypeScript 检查、许可检查与生产构建通过；新增录像页、录像模组选择器和游戏安装页的 Vue 类型检查通过。额外全项目 Vue 检查仍报告旧页面既有类型问题，本批未将其宣称为全量通过。

Windows 正式程序使用独立配置验证菜单层级、录像收集、同名保护、提取、跨实例复制、回收站、原文件保留和窄窗口布局。安装弹窗通过真实兼容列表验证指定版本传参；主进程真实下载并校验 Flashback 0.39.8、其 Fabric API 前置，以及 ReplayMod 1.21-2.6.23；选择的文件 ID 和下载哈希完全一致。没有修改用户实例或停止正在运行的游戏。

格式与目录依据：[ReplayMod 官方说明](https://www.replaymod.com/docs/)、[Flashback 数据目录](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/Flashback.java)、[Flashback 录像归档](https://github.com/Moulberry/Flashback/blob/master/src/main/java/com/moulberry/flashback/record/ReplayExporter.java)。实现独立编写，未复制第三方项目代码。

便携 EXE / ZIP 启动、Mac APP / DMG 和 SHA256 验证结果由发布流程复核后补充到 GitHub Release。Mac 沿用临时签名，未进行 Apple 开发者签名与公证。
