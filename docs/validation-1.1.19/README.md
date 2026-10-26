# KAMUCL 1.1.19 Windows 验收

香港更新日志 2026-10-07 16:08。仅 Windows x64，Electron 44.3.0。最终 EXE SHA256：`7b11d4979f1d3afc72397b501770130e3c5e23e2e246deaa70a06276f6a61a65`。优化和其他平台不在本批。

## 修复及根因

1. 1.1.18 实际 EXE 吸取空白外层像素后，画笔 alpha 从 1 变成 0，换颜色或新建仍无法产生可见像素。修复透明采样保留画笔，非零半透明继续精确采样；显式 0% 和旧偏好提供恢复入口。实际 Three raycast 能命中透明壳，未修改模型几何、UV、纹理或比例。
2. 原已有标准 MRPACK 后端；本批补齐前导 UTF-8 BOM 清单与资源页拖入入口。`.mrpack/.MRPACK` 优先走整包分类，普通 JAR/ZIP 本页行为保留。
3. 独立评审真实复现 `mods/a.jar` 与 `mods//a.jar` 通过不同路径文本重复目标、后一个文件覆盖已校验文件。现在按最终规范路径及 Windows 大小写检查，下载和实例写入前拒绝。

## 检查结果

| 检查 | 结果与证据 |
| --- | --- |
| 全量测试 | 1356 项：1355 通过、0 失败、1 Linux 原生更新专属跳过；[原日志](evidence/tests/final.txt) |
| 类型、许可、生产构建 | 通过；[许可](evidence/tests/licenses.txt)、[构建](evidence/build/production-build.txt) |
| 成品和 ZIP | 原生便携冷暖启动、系统 tar 干净解压、全部文件/ASAR/worker 边校验通过；[报告](evidence/build/windows-package.json) |
| 生产源绑定 | 516 项构建前冻结，构建和验收后复算不变；[清单](evidence/build/production-inputs.json) |
| 绘制专项 | 四主题、实际小窗口、Classic/Slim、空白外层、半透明采样、擦除/撤销/重做/填色/基础层、PNG 实际解码与 Canvas 一致；[黑橙](evidence/ui/skin/black-orange/proof.json)、[蓝白](evidence/ui/skin/blue-white/proof.json)、[透明](evidence/ui/skin/transparent/proof.json)、[自定义](evidence/ui/skin/custom/proof.json) |
| 旧偏好恢复 | 黑橙实际存储 alpha=0，关闭重开后提示、恢复、绘制和导出通过 |
| 原有编辑器回归 | 旋转、取消/拖出释放、图层/模型、关闭意图、保存冻结/失败/取消通过；[原报告](evidence/ui/skin/existing-regression.json)。日志 `PASS 1.1.8` 是旧模块硬编码文字，实际 version=1.1.19 |
| MRPACK 实际 UI | 首页、模组/资源包/光影/默认配置页 trusted drop，顶部导入、坏清单错误、混合批次拒绝、输入包与资源树未改变；[黑橙](evidence/ui/mrpack/black-orange/proof.json)、[蓝白](evidence/ui/mrpack/blue-white/proof.json)、[透明](evidence/ui/mrpack/transparent/proof.json)、[自定义](evidence/ui/mrpack/custom/proof.json) |
| 125% 界面缩放 | 黑橙 1280×900 请求，实际原生/CSS 值另记；[绘制](evidence/ui/skin/zoom125/proof.json)、[导入](evidence/ui/mrpack/zoom125/proof.json) |
| MRPACK 安装 | 生产安装编排、本地 loopback 合成下载、SHA1/SHA512、备用 URL、覆盖层、中文/空格/§及服务器专用项断言通过；不是完整 Minecraft/Forge 真实安装；测试源码 `tests/mrpack-import-119.test.ts` |
| 独立额外探测 | 20/20 专项、18/18 BOM/路径/hash 边界；[重复目标修复后实际安装拒绝](evidence/tests/alias-install-after.json) |

## 独立分项评分

| 功能 | 非实现者 | 合理性 | 功能性 | 外观 |
| --- | --- | ---: | ---: | ---: |
| 皮肤外层 | offline118 | 9.3 | 9.2 | 8.8 |
| MRPACK | java118 | 9.1 | 9.0 | 8.8 |

各项 ≥8.5、无未解决阻断，未使用平均。实际审查原图/原帧及测试结果。[皮肤报告](evidence/reviews/skin/FINAL.md)、[结构数据](evidence/reviews/skin/FINAL.json)、[MRPACK 报告](evidence/reviews/mrpack/FINAL.md)、[结构数据](evidence/reviews/mrpack/FINAL.json)。原报告内链接保留原机 out 路径；公开证据以本目录和 [EVIDENCE_BINDINGS](EVIDENCE_BINDINGS.json) 的 published 路径为准。

