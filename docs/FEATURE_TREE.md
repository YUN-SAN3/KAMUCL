# KAMUCL 功能树

本文档按“用户入口 → 可执行功能 → 主要实现模块”整理当前版本能力，方便查找代码和维护文档。

## 用户功能树

```text
KAMUCL
├─ 首页
│  ├─ 账号 / 角色概览
│  ├─ 实例卡片与收藏排序
│  ├─ 启动 Minecraft
│  ├─ 快速重启、结束游戏
│  ├─ 创建命令世界并启动
│  ├─ 启动图、背景、缩略图
│  ├─ 后台下载任务与更新日志
│  └─ 启动失败提示与日志导出
│
├─ 游戏版本
│  ├─ 版本清单：正式版 / 快照 / 旧版
│  ├─ 搜索、筛选、刷新
│  ├─ 安装加载器：Fabric / Forge / NeoForge / Quilt
│  ├─ Fabric API 选择
│  ├─ 实例新建、删除、重命名
│  ├─ 共享 / 隔离游戏目录
│  ├─ 实例图标、缩略图、窗口分辨率
│  ├─ Java 路径与自动匹配
│  └─ 游戏文件夹扫描、迁移与冲突预览
│
├─ 账号
│  ├─ 微软 Device Code 登录
│  ├─ 离线账号
│  ├─ Yggdrasil 外置认证
│  │  ├─ 提供商探测、保存、删除
│  │  ├─ JSON / TXT / URL / 拖拽导入
│  │  └─ 多角色选择
│  ├─ 账号选择、刷新、移除
│  └─ 凭据安全存储
│
├─ 皮肤
│  ├─ 3D 角色预览
│  ├─ 皮肤上传与模型类型
│  ├─ 披风切换
│  └─ 皮肤历史与缓存
│
├─ 社区资源
│  ├─ Modrinth / CurseForge
│  ├─ Mod / 整合包 / 资源包 / 光影包 / 数据包
│  ├─ Minecraft 版本、加载器、排序筛选
│  ├─ 文件版本与前置依赖解析
│  └─ 下载、校验、安装确认与失败回滚
│
├─ 资源管理
│  ├─ 模组：列表、搜索、拖入、元数据、重复检测
│  │  ├─ 实例内 / 跨实例重复清理
│  │  ├─ Modrinth 哈希更新检查
│  │  └─ 更新预览、依赖解析、事务回滚
│  ├─ 资源包
│  ├─ 光影包
│  ├─ 默认配置 / 按键配置
│  ├─ MOD 面板（KAMUCL Bridge）
│  │  ├─ 安装内置 Fabric Bridge MOD
│  │  ├─ 读取参数清单
│  │  ├─ 即时修改 / 恢复默认
│  │  └─ MOD、分组、关键词筛选
│  ├─ 服务器：添加、编辑、删除、搜索、延迟检测
│  │  ├─ 实例绑定
│  │  ├─ 从 servers.dat 同步
│  │  └─ 启动并连接
│  └─ 联机
│     ├─ FRP
│     ├─ VoxLink
│     ├─ Terracotta
│     └─ 好友直连：IPv6 / IPv4 / UPnP / 邀请
│
└─ 设置
   ├─ 主题、颜色、背景与启动图轮播
   ├─ 默认 Java、分辨率、窗口模式
   ├─ 启动后行为与功能开关
   ├─ Java 自动扫描、手动添加、隐藏
   ├─ 实例管理中心：复制、备份、恢复与运行诊断
   ├─ 插件安装、启用 / 禁用、移除
   ├─ 更新检查、下载、应用与回滚
   └─ 诊断、日志、本地更新包
```

## 主要实现模块

