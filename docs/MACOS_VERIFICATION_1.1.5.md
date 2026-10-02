# KAMUCL 1.1.5 macOS 交付验收

版本保持 **1.1.5**。本次增加 Apple Silicon / Intel 的原生 macOS 安装包，沿用当前 Vue 界面、主题、皮肤预览和玻璃启动动画。

## 可追溯性

- Mac 安装包构建提交：`40e0c04c3e464fb16a1f449ac87a011e07542cdf`。
- 原生双架构构建：[macOS packages #36486157926](https://github.com/kamubaba-i/KAMUCL/actions/runs/36486157926)。
- `v1.1.5` 原有标签与 Windows 附件保留。GitHub 自动生成的该标签源码不包含本次 Mac 适配，请使用随附的 `KAMUCL-1.1.5-mac-source.zip`。
- 两个架构都使用 macOS 15 原生构建、Electron 33.4.11、对应架构 Java；最低声明系统为 macOS 11，未将其他系统版本描述为已实测。

## 验证范围

本地 537 项测试全部通过，0 失败、0 跳过。最终候选在 Apple Silicon 与 Intel 两台原生 macOS 测试机上均完整通过下列验收。原生验收从最终打包的应用调用真实 IPC，包含：

| 项目 | 验证内容 |
| --- | --- |
| 安装包 | Mach-O 架构、应用标识、ad-hoc 深度签名、ZIP 解包、DMG 完整性、挂载卷中的应用启动 |
| 界面 | 主界面、Mac 窗口控件、默认游戏目录、皮肤预览实际像素、黑橙主题原生毛玻璃 |
| 动效 | 真实 Canvas 碎玻璃渲染、鼠标附近排斥、加载末尾头像重组、就绪门控、清理与减少动态效果 |
| Java 与游戏 | 新安装自动下载 Java 25，主下载源失败后备用源恢复；通过启动器安装 Minecraft 26.2 + Fabric 0.19.5，进入官方 Demo 世界 |
| 游戏生命周期 | 关闭启动器窗口后游戏继续，Dock 重开恢复运行状态；从启动器前台切换到游戏；正常 Cocoa 关闭并验证存档 |
| 联机工具 | 官方 Mac Terracotta、SakuraFRP 下载哈希与执行权限；真实服务 API、生产 IPC 启停、自有进程组及其子进程清理 |
| 更新 | 中文、空格和单引号路径下，本地 ZIP 暂存、篡改拒绝、真实应用替换、启动回执、签名备份和显式回退 |

进入 Demo 世界的测试驱动只存在于云端临时游戏实例，不打入启动器成品；它调用游戏的真实按钮，存档由 Minecraft 写出。新版游戏区域数据检查使用 `dimensions/minecraft/overworld/region`，并要求 `level.dat` 和非空 `.mca` 文件存在。

## Intel 测试环境条件

GitHub Intel Mac 的 Apple 虚拟显卡只有 64 MB 显存。原生调试栈显示 MoltenVK 在 Metal Argument Buffer 编码器探测中触发系统 `abort`；游戏渲染线程已位于 macOS 主线程。测试脚本仅对该 Intel CI 进程设置 `MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS=0` 和 `MVK_CONFIG_USE_MTLHEAP=0`，关闭虚拟驱动不兼容的编码器探测与 placement heap 路径，不修改产品的图形默认值。这些是 [MoltenVK 官方支持的配置](https://github.com/KhronosGroup/MoltenVK/blob/v1.4.2/Docs/MoltenVK_Configuration_Parameters.md)。最终 Intel 游戏完整验收在这两个配置下通过；该条件需与测试结果一同理解，不等同于覆盖全部实体显卡。Apple Silicon 使用默认环境完整通过，未采用 Rosetta 替代 Intel 原生验收。

## 安装与验证边界

- DMG 中将 `KAMUCL.app` 拖到“应用程序”；ZIP 解压后同样放到该目录。不要直接在只读 DMG 内执行更新。
- 已做 ad-hoc 签名，**没有 Apple Developer ID 签名及公证**。首次打开如被系统拦截，在确认来源与 SHA256 后，到“系统设置 → 隐私与安全性”确认打开。
- 账户、游戏、设置在用户数据目录，不随应用包替换；更新失败保留旧应用备份，不强制终止游戏。
- 未使用个人微软账户、付费 FRP 密钥，也未把工具 API 启动验证描述为两名玩家跨公网实联已测。对应功能保留，共用既有实现。
- 安装包、源码和验证证据分别附 SHA256；独立子 agent 评分以最终证据复核为准。

## 独立子 agent 评估

**9.2 / 10，通过（门槛 9 分）**。评估者 `/root/mac_review` 独立复核最终源码、原生日志、JSON 证据、游戏与动画截图，并重新计算两个外层构建附件及四个成品的 SHA256，全部匹配。未发现剩余交付阻断。

扣分：未进行 Developer ID 签名及公证（0.3）；仅实测 macOS 15，Intel CI 使用两项图形兼容设置，真实显卡和更早系统覆盖不足（0.3）；微软账户、付费 FRP 和双人公网联机未端到端实测（0.2）。

## 成品 SHA256

| 文件 | SHA256 |
| --- | --- |
| KAMUCL-1.1.5-mac-arm64.dmg | `664716c3b84592134da0f40adfefca5b51596d540ad90e22b137286d63691754` |
| KAMUCL-1.1.5-mac-arm64.zip | `aa5537adb407fde2bf3447ed758b5fea3ee35ea9e2007ca435733231ae641c71` |
| KAMUCL-1.1.5-mac-x64.dmg | `9ebc3f54677428f46a279b6964048e2387019f99896d94c0a420e41dd53130f5` |
| KAMUCL-1.1.5-mac-x64.zip | `5101e29b7fa83a68b006c7b796c056b9d0960ce8c86e99987f7aa1602a5e3c12` |
| KAMUCL-1.1.5-mac-source.zip | `e93bc8717061b982eb04fedc4af2eb2a664049a9e2b31441482230599d5aa13a` |

验证证据归档包含双架构截图、原生日志、验证 JSON、本地测试日志以及 GitHub 构建与附件来源记录。发布页的 SHA256SUMS.txt 同时覆盖原有 Windows 文件和本批 Mac 文件。
