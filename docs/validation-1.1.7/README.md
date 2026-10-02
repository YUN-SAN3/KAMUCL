# 1.1.7 验证记录

本目录保存发行成品的原始检查结果。最终成品身份、命令、通过项和未覆盖项以
`CURRENT_STATUS.md` 为准；1.1.6 的实际网络及平台记录仍保存在相邻目录。

## 验证范围

- `windows/package.json`：实际便携 EXE、中文路径 ZIP、冷/热启动、展开文件逐项摘要及备用完整 ZIP。
- `windows/ui-refinement-*.json`：深色、浅色、自定义主题的完整页面、尺寸、缩放和既有交互回归，包含实际 EXE SHA256。
- `windows/skin-palette-ui-*.json`：实际像素绘制、半透明 PNG、基础层保护、吸色同步、无效输入、撤销边界和色板保存。
- `windows/mascot-header-ui-*.json`：真实指针跨七人、反向横扫、停留、键盘、排序、计数保存及窗口生命周期。
- `windows/gallery-favorites-ui-*.json`：真实受管图片、停用保留、零图/单图计时器、混播顺序、主题往返及收藏写入状态。
- `banner-assets.json`：用户七张原 PNG 与仓库无损 WebP、生产构建资源的逐像素和摘要比较。
- `clean-source.json`：独立全新目录的源码解压、npm ci、JDK 17 桥接重建、类型、生产构建和许可证检查。

## Mac 原生检查

`mac-verification.json` 记录本轮工作流 36926471866、对应提交 cdaa9de、实际 job / attempt、
成品摘要和通过步骤。`mac-arm64/` 与 `mac-x64/` 保存原生启动、扩展 GUI 和实际游戏的原始 JSON
及代表截图；两种架构均重新执行 APP 和挂载 DMG 检查，不使用旧 run 的成功结果替代。
原生 `native.json` 为最后一次挂载 DMG 的截图验证；工作流步骤同时记录此前 APP 验证。
`game.json` 记录真实 Minecraft 26.2 窗口、存档区域文件、聚焦及正常退出。

Mac 新功能 GUI 检查使用深色主题；没有逐一验证所有 Mac 主题、页面和窗口组合。
Mac 使用 ad-hoc 签名，没有 Developer ID 签名或公证。Windows 三种主题的完整回归单独记录。

收藏的社区搜索、文件版本和错误响应来自隔离测试夹具；卡片、共享前端状态、收藏 IPC
和磁盘文件使用实际实现。等待同时核对两卡空闲、所选项目、IPC 返回、磁盘文件及请求
完成轨迹，不将固定延时或仅有画面上的星标当作持久保存成功。

## 动效与声音

正常动效和系统减少动态效果分别验证，夹具临时设置测试页面的媒体偏好并在结束时恢复，
不更改玩家系统偏好。隐藏检查使用真实原生窗口状态和受控 IPC，同时保留未修改的
Page Visibility 状态；实际 WebGL 绘制、AudioContext 和声音节点也分别记录。

`windows/mascot-slap-117.wav` 为本轮独立合成的原始短声，
`windows/mascot-sweep-117.webm` 为七人横扫的实际混音输出录音。
录音仅接入彩蛋音频输出，不读取麦克风或其他应用声音。
数值检查覆盖单声长度、声部重叠、峰值、削波及隐藏/关闭后的暂停和释放。
硬件扬声器或耳机的人工主观听感未验收，不能把数值和录音检查描述为人工听测通过。

## 对应源码

应用实现固定在 `bf37aa8953fde9bdc53620b7915486ad1305ed20`，完整测试 588/588。
`72adab2`、`8b72b39` 和 `cdaa9de` 仅改进收藏、拍打计数和既有页面 GUI 验证的异步完成等待与证据记录，
不改变发行应用代码。
最终源码 ZIP 的 `SOURCE-MANIFEST.json` 和交接包的 `_handoff/manifest.json` 提供逐文件摘要；
源码干净构建通过不承诺签名和打包元数据的字节可重现。

真实微软皮肤上传、工单附件提交、跨 Java 客户端及公网对称 NAT 等继承功能未覆盖项
仍见 `CURRENT_STATUS.md` 和 `docs/validation-1.1.6/`，模拟服务不能作为这些实际场景的证据。