```text
启动与窗口
├─ src/main/index.ts             Electron 生命周期、窗口、协议
├─ src/main/ipc.ts               IPC 注册与输入校验
├─ src/main/core/launch.ts       Java / Minecraft 启动、结束、重启
├─ src/main/core/launchPreparation.ts 启动前资源准备与完整性检查
├─ src/main/core/gameSession.ts  运行会话与进程状态
└─ src/main/core/gameWindow.ts   游戏窗口辅助

版本与下载
├─ src/main/core/versions.ts     版本清单、继承链、实例安装
├─ src/main/core/loaders.ts      各类加载器与 Fabric API
├─ src/main/core/instances.ts    实例目录与隔离迁移
├─ src/main/core/instanceCenter.ts 实例复制、备份、恢复与诊断
├─ src/main/core/backupStore.ts 备份存储与事务恢复
├─ src/main/core/gameFolders.ts  游戏文件夹扫描与管理
├─ src/main/core/download.ts     下载、校验、断点与并发
└─ src/main/core/tasks.ts        后台任务暂停、继续、取消

账号与外观
├─ src/main/core/accounts.ts     微软、离线账号和安全存储
├─ src/main/core/yggdrasil.ts    外置认证流程
├─ src/main/core/yggdrasilProvider.ts  提供商探测与配置
├─ src/main/core/skins.ts        皮肤、披风、头像缓存
└─ src/main/core/appearanceAssets.ts   背景、图标、缩略图

资源与联机
├─ src/main/core/community.ts    Modrinth / CurseForge
├─ src/main/core/communityPaging.ts 社区资源分页与缓存
├─ src/main/core/modinfo.ts      JAR 元数据与兼容性
├─ src/main/core/modpacks.ts     整合包探测与安装
├─ src/main/core/modUpdates.ts   模组更新
├─ src/main/core/modManagement.ts 模组启用、禁用、锁定与版本管理
├─ src/main/core/resourceFiles.ts 资源包、光影包、数据包管理
├─ src/main/core/worlds.ts       世界导入
├─ src/main/core/servers.ts      服务器记录与同步
├─ src/main/core/directConnect.ts 好友直连与网络诊断
├─ src/main/core/frp.ts          FRP
├─ src/main/core/voxlink/        VoxLink
├─ src/main/core/terracotta.ts   Terracotta
├─ src/main/core/modBridge.ts    启动器侧 Bridge 客户端
└─ bridge/src/                   Fabric Bridge MOD 与本机 HTTP 服务

设置与维护
├─ src/main/core/settings.ts     设置、主题、功能开关
├─ src/main/core/plugins.ts      插件加载与管理
├─ src/main/core/selfUpdate.ts   更新检查与下载
├─ src/main/core/applyUpdate.ts  更新应用、备份、回滚
├─ src/main/core/diagnostics.ts  启动诊断
└─ src/main/core/diagnosticArchive.ts 日志归档
```

## 现有文档索引

| 文档 | 主题 |
| --- | --- |
| [`features/friend-direct-connect.md`](features/friend-direct-connect.md) | 好友直连流程、网络边界、邀请格式 |
| [`auth/yggdrasil-provider-card.md`](auth/yggdrasil-provider-card.md) | Yggdrasil 导入格式与安全规则 |
| [`connection-ui-0.6.17.md`](connection-ui-0.6.17.md) | 联机与服务器页面设计 |
| [`diagnostics/launcher-auto-exit-and-modpack-crash.md`](diagnostics/launcher-auto-exit-and-modpack-crash.md) | 启动器与整合包问题诊断 |
| [`releases/`](releases/) | 历史版本发布与验收记录 |
| [`../FEATURE_AUDIT.md`](../FEATURE_AUDIT.md) | 功能审计记录 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Commit 与 Pull Request 提交规范 |
| [`CORRESPONDING_SOURCE.md`](CORRESPONDING_SOURCE.md) | 发布包对应源码与重建步骤 |
| [`VOXLINK-UPSTREAM.md`](VOXLINK-UPSTREAM.md) | VoxLink 协议来源、同步范围与验证边界 |
| [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | 第三方依赖许可证与对应源码 |

## 维护规则

- 新增页面或用户入口时，先更新“用户功能树”。
- 新增核心能力时，在“主要实现模块”补充文件位置。
- 协议、网络和安全边界单独放在 `docs/auth/` 或 `docs/features/`。
- 一次性排错、版本验收放在 `docs/diagnostics/` 或 `docs/releases/`。
- 功能树只描述当前已实现能力；实验功能和待办事项需明确标注状态。
