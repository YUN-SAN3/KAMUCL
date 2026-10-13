# KAMUCL 1.1.22 版权、来源与素材审计

审计范围：当前工作区静态内容、已登记上游代码、原正式 1.1.21 Windows/Mac 成品及来源线索。根许可证仅适用于 KAMUCL 原创贡献；本报告不把缺少文件头、风格相似、公开可下载或用户提供素材判为侵权或完整授权。

本次 `writing-block.md` 是审计任务说明，不是已证实的风险报告。其“仅审计/不得擅自替换”约束与本次用户明确批准的 Client ID 整改分别处理；原文件未修改，许可材料及审计清单新增，不自动删除素材、改写历史或以替换追溯证明旧版合法。

## 覆盖与证据强度

| 范围 | 已执行 | 限制 |
| --- | --- | --- |
| Git 跟踪树基线 | 11,504 个路径、645,401,657 字节逐文件 SHA256；基线 HEAD `56a761b528e6eb1511d7c0980461016ba17a72f7` | 哈希是采集时工作树字节，HEAD 是定位信息，不宣称未提交改动属于该提交；不读取真实用户配置或无关未跟踪 HTML |
| 非历史验证文本 | 1,037 个文本文件、11,610,500 字节、672 个版权/SPDX/来源/许可证关键词命中 | 是定位清单，不是每段代码来源均已证明；行文本仅存哈希，不输出可能的秘密 |
| 产品素材 | 105 个二进制/图像素材逐项路径、大小、SHA256与分组 | 不能用格式/哈希证明授权；不宣称逐张所有权法律核验 |
| 历史测试/截图 | 10,351 个验证文件纳入全量清单；历史图片/视频/音频/合成 JAR 单独分类 | 未对近万张历史图片逐帧人工版权或隐私判断；不可将此范围视为已全部清白 |
| 当前实际依赖/成品 | 见 LICENSE_AUDIT 与依赖、ASAR材料清单；原 Windows/Mac 包精确绑定 | 不能用旧成品结果替代新的 1.1.22 成品检查 |
| 历史来源/秘密 | 具体 Git 及凭据报告交叉引用 SECURITY_AUDIT/CLIENT_ID_AUDIT | 不宣称全历史源码均已完成相似性检索或授权审判 |

可复核清单：`TRACKED_SOURCE_INVENTORY.json`、`COPYRIGHT_SOURCE_SCAN.json`、`ASSET_INVENTORY.json`、`PRIMARY_LICENSE_VERIFICATION.json`。未运行 ScanCode、ORT、licensee 或第三方云扫描服务；没有把项目私有代码上传到扫描网站。

## 代码来源核查

| 编号 | 结论/置信度 | 路径和证据 | 使用方式及义务/适用条件 | 状态 |
| --- | --- | --- | --- | --- |
| C-01 | 当前声明范围清楚，高 | `LICENSE:3-5`、`THIRD_PARTY_NOTICES.md:3-4` | 根 MIT 限于原创贡献；第三方权利保留。不能把原始 LGPL/GPL 部分自动改标 MIT | 已确认范围声明；不是整体版权清白认证 |
| C-02 | skinview3d 明确第三方来源，高 | `src/renderer/src/vendor/skinview3d/model.ts:1-4`；去掉4行署名后与固定v3.4.2的15,192字节上游实现归一化相同；`VENDORED_SOURCE_VERIFICATION.json`保留源码及许可SHA | vendored MIT 模型，保留原作者和许可；哈希门禁阻止无记录修改。skinview-utils 为 MIT转换库 | 已实际比对固定上游源码和许可；不把整个界面作者声明当独立权利证明 |
| C-03 | VoxLink 协议移植明确，高 | `src/main/core/voxlink/punchAuth.ts:1-4`，其余登记文件第1行 SPDX；`THIRD_PARTY_NOTICES.md:15-38` | 依据固定 Java revision 的 TS 改编，LGPL-3.0-only；需保留作者、GPL/LGPL文本、可修改/重新组合的对应源码 | 当前登记、文本及供源机制已核；对应新成品仍需最终源码绑定 |
| C-04 | 旧版授权未被追溯解决，高 | `docs/LICENSE_REMEDIATION.md:3-11` | 文档记录过去无额外 PCL下载移植/Go桌面 VoxLink授权；当前替换不等于洁净室，也不为历史源码/旧发行版补授权 | 历史待核实；不将文档断言扩大为当前代码已证实侵权 |
| C-05 | 原创 GPL 离线外观组件的声明可见，高 | `offline-skin-agent/src/cn/kamucl/skin/OfflineSkinAgent.java:1,14-16`；`offline-skin-agent/README.md:3-11` | 独立游戏 JVM Agent/loopback服务；GPL-3.0-or-later源、构建脚本和完整条款随交付保留；不能仅凭同装在ASAR判全部前端GPL | 源码/许可已核；原创是作者声明，不是司法确认 |
| C-06 | 编译期依赖未被直接嵌入检查范围的 JAR，高 | `scripts/build-bridge.cjs:4-6,18-21`；实际桥接JAR条目仅 `cn/kamucl/bridge`、manifest和mod metadata；离线JAR仅 `cn/kamucl/skin` | Fabric-loader/Gson固定校验的编译依赖，与直接复制其类分开。检查未见 `net/fabricmc`/`com/google/gson`/Minecraft类 | 已检查指定原1.1.21 JAR，不代表所有历史JAR或新包已通过 |