## 可重复命令

先执行 `npm ci` 并准备 JDK，再执行：

```powershell
npm test
npx --no-install tsc --noEmit
npm run license:check
npm run build
npx --no-install electron-builder --win portable --x64 --config.electronDist=node_modules/electron/dist --publish never
node scripts/pack-windows-zip.cjs
node scripts/verify-windows-package.cjs
$env:KAMUCL_EXTENSION_GUI='1'
$env:KAMUCL_EXTENSION_ONLY='1'
$env:KAMUCL_SKIP_EXTENSION_BASE='1'
$env:KAMUCL_119_WINDOW='[960,620,1]'
$env:KAMUCL_UI_MODULE='skinlayers119'
node scripts/verify-ui-refinement.cjs black-orange
$env:KAMUCL_UI_MODULE='mrpack119'
node scripts/verify-ui-refinement.cjs black-orange
```

其他主题参数为 `blue-white`、`transparent`、`custom`。125% 参数为 `$env:KAMUCL_119_WINDOW='[1280,900,1.25]'`。完整旧编辑器模块为 `skin118`。只向自己创建的测试窗口操作；不要与其他需要焦点的操作并行。合成数据与原生文件选择框返回路径夹具均在脚本中明确。

## 原始失败、绑定与限制

- [1.1.18 真实透明画笔复现](evidence/history/baseline-1.1.18/proof.json)、[重复目标修复前实际错误覆盖](evidence/history/alias-install-before.json) 原样保留。第一候选与尚未全部完成的候选测试不当作最终通过。
- 首轮 QA 严格比较请求和实际窗口尺寸，误报 962×623≠960×620。[原记录](evidence/history/requested-size-assertion/proof.json)。沿用已有 <=3 DIP 与 <1 CSS 像素原生舍入门槛；不是降低动效或产品标准。系统显示缩放 125% 与 Electron UI 缩放分别记录，不冒称物理 960×620。
- 两轮补充图操作因实际 HWND 不同停止，原失败保留：[一](evidence/history/foreground-loss-one/proof.json)、[二](evidence/history/foreground-loss-two/proof.json)。第二轮为其他 PID 44080，进程后来已不存在，名字未确定；不猜测归因。未放宽焦点检查，独立冷启动完整重跑通过。第一轮 warning 截图未滚到提示，最终四主题已补清晰原图。
- 原 proof 有 PID/版本，未内嵌 executable SHA。[后置实际绑定](evidence/build/gui-executable-bindings.json) 核对 17 份保留 EXE/ASAR，与 owned child ledger 和唯一出生时间关联 16 份专项 proof。明确是事后关联，不能冒称当时 process.execPath/hash 观察。辅助旧模块按同一已核验 cohort 处理。
- [原录屏目录](evidence/recordings/skin/recording.json) 保留 189 原帧和原始时间；不插帧，不以采集 FPS 宣称完整动效门槛通过。
- 顶部选择器只返回合成文件路径，未操作系统原生选文件窗口。GUI 坏包没有内置存档；坏清单夹世界不降级由后台/入口回调专项验证。GUI 包 files=[]，没有真实资源下载或游戏启动；合成安装另列。并不声称所有第三方包、真实 Modrinth/CurseForge 下载或完整 Minecraft/Forge 进入世界通过。
- 未覆盖全部部位所有面、所有 DPI/输入设备、人工听感、完整动效性能与其他平台。Windows 未发行者签名；ownedInventory 在 Windows 不可用，不宣称所有后台进程清零。
- 公开新增数据全部为合成夹具、专属测试窗口、公开元数据或构建/测试记录。用户整合包、存档、皮肤、登录凭据、私钥及未提交 `pelican-bicycle.html` 不纳入。

[独立隐私及原字节审计](evidence/reviews/privacy/FINAL.md)核对原 377 项、42,820,091 字节，全部原副本相同；包括 101 张 PNG、189 原始帧和 15 个合成包/占位 JAR。文本扫描无凭据或私人资料，隐私目视只抽检两图；EXE 绑定保留事后关联限定。该审计自身的两份原报告随后加入 [EVIDENCE_BINDINGS](EVIDENCE_BINDINGS.json)，总计 379 项，未改写原审计范围。

源码/交接的最终提交与 SHA、公开附件核对在外部 `DELIVERY-1.1.19.json`，避免 Git 归档自引用。运输前后以未修改的 handoff 工具验证并运行真实许可命令。
