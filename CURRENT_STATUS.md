# CURRENT STATUS — KAMUCL 1.1.22

状态时间：2026-10-14 02:04 Asia/Hong_Kong。产品日志采用本地分钟精度日期。仅 Windows x64、Mac ARM64；版本及根锁文件为1.1.22，运行时44.3.0。保留用户图片、收藏、设置、历史计数、旧实例及无关未提交文件；不操作wuhui、不强推、不结束他人的游戏。

- Project: KAMUCL
- Version or revision: 1.1.22；Windows 应用实施源码 eacc2a4e43b3f32bd5699bd89db58f30384cb77a，Mac 原生构建源码 48f2161292850fcf5c6ecdcc41a2517b766796e9，最终 master 由交付记录及标签绑定。
- Status timestamp: 2026-10-14 02:04 Asia/Hong_Kong
- Build command: npm run build；Windows electron-builder --win portable --x64 --publish never --config.electronDist=node_modules/electron/dist 与 node scripts/pack-windows-zip.cjs；Mac node scripts/build-bridge.cjs 后 npm run build、node scripts/pack-mac.mjs arm64 --package-only。
- Build result: 已记录的 Windows 生产构建及 Mac ARM64 原生构建通过；仅本批修改专项，不表示完整真实 Microsoft 游戏链或所有场景验收通过。
- Test/validation commands: npm test；npx tsc --noEmit；npm run license:check；交接便携命令 ["node", "source/scripts/check-licenses.cjs"]；原生成品专项命令及证据见 docs/validation-1.1.22/。
- Validation results: Windows 全套 1694 项中 1693 通过、0 失败、1 平台跳过；Mac 原生全套 1694 项中 1689 通过、0 失败、5 平台跳过；其他专项及独立评分见下文，真实未覆盖项单列。
- Finished artifact: 下表六件平台及运行时供源附件；源码 ZIP、交接包及其最终公开核对另由交付记录绑定。
- Artifact SHA256: 下表逐件列出的完整 SHA256；源码 ZIP 与交接包的外部摘要记录于 DELIVERY-1.1.22.json 和 SHA256SUMS.txt。

## Last verified state（对应源码与成品）

Windows应用实施源码 eacc2a4e43b3f32bd5699bd89db58f30384cb77a；实际构建发生在56a761b5 checkout加当时未提交的实施，后提交eacc。源码关联属于事后 Git 和成品字节核对，没有伪造构建前快照。Mac原生构建来自48f2161292850fcf5c6ecdcc41a2517b766796e9，run38438892183，macOS26 ARM64。两提交之间只改打包/QA/工作流/审计文档，src、锁文件、主题和素材未变。最终master及其后QA/文档差异由交付记录和标签绑定。

Windows原ASAR SHA256：5da49ae0aa8b28c3a6d3d24ef6f74050d356fe32a0a0460c95286aba4c7a3ea4。
Mac原ASAR SHA256：de91b0de96031c8fc2e9013919fadf49b0e46dfdd6e53169c946b8ddc7ce3491。

## Completed（已记录的验证与构建）

- Windows最终全套：1694项，1693通过、0失败、1平台跳过；类型、许可和生产构建通过。两轮先前失败及文件竞争的原始记录保留。
- Mac原生全套：1694项，1689通过、0失败、5平台跳过。原ZIP和挂载DMG的架构、签名、source/runtime identity、完整notices、原APP启动及成品renderer三矩阵各16通过；原生Keychain独立两进程夹具通过。
- Windows便携包真实冷/暖启动、中文和空格路径通过；最终EXE、两种ZIP ASAR与材料字节匹配。原始同版本runtime的DPAPI+产品vault重启夹具通过，明确不是打包EXE中真实账户登录验收。
- 界面独立评分：合理性9.1、功能性9.0、外观8.8，仅覆盖本批修改UI；后端独立评分9.2/9.0，外观不适用。Mac独立图证评分为合理性9.2、功能性9.0、外观9.0，仅限本批修改，未以Windows评分推断。
- 构建命令：npm run build；electron-builder --win portable --x64 --publish never --config.electronDist=node_modules/electron/dist；node scripts/pack-windows-zip.cjs。Mac先node scripts/build-bridge.cjs，再npm run build、node scripts/pack-mac.mjs arm64 --package-only。
- 运输验证记录命令：["node", "source/scripts/check-licenses.cjs"]。源码与交接包由精确Git树、SOURCE-MANIFEST、_handoff成员清单及外部SHA绑定。

