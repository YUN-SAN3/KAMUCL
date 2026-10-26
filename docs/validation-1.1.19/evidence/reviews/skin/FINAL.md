# KAMUCL 1.1.19 皮肤外层修复：独立最终评审

结论：本批皮肤外层修复通过，未发现阻断缺陷。合理性 **9.3/10**、功能性 **9.2/10**、外观 **8.8/10**；三项分别达到 8.5，不取平均，也不以未覆盖项目补分。审查者未实现本批产品修复；本轮只读取产品/既有证据、运行专项测试和独立验证脚本，只写 `out/review119-skin/` 审查资料。

## 分项依据

| 项目 | 分数 | 实际依据及限制 |
| --- | --- | --- |
| 合理性 | 9.3 | 旧真实 EXE 证实问题是透明吸色把画笔 alpha 变为 0；修复忽略完全透明外层 texel，保留画笔 RGB/alpha。已有非零透明度仍采 RGBA，基础层保持不透明。显式或持久化 alpha=0 没有被强制重置，而是提供明确恢复按钮；极小 alpha 的提示采用实际 PNG 字节量化规则。没有调整无关的 Three 几何、材质比例或 UV。 |
| 功能性 | 9.2 | 独立运行相关 14 项测试全部通过；五轮最终专项 GUI 证据通过，逐像素重验 brush、fill、erase、undo/redo、基础层、Classic/Slim 及导出。两轮黑橙实际关重开、磁盘 alpha=0、恢复按钮及再次导出成立。尚未逐一操作全身所有面、Slim 手臂、触控笔和每种 DPI，也未以实际游戏再验本批编辑结果。 |
| 外观 | 8.8 | 实际查看四主题的原始 warning/paint 截图，另看黑橙 125% 及持久化恢复截图；标题、关闭、固定页脚、提示和恢复按钮均可辨认，无重叠遮住按钮。125% 下提示和按钮正常换行。小窗口需在模型与调色板之间滚动，提示并非始终与模型同屏；这是本项保留分，不宣称整页所有内容同时可见。 |

## 产品和证据绑定

- 独立重新计算 `release/KAMUCL-1.1.19.exe`：97,323,050 bytes，SHA256 `7b11d4979f1d3afc72397b501770130e3c5e23e2e246deaa70a06276f6a61a65`。
- [生产输入冻结清单](../production-inputs119-final-prebuild.json) 的 516 个文件逐份检查尺寸和 SHA256，**0 差异**。清单 SHA256 `92f7dd9ba477830fa8d56f685e0d10f4d4535486cc581444a2d97675f754b43c`；独立结果见 [source-freeze-verification.json](source-freeze-verification.json)。
- [原始独立绑定收据](../gui119-executable-bindings.json) 及 `out/bind119.cjs` 已审阅。另行重算全部 **17** 份保留 EXE、其全部 runtime ASAR；均等于最终 EXE 与包 ASAR `42697b9e8e9e1ef75ae7f9e6fa75eb41658002f235ed9f1bd2ec324c9454e2a1`。**16** 份新模块原 proof/owned ledger 的原始哈希、parent PID、唯一出生时间关联及 awaitedClose 均重新验证。结果见 [binding-verification.json](binding-verification.json)。
- 绑定强度准确限定为：**事后保留字节哈希 + 原始文件时间 + 唯一 owned-parent PID ledger 关联**。原 proof 没有启动当时的 process.execPath/EXE hash，未事后改写为有。五轮本次专项及原始录屏所属轮有唯一关联；旧完整关闭/忙碌回归仅有已核验 EXE cohort 的辅助关联，不提升为同等逐轮 PID 绑定。
- [Windows 包验证](../windows-package-1.1.19.json) complete=true，便携 EXE、ZIP 的冷/热启动均 pass。读取保存的 [全量测试日志](../tests119-final.log)：1356 tests / 1355 pass / 0 fail / 1 skip。独立执行相关测试：`npx tsx --test tests/skin-outer119.test.ts tests/skin-colors-117.test.ts tests/skin-palette-preferences.test.ts tests/skin-editor-118.test.ts`，14/14 pass。

## 最终真实 GUI 覆盖

| 主题或缩放 | 原始 proof | 完整 | 导出 |
| --- | --- | --- | --- |
| 黑橙，小窗口 | [435f49aa](../qa-skin-layers119-black-orange-435f49aa-3f98-4e68-949c-16d322229f3e/proof.json) | true | Classic / Slim / 恢复后，共 3 PNG |
| 蓝白，小窗口 | [3baa69ef](../qa-skin-layers119-blue-white-3baa69ef-9afc-41f8-8327-fe5a71c7c1d9/proof.json) | true | Classic / Slim，共 2 PNG |
| 透明，小窗口 | [ce2a3f69](../qa-skin-layers119-transparent-ce2a3f69-670c-435e-8b0a-a97ee76fb4e0/proof.json) | true | Classic / Slim，共 2 PNG |
| 自定义，小窗口 | [556a701a](../qa-skin-layers119-custom-556a701a-79c9-4bf8-9464-f7351d3a28aa/proof.json) | true | Classic / Slim，共 2 PNG |
| 黑橙，125% 页面缩放 | [98375013](../qa-skin-layers119-black-orange-98375013-8237-4e7a-b98d-cb3528abe6be/proof.json) | true | Classic / Slim / 恢复后，共 3 PNG |