公开固定上游：[skinview3d MIT](https://raw.githubusercontent.com/bs-community/skinview3d/v3.4.2/LICENSE)、[VoxLink LGPL](https://raw.githubusercontent.com/AUGUHDAR/VoxLink/c475faa98cca16d4a2eeef4422c862c36091e1fc/LICENSE)。这些许可证允许有条件复用，不授予未包含其中的商标、素材或其他第三方权利。

## 素材、品牌与字体

| 编号 | 风险/置信度 | 当前证据 | 缺口与适用条件 | 处理 |
| --- | --- | --- | --- | --- |
| A-01 | MEDIUM，授权记录不足的高置信度；侵权未确认 | 83个 `src/renderer/public/mobs/*.png`；`src/renderer/src/mobIcons.ts:1`标为 Minecraft Wiki 游戏贴图；首次导入 `c18d648d` | 逐图页面/作者/版本/许可未登记；“Wiki官方贴图”不证明 Mojang背书或Wiki可授予游戏资产全部权利。Wiki版权/图片页本次工具不可访问 | 保留原文件，标待核实，不把无法访问记为允许复用 |
| A-02 | MEDIUM，待核实 | 7个 `src/renderer/src/assets/launch/*.webp`；原声明称用户参考/生成插图 | 缺参考图片作者、人物/皮肤权利人、公开再分发与商业范围证据。AI生成不自动清除第三方权利 | 不擅自重绘/删除；要求权利人资料或适用公开授权 |
| A-03 | MEDIUM，待核实 | 7个人物纹理；`scripts/generate-mascot-skins.cjs:1`明确从正背面参考重建 | 当前只显示卡慕不等于其他源纹理已获再分发许可；人物、皮肤、品牌权利需独立确认 | 保留历史源和计数；UI移除不追溯改写来源 |
| A-04 | MEDIUM，待核实 | `build/icon*.png`2个、`src/renderer/src/assets/splash-face*.png`2个 | 猪头像品牌图缺作者/原图/授权登记；图像相似性不能直接判来源或侵权 | 不改变品牌外观；列为待核实 |
| A-05 | INFO，作者声明 | 2个反馈SVG与2个PNG；`scripts/generate-kamu-feedback.cjs:1-10`进行确定性渲染；`src/renderer/src/mascotAudio.ts:3-18`程序合成 | 已审查源未见外部样本导入；声明原创/自合成不替代司法所有权结论 | 记录生成链；历史WAV/视频是测试采集，不当成外部音频采样库 |
| A-06 | INFO，已检查限定范围 | 跟踪树无 ttf/otf/woff/woff2；UI为系统字体回退名称，未见审查源中的远程字体下载/`@font-face` | 系统字体名字不意味着将字体文件再分发；用户自导入字体/插件内容不在此结论内 | 无需复制系统字体至源码或成品 |
| A-07 | MEDIUM，未逐帧核准 | 大量 `docs/validation-*`截图/录屏，清单全量哈希 | 测试画面可能含游戏资产、第三方Mod界面、人物/账号和服务名称；不能推断所有权或隐私同意 | 后续公开报告采用已去私有代表图，历史不自动删除，具体秘密见安全报告 |

适用的[官方 Minecraft使用指南](https://www.minecraft.net/en-us/usage-guidelines)明确将游戏图形/纹理/模型/截图等视为资产，并分别规定品牌、资产使用及不得表现为官方/获背书。它的公开分享/商业定义不能按“免费=个人使用”简化。许可是否覆盖本产品的具体素材、地域及商业方式仍需权利人或法律专业人员确认。本报告新增非官方声明与来源记录，不以声明代替授权。

## 结论与人工证据

- **已确认**：当前树包含明确登记的第三方 MIT模型、LGPL协议适配、原作者许可文本及独立 GPL组件；原成品材料缺口见 LICENSE_AUDIT，不对缺失义务直接作法院式侵权裁断。
- **待核实**：人物/Logo/插图/83头像的权利人及具体公开再分发、商业使用范围；历史PCL/Go移植和历史图像的授权；素材作者身份/版权归属本身。
- **未发现（有限范围）**：指定桥接/离线JAR中的直接Minecraft/Fabric/Gson类嵌入；当前跟踪字体文件或源码导入的外部掌击音频采样库。此项不是不存在风险的保证。
- **不能确认**：整个历史或全部素材已合规、可无条件商业使用。本次 Client ID 修复不能替代上述权利确认。

需人工提供的不是完整秘密值，而是：权利人/作者名称、来源URL/日期/版本、允许公开再分发及商业范围的文本、项目注册/品牌归属资料。确认缺少授权时应由权利人选择获许可、替换或停止相应分发；审计过程不会擅自删除文件或撤销账户。
