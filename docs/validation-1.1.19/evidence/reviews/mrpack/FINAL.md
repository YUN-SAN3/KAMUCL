# KAMUCL 1.1.19 MRPACK 独立最终评审

评审者：java118；时间：2026-10-07 16:36（Asia/Hong_Kong）。评审者未实现本批 MRPACK 产品或产品测试，仅只读审查、执行已有专项并在 out 写诊断。未构建或启动 GUI。

结论：最终所列 Windows 成品的 MRPACK 范围合格；三项分别达到 8.5，未使用平均分。关键路径别名缺陷修复前不合格，修复后已经独立实测拒绝。当前无未解决的本批交付阻断。

| 维度 | 分数 | 依据与限制 |
| --- | ---: | --- |
| 合理性 | **9.1** | BOM 兼容范围仅为开头一个 U+FEFF；显式 MRPACK 统一按全包处理，保留资源页普通 ZIP/JAR 批次语义；坏包与混合批次明确拒绝；目标身份与实际落盘路径一致。 |
| 功能性 | **9.0** | 独立专项 20/20、额外边界 18/18；真实安装编排修前/修后复现；最终 EXE 五组可信拖入、生产 probe、原包及本地资源树不变。GUI 只识别零清单文件合成包，没有把它说成实际下载或游戏验证。 |
| 外观 | **8.8** | 实际查看四主题最小请求窗口及黑橙 125% 截图：格式/版本/加载器、命名选项、取消/确认和错误提示可读，没有按钮出界或遮挡。长目标路径在单行选择框中截断；125% 并非所有主题的最小窗口组合，未因此推断未测外观。 |

## 成品和执行绑定

- 最终 EXE：release/KAMUCL-1.1.19.exe，97,323,050 字节；SHA256：`7b11d4979f1d3afc72397b501770130e3c5e23e2e246deaa70a06276f6a61a65`。
- 实际 ASAR SHA256：`42697b9e8e9e1ef75ae7f9e6fa75eb41658002f235ed9f1bd2ec324c9454e2a1`，与完整 Windows 包验证一致；EXE/ZIP 中文目录冷、热启动均通过。
- 516 项冻结产品输入由评审者逐项重新计算 SHA256，当前不匹配为 0；四个直接审查文件与独立诊断的源码哈希也一致。
- 原始 GUI proof 只有 PID/version，没有嵌入可执行文件哈希。单独的 gui119-executable-bindings.json 用保留副本、父 PID/owned ledger、创建与启动时间做运行后关联；评审者对本范围五份保留 EXE、runtime ASAR、ledger 和 proof 哈希重新核对。没有回填或改写原始 proof，也不把关联说成当时观测过 process.execPath。
- 五组各 8 张 PNG，共 40 张，独立校验全部哈希；其中 7 张关键图片实际人工查看。所有 proof complete=true，原包 unchanged，前后本地 JAR/ZIP/MRPACK 资源树一致。完整结构、路径、逐图哈希、窗口尺寸、检查标签、运行绑定见 FINAL.json。

## 已修缺陷与原始失败

1. **P2 路径别名覆盖（评审者独立发现）：** mods/a.jar 与 mods//a.jar 在旧 seenPaths 文本比较下被当成两个目标，safeJoin 却落到同一文件。真实生产 installModpack 下载两个各自 SHA1/SHA512 正确的不同文件，返回成功；最终仅满足第二个声明哈希。原始 boundary receipt 的 18 项中有 1 项不符；原始安装 receipt 保留成功结果和覆盖后的真实哈希。
2. **修复与独立复验：** 实现者改用 safeJoin 返回的 destination 做目标 identity，Windows 再按现有大小写规则比较；不放宽路径校验。新增别名回归后独立 20/20 通过，个人 18 项探测全部符合预期。原实际安装诊断现在在任何网络请求/实例写入前拒绝重复目标，requests=[]，原包不变。修前 receipt 未删除或覆盖。
3. **资源页 MRPACK 被局部导入截走：** 实现者已修复显式 .mrpack/.MRPACK 的路由优先级，并阻断目标事件传播。本人的修后专项覆盖首页、mods/packs/shaders/keys、坏包和混合批次；最终 EXE 实际在同样入口打开整合包确认。未把 Node Event 私有回调测试冒称完整 Vue 挂载或原生拖入。
4. **BOM 兼容：** 开头单 BOM 可读，双 BOM、BOM 前空格、损坏 JSON、路径穿越/绝对路径/ADS/设备名、坏或缺失哈希仍拒绝；字符串内部 BOM 保留。原始包字节均不改变。坏包和混合批次的预期拒绝是验收成功，不计为产品运行失败。

## 验证范围

