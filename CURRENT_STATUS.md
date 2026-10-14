# CURRENT STATUS — KAMUCL 1.1.23

状态时间：2026-10-14 10:35 Asia/Hong_Kong。日志使用本地分钟精度日期。仅 Windows x64、Mac ARM64；版本与根锁文件1.1.23，运行时44.3.0。保留图片、收藏、设置、历史计数、旧实例与无关未提交文件；不操作 wuhui、不强推、不结束他人的游戏。

- Project: KAMUCL
- Version or revision: 1.1.23；Windows 构建源码 eac26dce109add58103106c73352353b6be7f97a；Mac 第二次原生任务源码 72237f0b9cdf5910276a0fa1cbb91fc9b1a1e990；最终 master 由交付记录与标签绑定。
- Status timestamp: 2026-10-14 10:35 Asia/Hong_Kong
- Build command: npm run build；Windows electron-builder --win portable --x64 --publish never --config.electronDist=node_modules/electron/dist、node scripts/pack-windows-zip.cjs；Mac 先 node scripts/build-bridge.cjs，再 npm run build、node scripts/pack-mac.mjs arm64 --package-only。
- Build result: Windows 冻结源码生产构建和便携验证通过；Mac 最终 run38469671596 原生构建、原 ZIP／挂载 DMG 启动及本次社区检索专项通过。
- Test/validation commands: npm test；npx tsc --noEmit；npm run license:check；运输命令 ["node", "source/scripts/check-licenses.cjs"]；搜索、坐标和原生成品专项单独记录。
- Validation results: Windows 1737项，1736通过、0失败、1平台跳过；相关专项64／64。Mac 实际日志1737项，1732通过、0失败、0取消、5平台跳过。Windows 原 ASAR 16组矩阵各16项状态／160张PNG；Mac 原 ZIP与DMG各16组、各160张PNG及各2张原生截图通过。
- Finished artifact: 下表六件已核对的平台／固定运行时附件；源码 ZIP 与交接包由最终 master 精确包装并由外部交付记录绑定。
- Artifact SHA256: 下表为六件成品的完整 SHA256；源码与交接外部摘要由 DELIVERY-1.1.23.json、SHA256SUMS.txt 绑定，避免循环哈希。

## Last verified state（对应源码与成品）

Windows 来自 eac26dce109add58103106c73352353b6be7f97a，构建前保存准确提交、无 tracked 修改与时间（out/production123-prebuild-source.json，capturedBeforeBuild=true），不是事后补造预构建记录。

Mac 第二次 run38469671596 来自 72237f0b9cdf5910276a0fa1cbb91fc9b1a1e990，已成功完成。与 Windows 构建提交相比仅五处文档／QA变化；保护的 src、package／锁文件、许可和资源构建输入完全相同 Git blob。原 ZIP 和挂载 DMG 分别通过原生启动、坐标矩阵、真实服务与独立评分。最终 master 的后续文档／QA差异单独记录，不重写实际构建来源。实际原生系统 macOS26.6.2 ARM64，最低声明macOS13尚无实机证明。

Windows 原 ASAR SHA256：565fce8c243dbb961bbbfb198c397785376e81efedfd5410623ad1d744091be9。

Mac 原 ASAR SHA256：3c82801a1afa2b754a884c43412bd7885d928648ad2e9c0ace666c96053511e8。

## Completed（已记录的验证与构建）

- Windows 全套1737项中1736通过、0失败、1跳过；类型、许可、生产构建通过，专项64／64。旧 fixture 编译较早源码和并发响应的失败／挂起记录保留，后续成功不删原失败。
- 原生成品独立空配置：真实坐标输入“无尽”及生产 IPC 返回112个已确认项目；两来源严格核对目标 source／projectId／slug、详情、文件列表和可靠哈希。这不是 MOD 安装或游戏启动。
- AppleSkin 完整网络载荷180194字节 SHA1／SHA256通过，按生产元数据进行的独立小文件检查，不计为启动器目标 MOD 安装事务。
- 原 ASAR 147个 renderer 文件绑定成品；四主题×两视口×两缩放16组矩阵，每组16项状态、160张原始PNG及可信点击／输入有记录。夹具与真实服务原生操作分开。
- Windows 冷暖启动、中文／空格路径及 ZIP 完整成员哈希通过（out/package123-windows-r2-verified.json，complete=true）。原始计时保留，不宣称本轮启动性能或资源优化。
- Windows 与 Mac 各自修改范围独立评分均为合理性9.2、功能性9.0、外观8.9，各0关键缺陷，未使用平均分或全平台推断。前端／IPC代码复核9.2／9.0，外观不评分且不为自写后端评分。
- Mac 原生全套1737项：1732通过、0失败、0取消、5跳过，取自实际 npm-test.log（公开副本 docs/validation-1.1.23/MAC_TESTS.log）。原 ZIP与挂载DMG各16×16状态／160张原始PNG、各2张原生截图、147个原renderer文件绑定通过。两个原包都验证四组严格来源／项目／slug的详情及文件清单，并各自通过一次AppleSkin完整字节哈希；目标无尽MOD未安装、游戏未启动。
- 原始打包命令及运输命令见本文件字段。精确 Git 树、SOURCE-MANIFEST、_handoff成员与外部 SHA256绑定；最终包和单独运输副本仍须完整复验。

