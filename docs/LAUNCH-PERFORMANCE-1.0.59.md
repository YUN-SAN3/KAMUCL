# 1.0.59 启动准备与便携包体积

启动准备中的游戏文件与配置、账号验证、Java 环境现在并行执行。文件分支内部仍保持本体校验、默认设置同步、加载器修复、依赖校验与修复、natives 和资源准备的依赖顺序。所有分支完成后才创建游戏进程；失败也等待已开始的工作结束，避免下一次启动与残留写入重叠。

依赖库采用最多四路内容校验，没有用“文件存在”或历史校验缓存替代 SHA1/JAR 校验；进度通知最多约每 80ms 更新一次。Java 冷扫描异步探测，保留原有缓存、版本优先级、自定义路径和架构筛选。同一运行目录、同一 Java 主版本共用在途准备，成功与失败后均清除在途记录。

## 测量方法与边界

`npx tsx scripts/benchmark-launch-preparation.ts` 在独立临时目录生成 200 个文件，共 117,964,800 字节，调用生产校验函数完成六轮交替顺序比较。本机实测串行中位数 203.5ms，四路 83.5ms。样本使用真实流式 SHA1 读取，但不是 Minecraft 进入主菜单的测量；账号服务延迟、磁盘和模组加载会影响实际总耗时。各分支耗时写入本次游戏日志，便于后续比较真实实例。

没有修改玩家内存分配、JVM 调优参数、默认游戏选项、模组及视觉资源。

## 无损压缩

Windows portable 7z 的字典设为 128MiB，格式和 NSIS 解码器保持不变。较高字典只在首次解压期间使用；正式运行不携带解码器工作内存，后续打开继续复用按版本与内容哈希隔离的运行目录。未移除媒体编解码器、软件图形回退、语言、字体、图片或许可声明。

`scripts/verify-release-1054.cjs` 验证独立路径中便携包冷/热启动、原生粒子首帧和 ZIP 启动。随后 `scripts/verify-release-payload.cjs` 对 EXE 解压、ZIP 与构建目录逐文件比较 SHA256，并与 1.0.58 ZIP 核对文件清单及未变更运行资源。NSIS 专用 elevate.exe 仅在 portable 中出现，和上一版打包流程一致。

## 回归

390 项自动化测试通过，覆盖同尺寸损坏文件、修复失败保留原件、并行失败等待、工作数上限、Java 在途去重和失败后重试。类型检查、生产构建及浅色/深色/窄窗口生产界面交互验证通过。测试未结束用户游戏进程，也未修改用户实例。

## 产物验证（2026-09-11 18:16）

| 项目 | 1.0.58 | 1.0.59 |
| --- | ---: | ---: |
| Windows portable EXE | 67,699,472 字节 | 67,234,317 字节 |
| Windows ZIP | 103,549,882 字节 | 103,549,975 字节 |
| 冷启动至 Electron 测试入口 | 4,398ms | 4,354ms |
| 复用缓存至 Electron 测试入口 | 214ms | 220ms |
| 冷启动原生粒子首帧 | 341ms | 350ms |

EXE 减少 465,155 字节，约 0.44MiB / 0.69%。ZIP 使用相同压缩格式，代码变动后大小基本不变。以上启动验证在私有中文路径执行；短时差值属于单次运行波动，不宣称启动器首屏因此提速。29 个 portable 运行文件与构建目录 SHA256 一致；ZIP 对应的 28 个文件也一致，NSIS 专用提升权限助手是唯一包装差异。

Windows EXE SHA256：`a1bd582c147cec06cd8b6d79a3119a97d33e4ff0232e62801d0be4540b7e44dd`。

Mac 原生构建与 APP/DMG 启动验证：[34588000755](https://github.com/kamubaba-i/KAMUCL/actions/runs/34588000755)，ARM64 与 Intel 均通过。继续沿用 ad-hoc 签名，未做 Apple 开发者签名及公证。

本地证据：`out/launch-preparation-benchmark-1059.json`、`out/release-1.0.59-proof.json`、`out/release-1.0.59-payload.json`、`out/network-ui-qAOC5x`。


发布验证（2026-09-11 18:21）：[v1.0.59](https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.59)，Release ID `386947754`。标签绑定构建源码 `6d880d14459a13fd388c100184e04dab75a625dc`，Windows EXE/ZIP、Mac 两架构 APP ZIP/DMG 与统一 SHA256SUMS.txt 共七个远端附件的大小和 SHA256 digest 全部匹配。成品归档 `release/final-1.0.59`。