- 独立执行：npx tsx --test tests/mrpack-import-119.test.ts tests/import-probe-119.test.ts tests/mrpack.test.ts；修后 20 tests、20 pass、0 fail、0 skip。另有 18 个只读生产 probe 边界及真实安装编排修前/后诊断。
- 专项真实安装编排使用 localhost HTTP、生产下载哈希和临时文件系统：客户端下载、备用源、client/server env、common/client/server overrides、Unicode 路径、输入包不变有断言。使用合成原版客户端/模组字节，不冒称真实服务或 Minecraft 世界运行。
- 核查主任务最终全量日志：1356 项、1355 pass、0 fail、0 cancelled、1 Linux 平台 skip；评审者没有重复运行全部 1356 项。
- 实际 GUI 用 Input.dispatchDragEvent 产生受信文件拖入到已绑定且前台校验的 Windows 窗口，生产 probe 解析含单 BOM 的合成 MRPACK。所有五组都有首页/四资源页/顶部导入、坏包、混合拒绝。没有把它称为资源管理器人工拖拽手势。
- 四主题请求 960×620 DIP、Electron zoom 1、显示比例 1.25；Windows 实际边框为 962×623 DIP、内容约 961×622。另有黑橙请求 1280×900 DIP、Electron zoom 1.25，CSS 视口 1024×720。尺寸舍入单独记录，不冒称精确物理像素或最小窗口同时 125%。

## 未覆盖与限定

1. GUI MRPACK is synthetic with files: []; dialogs and production classification are proved, not GUI download/install/game acceptance.
2. Toolbar button uses production import flow but showOpenDialog returns a fixture path; native operating-system file-selector interaction was not tested.
3. The GUI malformed archive has no bundled world; malformed archive containing a world is covered by backend/callback regressions, not this GUI fixture.
4. Trusted drops are Chromium Input.dispatchDragEvent into the owned foreground Windows application, not an Explorer drag gesture.
5. Actual installation orchestration is localhost HTTP and temporary filesystem using synthetic runtime/mod bytes; no live Modrinth CDN or full game launch claim.
6. All four themes are measured at requested 960x620 DIP, zoom 1, display scale 1.25; additional 125% Electron zoom is black-orange at 1280x900 DIP. No claim of every theme at minimum size and zoom 1.25.
7. No FPS or complete animation-performance measurement. MRPACK changed no animation implementation.
8. Resource pages intentionally preserve .zip as local-resource batch import; renamed MRPACK .zip and nested MRPACK use unified classification at general import entry points.
9. Update/overwrite conflicts, long filenames, large packs, all loader runtime installations and third-party MOD combinations were not exhaustively repeated in GUI.

## 证据哈希

| 证据 | SHA256 |
| --- | --- |
| out/gui119-executable-bindings.json | `7562fabbc2a6ede80ce94f263a78e4f5909ac252e72afa832fd39d8e8a8f30c8` |
| out/production-inputs119-final-prebuild.json | `92f7dd9ba477830fa8d56f685e0d10f4d4535486cc581444a2d97675f754b43c` |
| out/windows-package-1.1.19.json | `de23adf9d752793e70c0ead64d5b3306ab900984de983ab6ff05ac58453793c7` |
| out/tests119-final.log | `97e5744023fc90c59fda7eee0d87afe771e51c2454d26e745867df430d61b060` |
| out/review119-mrpack-readonly/focused-tests.log | `be43c80d0a1039011e6fa9dd222686c9dede262233d7532ccebb550415d26fd0` |
| out/review119-mrpack-readonly/focused-tests-after.log | `1ef781ab71419ba2a8d95658cde379c83c9f28fda725f62494cb96043a81ef26` |
| out/review119-mrpack-readonly/receipt.json | `4b3383f35398b36dd91648a5d5c00c2b9395632311bce30820f92049955137c6` |
| out/review119-mrpack-readonly/receipt-a8d3d4fd-4edd-4f24-bca2-a48016c73be2.json | `51d86e32e36d6fb3f8c879f60b9cba3c980db19dd9595e6fa3536314dee4a965` |
| out/review119-mrpack-readonly/actual-alias-7f7466da-087a-41a4-ad0f-4e6a17e99bd9/receipt.json | `9561b81d4266a2891e8cc83863b9aea4930f9c315281a98a6cd4ba9ec339c1a2` |
| out/review119-mrpack-readonly/actual-alias-11f444bc-5e5f-4abc-affc-8ff785c8e2c9/receipt.json | `290fffbfa07ac8baff15719733b1b6cb87703d3805e14c8a814e9c8dc89fa6f2` |
| out/qa-mrpack119-black-orange-0f7f59be-f4ef-4701-941e-32306c1343b4/proof.json | `63c8354dcca4befcbdfb6cda647a9049f47287d3b414c577bae4fcfbe804d603` |
| out/qa-mrpack119-blue-white-43d503c4-815f-4717-860c-53c8df06012e/proof.json | `b4aff5f16c0506947385a6380cec602f5b1c1f95bfa8cb649e4ad01e20be770b` |
| out/qa-mrpack119-transparent-d142b293-56ec-4e0b-a4dc-58a4fdd425c9/proof.json | `9d4c1a0032de2af12cab9cef7559e85014b188447bb4857390dac00591f51287` |
| out/qa-mrpack119-custom-fd6aa10b-523c-4110-9c8b-658d029a8e3d/proof.json | `b580a024c708e87916d10b5cb444a4a6d789117838e62cda99d44de98245cfa6` |
| out/qa-mrpack119-black-orange-159325f6-510c-4286-a467-9c2645eaa452/proof.json | `7bf462b1aff826b1f4a065c9b1ccf4a1129ad6883b5f672d330596d6ed4b25ac` |

只对本文绑定的最终成品和 MRPACK 改动评分；不评自己的 Java/离线准备实现，不借用其他模块截图推断本模块外观。
