# START HERE — KAMUCL 1.1.22

本版切换 KAMUCL 自有 Microsoft 应用，保留旧账号并要求重新授权，修复代理、取消及迟到事件，整改用户服务密钥保存和分发许可材料。首条内置更新日志及 Release 使用批准的公开致歉。仅交付 Windows x64 和 Mac ARM64，Electron 44.3.0 保持；资源占用优化仍撤回。

## 使用成品

先核对 SHA256SUMS.txt。Windows 运行 KAMUCL-1.1.22.exe，或解压 windows-x64.zip 后运行同名 EXE；展开 ZIP 的入口是 KAMUCL.exe。Mac 使用 ARM64 DMG 或 ZIP 的 KAMUCL.app，最低 macOS13。Mac 只有 ad-hoc 签名，无 Developer ID 或公证；Windows 无发行者签名。

旧微软账号重新登录，浏览器授权页应显示 KAMUCL。不要把旧刷新令牌提交给其他应用。应用保留离线及外置 Yggdrasil 登录。正常玩家应使用自己的账户和游戏目录，不共享登录配置。

## 开发与验证

安装 Node24、npm 和完整 JDK17+（javac 与 jar）；Windows 生产构建使用 JDK21.0.12，Mac 原生使用 JDK17。Windows 原生辅助程序需要 .NET C# 编译器，Mac 构建需要 Xcode 工具。源码 ZIP 在根目录运行 npm ci、node scripts/build-bridge.cjs、npm test、npx tsc --noEmit、npm run license:check、npm run build。原生平台打包命令与证据见 CURRENT_STATUS.md。

交接包将精确 Git 源码放在 source/，成品在 _handoff/artifacts/。在交接包顶层执行记录的便携验证命令：

```json
["node", "source/scripts/check-licenses.cjs"]
```

源码 ZIP 根目录对应命令是 node scripts/check-licenses.cjs。该命令核查锁文件、完整许可与供源材料，不能替代已记录的全套功能测试。交接创建及运输副本用原版 package-codex-project-handoff 进行完整成员、SHA 和上述命令复验。

## 证据范围

五份审计报告在 audit-reports/。docs/validation-1.1.22/ 包含最终测试、原生启动、独立评审和对应来源。Linux、Intel Mac、鸿蒙不新增成品。原始 MD、玩家账户、私钥、游戏整合包、存档、运行目录和 pelican-bicycle.html 不进入交付。

真实设备码请求及授权页名称已观察；完整 Xbox/XSTS/Minecraft 登录、重启续期和正版游戏启动仍待交互验证。Mac 旧整机游戏图形及键盘验收失败保留，本版修改专项通过不表示全平台所有功能/外观/动效完全一致。实际听感、全场景 FPS、物理 macOS13、剩余素材授权与依赖公告不推断通过。
