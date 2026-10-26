# START HERE — KAMUCL 1.1.23

本版优化社区中文 MOD 检索：支持部分名称、相关改版与附属、快结果和受控续查；保留精确来源身份、版本／加载器筛选及返回页面的结果。仅 Windows x64、Mac ARM64，Electron 44.3.0 保持；资源占用优化仍撤回。

- Project: KAMUCL
- Deliverable: 1.1.23 Windows x64、Mac ARM64 已验收成品、对应源码和交接材料；通过范围为本次社区检索修改，不代表完整游戏或未修改功能全部验收。
- Packaged artifact: release/ 下的 KAMUCL-1.1.23.exe、KAMUCL-1.1.23-windows-x64.zip、KAMUCL-1.1.23-windows-x64-unpacked.zip、KAMUCL-1.1.23-mac-arm64.zip、KAMUCL-1.1.23-mac-arm64.dmg、KAMUCL-1.1.23-runtime-source.zip；源码和交接 ZIP 由最终 Git 树另行精确包装，不扫描混入旧版。
- Intended receiver: KAMUCL 使用者、接手开发者及独立核验人员。
- Operating system: Windows x64；Mac ARM64 最低 macOS13，实际原生 CI 环境 macOS26.6.2；不新增 Intel Mac、Linux 或鸿蒙成品。
- Runtime/tool versions: Electron 44.3.0、Node24、npm、完整 JDK17+；Windows 生产构建使用 JDK21.0.12，Mac 原生构建使用 JDK17。

## Prerequisites（运行与构建前提）

开发需要 Node24、npm 和完整 JDK17+（javac 与 jar）；Windows 辅助程序需要 .NET C# 编译器，Mac 构建需要 Xcode 工具。真实社区服务依赖 Modrinth、CurseForge／现有镜像和 MC百科可用；网络失败与未核对候选明确展示，不能当作没有匹配。接收者自行提供账户或服务密钥，交付不包含玩家登录状态、私钥及测试配置。

## Use the deliverable（使用成品）

先核对最终 SHA256SUMS.txt 及 CURRENT_STATUS.md 的逐件摘要。运行 KAMUCL-1.1.23.exe，或解压 windows-x64.zip 运行同名 EXE；展开 ZIP 的入口是 KAMUCL.exe。Mac 使用已验收 ARM64 DMG／ZIP 内的 KAMUCL.app。Mac 只有 ad-hoc 签名，无 Developer ID 或公证；Windows 无发行者签名。

社区资源选择 MOD，输入“无尽”“机械”等中文片段即可检索。既有筛选保持有效；“已确认 N 项”只统计已核验集合，剩余候选可继续补充。暂停／离开页面保留结果，返回继续使用新请求，不复用旧 cursor。零结果不通过换项目或悄悄放宽版本来补足。

Microsoft 应用仍为 KAMUCL 自有 ID，旧账号必须重新授权。最近一次真实验证已通过 Microsoft、Xbox、XSTS，随后 Minecraft 返回 403／APPLICATION_REJECTED；没有账户落盘，未验证刷新或正版游戏启动。授权页成功不等于 Minecraft 应用许可已通过，也不会借用其他启动器身份回退。

## Setup（开发环境与构建）

源码 ZIP 根目录执行 npm ci、node scripts/build-bridge.cjs、npm test、npx tsc --noEmit、npm run license:check、npm run build。原生平台打包命令与源码关联见 CURRENT_STATUS.md。依赖下载和实际接口需要可用网络，夹具与真实服务分开记录。

## Verify（交接与便携验证）

交接包精确 Git 源码在 source/，已测试成品在 _handoff/artifacts/。在交接顶层执行记录的便携命令：

```json
["node", "source/scripts/check-licenses.cjs"]
```

源码 ZIP 根目录对应命令为 node scripts/check-licenses.cjs。该命令核查许可、供源与来源记录，失败返回非零；不能替代功能、坐标、原生启动和真实服务测试。创建及单独运输副本都用未修改的 package-codex-project-handoff 工具核对完整成员、SHA256，并执行同一命令。

## 证据范围

实现及来源见 docs/COMMUNITY_SEARCH_1.1.23.md，最终公开证据在 docs/validation-1.1.23/。Windows 原成品与 Mac 原 ZIP、挂载 DMG 的真实坐标、生产 IPC、严格项目／文件元数据均通过；每个原成品的 ASAR 分别验证四主题、两视口、两缩放的16组矩阵、每组16项状态。两平台修改范围各自独立评分9.2／9.0／8.9，无关键缺陷，不将一平台结果推断到另一平台。

1.1.22 五份审计、原始许可、供源说明和历史失败继续保留。原始 MD、玩家账号、密钥、整合包、存档、运行目录及 pelican-bicycle.html 不交付；不操作 wuhui。目标 MOD 详情／文件清单核对，以及独立的小文件完整网络哈希检查，不代表安装事务、实例已落盘或游戏启动。

旧 Mac GLFW／NSGL、键盘和原始帧时间失败、物理 macOS13、人工音效听感、全场景 FPS、签名公证、剩余素材授权及依赖公告单列，不能用本次检索专项或包装成功代替完整验收。