## 已验证平台及供源附件

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| KAMUCL-1.1.23.exe | 99129603 | c086be159b557e9f88d0e9930277d513e67117ea1b1bece5bf82a3fd81c9d21f |
| KAMUCL-1.1.23-windows-x64.zip | 100978423 | 92f6c9aff2e9d03394925a1074fb23199b1f942b882f62dfbc176742be6bf27e |
| KAMUCL-1.1.23-windows-x64-unpacked.zip | 144867348 | c2d068b86aaaaf9aaabc00cc6211390ae4fff7835a1604869528a2f432740555 |
| KAMUCL-1.1.23-mac-arm64.zip | 129902007 | fdf51a02e61bdcace37f1c891a20d4a1b958b649ec3a0c1286bc73f995339a1e |
| KAMUCL-1.1.23-mac-arm64.dmg | 141317086 | f508554a9163e03290ca0d6f8f182d1c02b23858d38eb8392571d986b0db6458 |
| KAMUCL-1.1.23-runtime-source.zip | 38905320 | af40243e21439aa77af20319c00fbb8d83f76975e88d6cd2249d15ff73d8ebe3 |

六件文件均由本版最终 ledger 逐件核对精确字节与SHA256；Mac原包与CI供给一致，不沿用旧版成品哈希。runtime-source.zip 与1.1.22为同一运行时供源字节：之前解码并字节扫描14个外层文件，本轮仅核对精确同字节；内嵌tar／xz等压缩源文件未递归解码，不据此声明所有嵌套内容无秘密。

源码 ZIP 与交接外部摘要由 DELIVERY-1.1.23.json 和 SHA256SUMS.txt 绑定。交接顶层状态包装时附加源码 ZIP 运输摘要；source/ 文档保留原 Git blob 字节，避免自包含循环哈希。

## Remaining（后续交付与验证）

六件平台／供源成品与两平台本次修改验收已完成。最终 Git 源码 ZIP、交接包及单独运输副本的成员／摘要／记录命令复验，以及最终提交同步、标签、公开 Release和全部附件全字节下载核对，由本批外部交付记录在完成后确认；此刻不把本地已验收包写成公开发布成功。

## Known issues and risks（已完成内容及真实限制）

快结果、受控续查、独立来源身份、固定筛选与 confirmed 总数已实现。实际数量随源站变化，百科受限、缺来源链接和未核对候选明确显示，不能声称检索穷尽。本轮不改账号体系、安装事务或运行时，不恢复资源占用优化。

1.1.22自有 Client ID 06cc8cf6-4b8f-4631-8459-b2bd828808f8、旧账号重授权、CF／FRP安全存储、五份审计和供源材料保留。最近真实验证已通过 Microsoft、Xbox、XSTS，随后 Minecraft 返回403／APPLICATION_REJECTED；没有账户落盘，也未完成续期或正版游戏启动。这是已观察的 Minecraft 应用服务拒绝，不再只描述为全链未验证，不归因本次搜索修改，也不回退借用身份。

旧401、代理轮询失败、设备码过期及最新服务拒绝，Mac旧GLFW／NSGL、Cmd-minus keyUp与原始帧时间失败继续保留。Mac历史完整游戏／图形失败不能以本次检索专项代替。物理macOS13、人工听感、全场景FPS／桌面材质、完整安装与游戏启动仍未覆盖。

Mac为ad-hoc签名，无Developer ID或公证；Windows无发行者签名。素材授权缺证据、剩余依赖公告、未提供全Chromium源码／逐字节再构建证明等1.1.22限制单列，不宣称版权、依赖或全平台完全一致全部通过。

writing-block.md保持只读；pelican-bicycle.html SHA256 95ac95cb9e3d18d997703fa33d4c3fff46ed1cc576406b5d0d6b098d17db0672，不纳入源码。排除账号、令牌、密钥、用户整合包、存档、私有配置与运行目录，不读取现有玩家状态替代独立测试。

## Recommended next action（建议下一步）

冻结最终 master 后先生成源码 ZIP，再由原版交接技能显式包装本表六件平台／供源附件及源码 ZIP，复验运输副本和记录命令；按独立历史同步 master／main，完成显式标签绑定、公开 Release和全部附件全字节核对。Microsoft游戏服务许可、Mac历史游戏链及其他未覆盖项继续明确保留。