## 已验证平台及供源附件

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| KAMUCL-1.1.22.exe | 99124081 | 9ae86b2944c3f88ac0e59178398192b161503f9ba7700a34ed9bff0af7687ec7 |
| KAMUCL-1.1.22-windows-x64.zip | 100972803 | 4b7e80621f51490131aacd5b53acf0a6c0f6c6edf55887be3dbe559c7caed8d8 |
| KAMUCL-1.1.22-windows-x64-unpacked.zip | 144860079 | bfbc9bcb34ab80813d05b8fdea63f6eade0d8f0a2432267119ed59eaf827b0a9 |
| KAMUCL-1.1.22-runtime-source.zip | 38905320 | af40243e21439aa77af20319c00fbb8d83f76975e88d6cd2249d15ff73d8ebe3 |
| KAMUCL-1.1.22-mac-arm64.zip | 129893677 | 7d30bd37527df961e71415af7c648b6c30aef9b9265df7ac3a5fdf6b43cb7f5a |
| KAMUCL-1.1.22-mac-arm64.dmg | 141299910 | f240034586197a70018d281d3e3b57376dafb1e69239faae1552a661fb1d0f15 |

源码 ZIP 与交接包外部摘要由 DELIVERY-1.1.22.json 和 SHA256SUMS.txt 绑定，避免自包含文档的循环哈希。交接包顶层状态文档在包装时附加源码 ZIP 传输摘要；source/ 文档仍保持原始 Git blob 字节。

## Remaining（后续交付与验证）

最终源码与交接包仍需绑定最终 master，完成精确成员、干净解压、校验和及记录命令复验；提交同步、标签、公开 Release 与全部附件的全字节下载核对在完成后另行记录。真实完整 Microsoft 登录与游戏启动等尚未覆盖的项目见下文，不能用包装成功替代功能验收。

## Known issues and risks（已完成内容及真实限制）

自有 Client ID 06cc8cf6-4b8f-4631-8459-b2bd828808f8 不被旧配置覆盖；旧账号不跨身份刷新，取消/替换/失败保留原数据。CF/FRP秘密使用系统安全存储，界面write-only，FRP两文件清除失败回滚及外部更改保护经独立复验。五类审计、原始许可、插件完整源码及固定Electron/FFmpeg源码附件均提供。

初始401、旧代理轮询失败、修复后设备码过期保留；真实完整Microsoft游戏链仍未验证。首个Mac run38437160585因桥接构建预备缺失失败，新流程明确编译后通过，旧失败不删除。旧Mac完整游戏图形/Cmd-minus keyUp及原始帧时间问题没有通过本版专项替代。素材授权缺证据、剩余14个npm受影响包条目（3high/11moderate）、没有全Chromium源码/字节重编译证明、签名公证/物理macOS13/人工听感和全场景动效保持单列。

原始 writing-block.md 保持只读；pelican-bicycle.html SHA256 95ac95cb9e3d18d997703fa33d4c3fff46ed1cc576406b5d0d6b098d17db0672 且未纳入源码。公开发布、最终标签及全部附件全字节下载核对在完成后另行记录，不将本地成品当作已公开成功。

## Recommended next action（建议下一步）

冻结最终 master 后，先生成并核对源码 ZIP，再由未修改的交接技能包装六件平台附件及源码 ZIP，复验单独运输副本和记录命令。按独立历史同步 master/main 并完成公开发布核对；交互授权、真实完整游戏链及其他未覆盖项继续保留为明确限制。