此五轮共 32 张原始截图均重算尺寸、SHA256，并核对记录的真实 HWND/PID 前台焦点、可见和非最小化。合并 firstDiagnostic 与关重开后的 diagnostic，共 **47 个 pixel 事件全部 trusted**。账号为隔离测试账号；保存目标 chooser 固定至独立目录，真实坐标点击 Save PNG，后续生产 IPC、PNG 验证及落盘流程真实执行。没有实际微软上传或游戏/服务器请求。

独立解析各步骤 Canvas RGBA，不仅依赖 complete 标记：透明采样前后画笔和像素不变；普通绘制恰好改变 1 个外层像素；undo/redo/erase 与目标状态逐字节相等；半透明像素为 `[255,88,34,128]`，采样 alpha 精确为 128/255，RGB 等于浏览器实际采样字节；fill 恰好改变 64 个同面像素；基础层绘制只变 1 像素、alpha 全部不变；Slim 新建外层仍可绘制。**12 个实际导出的 64×64 PNG** 独立解码后，均与对应浏览器 Canvas 状态逐字节相等。黑橙两轮磁盘偏好确为 0，关重开仍 0，恢复后 alpha=1 且能绘制和导出。

实际尺寸不能写成严格 960×620 物理像素：小窗口请求 native DIP 960×620 / zoom=1，Windows display scale=1.25；实际 bounds=962×623 DIP、content=961×622 DIP、fractional visualViewport=961.5999756×622.4000244 CSS、inner/client=962×622、DPR=1.25；截图=1202×778 pixels。125% 页面缩放轮请求 1280×900 DIP，实际 bounds=1281×901、content=1280×900，visual/inner/client=1024×720 CSS、DPR=1.5625；截图=1600×1125 pixels。现有 <=3 DIP 与 <1 CSS 的实测几何门槛成立，native 焦点门槛没有放宽。

## 实际视觉检查和录屏

实际查看 **12 张原始 PNG**：四主题各自 `zero-alpha-warning.png` 与 `blank-outer-painted.png`；黑橙小窗口 `persisted-zero-alpha-warning.png`；黑橙 125% 的 warning、paint 和 persisted warning。提示可读、恢复按钮完整、页脚保存按钮始终可见；绘制截图能看到空白头壳新增的颜色像素。

[原始录屏所属 proof](../qa-skin-layers119-black-orange-2fbb669b-a540-4bfa-8ad8-58f37cce500a/proof.json) 的 recording.directory 为 `out/skinlayers119-original-black-orange`。**189 帧全部保留且逐帧可解码**，时间单调；实际查看 frame-0000.jpg / frame-0094.jpg / frame-0188.jpg，观察到空白头壳变为有色像素、未保存状态和撤销按钮变化。没有重编码、补帧、插值或以录屏接收 FPS 作为性能验收。

[旧完整编辑器辅助回归](../skin-editor-ui-black-orange.json) version=1.1.19、complete=true，记录中键/Alt 旋转 RGBA 不变、单笔撤销、显示部位、忙碌及关闭/取消/失败错误可见等；五种布局包含 125%/150%。日志的旧 `PASS 1.1.8` 字样为模块硬编码标签，不用于版本绑定。通知曾遮住重新打开入口，原回归记录等待自然过期后继续，不能表述为无任何遮挡。

## 保留的历史失败和限制

1. 旧 1.1.18 真 EXE [baseline](../qa-skin-layers119-baseline-black-orange-3c317eb9-ef46-4351-9fba-9ab066ba2718/proof.json) complete/reproduced：透明外层采样 alpha 1→0；换蓝后真实 texel 仍全透明、新建仍 alpha=0。这是修复前的真实产品缺陷，不改称通过。
2. [首次尺寸断言失败 9522dffe](../qa-skin-layers119-black-orange-9522dffe-03a6-4788-9958-24719797b75f/proof.json) complete=false，记录 `962 !== 960`。失败源于把 native 请求当严格实际尺寸。保留原失败，后续准确观测实际几何；没有冒称物理 960×620。
3. [蓝白 a7a0b98e](../qa-skin-layers119-blue-white-a7a0b98e-b8e2-4af4-b485-5061c3bbadb9/proof.json) complete=false，前台 HWND 10030780 与 owned HWND 39653372 不符；该份没有完整 foreground PID 观测。[透明 1fcdc17a](../qa-skin-layers119-transparent-1fcdc17a-bc69-4ca2-bfaf-64c871c8e03d/proof.json) complete=false，owner PID 5008 / foreground PID 44080、focused=false。没有确定进程名称或根因；不归咎于某个应用，不把这些失败算为产品通过。原焦点门槛保留，后续各主题冷启动完整重跑通过。
4. 首轮功能 complete 的 warning 截图停在上部，不能证明提示/按钮实际画面。后续四主题单独滚至真实 warning 的原图已补齐，上述视觉评分使用补齐的图。
5. 前期独立几何诊断的首次测试在 UV 整数边界预期 y=12、实得 y=11；改为 texel 内部采样后通过。该诊断夹具失配单独保留，不改写为产品缺陷。

未直接覆盖：全身每个面和每个视角的编辑、Slim 手臂专门 UV、触控/压感笔、多显示器全部 DPI/缩放、跨平台、所有 64×32 导入迁移、实际微软上传或本批导出皮肤进入真实游戏、物理磁盘满/断电保存。低非零 alpha 量化提醒通过 helper 测试，GUI 本次直接验证 0% 与 50%，不冒称全部小数透明度均 GUI 验证。PNG 导出 picker 目标为夹具，未操作真实用户文件。评分只适用于本批皮肤外层修复。

独立结构证据见 [evidence-verification.json](evidence-verification.json)、[binding-verification.json](binding-verification.json) 和 [FINAL.json](FINAL.json)。没有修改产品、版本、构建输出或原 QA proof。
