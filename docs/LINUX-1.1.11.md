# KAMUCL 1.1.11 Linux 接续构建、安装与验收边界

2026-10-04 09:02（Asia/Hong_Kong）当前快照：第六 [37163779037](https://github.com/kamubaba-i/KAMUCL/actions/runs/37163779037) 绑定 `69c1e89ba23a007535c77bae65052f19b6d87f58`。Ubuntu 24.04 x64／ARM64 两个原生打包作业通过，各 864 项为 861 通过、0 失败、3 skip。三格式共六包的实际原生干净解压、26／25／25 个成员闭包、ELF／执行位／摘要及每格式 resources/kamucl-linux.json 内嵌来源与目标 ELF 的 Electron 44.3.0 观察均通过，独立解包复核保持 nativeDesktop=false。

Ubuntu 24.04 两架构与 26.04 x64 的 Xvfb 已真正启动应用，三次均在 ANGLE／OpenGL／Mesa llvmpipe 创建 WebGL 失败后出现 skin canvas missing；不是第五轮未启动应用的 xdpyinfo 前置失败。原先首错遮蔽已经修正，第六原错误／时间和失败完整保留。三主机均 Accelerated:no；24.04 为 Mesa 25.2.8／LLVM20，26.04 为 Mesa 26.0.8／LLVM21。EGL／GL 库有实际安装记录，mesa-vulkan-drivers 是否存在和同进程 GPU feature status 尚无原观察，不能断言缺失。精确 [Chromium152 软件驱动规则](https://github.com/chromium/chromium/blob/152.0.7977.78/gpu/config/software_rendering_list.json) 是强线索，不是已证明的最终根因。

第七只读 QA 在同一个原失败 GUI 进程先核对 PID／ABI／可执行路径／仍存活状态，再有限时观察 Electron GPU API、CDP SystemInfo 和原始 scratch context 错误，二次诊断／保存错误不会覆盖原 ERR_ASSERTION；不换后端、不绕过 sandbox、不重试为通过。该观察器的本机负例通过，实际 Linux 执行尚未完成；第七源码 SHA=null。Ubuntu24／26 四种组合均没有当前完整真实 GNOME／KDE／XWayland 桌面、游戏及一致性合格证据，所有评分 null、完整资格 false、无 Release。本批第七 Windows 全套为 874／873／0／1 skip、TypeScript 通过，覆盖 Mac 原生 BGRA 收集追加之前的冻结 QA；后补收集另经针对性校验。当前黑橙 general refinement 实际 GUI 已通过，当前 ux110 可见步行／外观另在执行，不能扩大有限 scope。上一四主题 final3 可见模型／步行／壁纸仍为 source69 已验证画面；这些不替代 Linux。以下为原历史快照。

第六旧源码／交接漏收 build/icon.png 和 build/icon-512.png，原审计 out/handoff111-history-source-closure-defect.json 保留；下一源码／交接必须重新核对完整构建输入闭包，尚无未来批次成功声明。

2026-10-04 08:02（Asia/Hong_Kong）第五轮历史快照：第五轮 run [37160588146](https://github.com/kamubaba-i/KAMUCL/actions/runs/37160588146) 精确绑定 `5167500b6c27b9bbdd1e80f22d91d3f5904007eb`。Ubuntu 24.04 的 x64／ARM64 原生全套各 857 项：854 通过、0 失败、3 项既有平台 skip。两个打包作业成功，AppImage／DEB／tar.gz 共六包的原生干净解压、ELF／执行位／逐文件摘要和原包清单检查通过；两架构各 portable 26、DEB 25、AppImage 25 个提取文件。

Ubuntu 24.04 两架构及 26.04 x64 的三次 Xvfb compatibility 预检均在 `xdpyinfo` 缺失处失败（`spawnSync xdpyinfo ENOENT`），应用未启动，GUI 模块执行数为 0。后续 `scandir out ENOENT` 又遮蔽首错；原始日志及原不完整 summary 保留，不回填为通过。已冻结补充 `x11-utils`、独立输出目录及保留首错的收尾流程，必须新原生重跑。真实桌面 runner 仍未配置，四种正式 OS／架构均未通过桌面、游戏或完整资格；26.04 ARM64 也无 hosted compatibility 预检。

第五轮 `resources/kamucl-linux.json` 实际仅含 product／platform／arch／version／installationKind；提交身份来自原 CI 外部绑定，未内嵌 sourceCommit，也未执行实际运行时版本观察。新包装修订将实际 Git HEAD 和运行目标 ELF 观察到的 Electron 版本绑定内嵌身份，并逐格式复验；它需要新包，不能重写旧包或以旧 SHA 宣称已完成。本批 Windows 产品输入不变，864 项本机全套为 863 通过、0 失败、1 skip，最新四主题本机 GUI 通过，但不替代 Linux 原生证据。完整资格仍为 false、三项评分 null、无 Release。

2026-10-04 07:04（Asia/Hong_Kong）更新：第四轮候选 `e0b1210` 原生 CI 均结束。Mac `37158774374` 两架构各 855 项为 851 通过、0 失败、4 项既有系统 skip；两个打包及六个限定集成任务成功，4 个 UI 和 2 个游戏任务失败。双架构 ZIP／DMG 已实际生成，Electron 44.3.0、最低 macOS 13、ad-hoc 签名明确记录；不代表完整一致性通过。ARM UI 缺独立输出目录、游戏任务依赖跨任务窗口探针属于 QA 前置问题，已修正。Intel 原截图、30 个无画布样本及三轮 EGL／GPU 错误确认 3D 初始化真实失败，根因仍需原进程诊断。Linux `37158774429` x64 为 852 通过、0 失败、3 skip，三格式实际生成后因 builder 文件名映射失败；ARM64 为 851 通过、1 失败、3 skip，打包跳过。已改为精确命名和私有目录独占发布，取消夹具使用真实未完成传输门控，保留原时间线。最新 Windows 全套 857 项为 856 通过、0 失败、1 项原有 Linux skip；最终 tar 发布调用另经语法及 4 项专项复验。此次产品输入及 Windows 成品未变，QA／Linux 包装变化必须原生重跑。独立修正复核通过，但所有平台完整门控及三项评分仍未完成；没有正式标签或 Release。

2026-10-04 06:30（Asia/Hong_Kong）更新：第三轮 `2b1e6f1` 的 Mac run `37157548139` 与 Linux run `37157548122` 均完整结束为 failure，没有取消或死锁。Mac 两架构各 853 项为 846 通过、3 失败、4 项既有系统限定 skip；失败为测试临时目录别名 `/var` 与产品正确返回的 `/private/var` 规范路径不同。Linux x64 为 850 通过、0 失败、3 skip 后进入生产构建，但旧打包检查要求官方 Electron 44.3.0 已不含的 `libEGL.so`；ARM64 为 849 通过、1 失败、3 skip，合成 Windows classifier 被正确的 ARM 安全规则拒绝。已修正测试根目录和原生库夹具，按两份官方 ZIP／SHA 建立准确的运行时清单，保留 ELF、执行位、ICD、资源和许可检查。Windows 最新全套 855 项为 854 通过、0 失败、1 项原有 Linux skip。此次新增 Linux 打包校验变化，Windows 产品输入和成品未改变；完整原生重跑仍必需，尚无 Mac／Linux 成品、桌面／游戏或独立三项合格结论。原始失败日志及时间保留，不能改称通过。

记录时间：2026-10-04 04:44（本地时间，Asia/Hong_Kong）。

本轮目标为 Ubuntu 24.04 LTS、26.04 LTS 的 x64／ARM64，共享当前功能、界面与动作。**第六两架构原生三格式及内嵌身份检查已通过，但三次实际 Xvfb WebGL 失败保留；四种组合完整真实桌面、游戏和功能／外观／动效均未合格。第七失败诊断必须随新提交重新原生执行。**

2026-10-04 05:33（Asia/Hong_Kong）更新：workflow 标准授权已完成，候选 `ab54c5f` 已推送 master，main 以 cherry-pick 同步为 `db13257`。Linux run `37154520531` 在两个原生架构完成依赖安装后，均停在 FRP 测试夹具的初始下载等待；已取消并保留原始日志，修复夹具后重新运行完整测试，不跳过原生校验。此前 OAuth 拒绝推送和网络失败仍是历史记录；尚无本轮 Linux 成品或完整桌面验收，尚未发布。

2026-10-04 06:05 更新：run `37155930845`（`0d71da0`）双架构各已有 320 条可见通过、1 条旧 Windows EXE 更新夹具失败，停在重复等待 POSIX spawn 的测试后取消。原日志 ZIP SHA256：`d720d786ab6cac2249280fa85f7a4e9dc0c7334a2d3fe0f67c3beac60286db52`。等待、超时与旧平台夹具已修正；8 项 Linux 专用测试执行通过不能替代全套完成。生产构建步骤为 skipped；GitHub 为跳过步骤填入取消时间戳，最初汇总将其误判为执行的记录已另存并纠正，原始日志保持不变。须完整重跑，尚无安装包或桌面验收。

## 当前证据

| 环境 | 当前原生构建 | 当前真实桌面、游戏与完整验收 |
| --- | --- | --- |
| Ubuntu 24.04 x64 | 第六三格式、内嵌 source69／runtime44.3 和原生解压检查通过 | Xvfb 实际应用在 llvmpipe 上 WebGL 失败；真实桌面／游戏未验 |
| Ubuntu 24.04 ARM64 | 第六三格式、内嵌 source69／runtime44.3 和原生解压检查通过 | Xvfb 实际应用在 llvmpipe 上 WebGL 失败；真实桌面／游戏未验 |
| Ubuntu 26.04 x64 | 使用第六 24.04 x64 原生包；无该 OS 独立构建 | Xvfb 实际应用在 llvmpipe 上 WebGL 失败；真实桌面／游戏未验 |
| Ubuntu 26.04 ARM64 | 未执行 | 无 hosted 预检；真实桌面／游戏未验 |

Linux 专项测试在当前 Windows 开发机上为 7 项通过、1 项跳过，类型检查通过。通过项覆盖凭据保护、ELF 架构、TAR 路径与完整性、包身份和 AppImage 安全拒绝；跳过项是在 Linux 真正运行更新 shell、交换文件与失败恢复的回归。它们不证明 Linux GUI、密钥服务、系统安装器、游戏或帧率已通过。

已加入的入口与验证器：

- [原生打包](../scripts/pack-linux.cjs)：当前架构编译与打包，不用另一架构的运行库拼包。
- [运行库检查](../scripts/verify-linux-runtime.cjs)：ELF、执行权限、游戏窗口助手、Java 桥、ASAR 与隐私文件边界；新修订直接运行目标 ELF 的 Node 模式观察 platform／arch／Electron 版本，不添加图形或 sandbox 绕过。
- [包检查](../scripts/verify-linux-package.cjs)：三种包干净解压、逐文件 SHA256 和执行位核对；新修订核对各提取包的内嵌 Git 提交、schemaVersion=1 和实际目标 ELF 运行时身份，第六实际逐格式通过；第七新 QA 仍待原生运行。
- [桌面验证](../scripts/verify-linux-desktop.cjs)：真实桌面与夹具 smoke 分开记录，保留原始视频和时间；报告仍列出未覆盖项。
- [Linux 工作流](../.github/workflows/linux-build.yml)：Ubuntu 24.04 两架构原生打包；24.04 两架构及 26.04 x64 的 Xvfb smoke；四种真实桌面组合须另有对应自托管机器。

## 接续原生构建

在对应架构的 Ubuntu 上使用 Node.js 24、npm 与 JDK 17。JDK 用于编译随包 Java 桥；实际游戏所需 Java 版本由启动器另行选择或下载，并须核对真实架构。以 Node `process.arch` 为准：x64 对应 Debian 包的 `amd64`，ARM64 对应 `arm64`。x64 包和 ARM64 包必须分别原生构建。

以下命令用于新提交在独立工作目录的重跑；第六 source69 的构建结果包含已实际验证的内嵌身份，第七新 QA 尚需运行，历史原包不重写。先检出最终候选并记录完整提交 SHA，安装构建依赖：

```sh
sudo apt-get update
sudo apt-get install -y build-essential libx11-dev squashfs-tools libfuse2t64 libgtk-3-0t64 libnss3 libxss1 libasound2t64 libgbm1 libxtst6 libnotify4 libsecret-1-0
node --version
node -p process.arch
java -version
git rev-parse HEAD
npm ci
npm test
npx tsc --noEmit
npm run license:check
node scripts/build-bridge.cjs
node scripts/verify-bridge-exit.cjs
npm run dist:linux
```

`dist:linux` 会构建 Java 桥、编译 Linux X11 窗口助手、完成生产构建，再生成当前架构的以下文件，并调用包验证器：

| 文件 | 用途 |
| --- | --- |
| `KAMUCL-1.1.11-linux-x64.AppImage` 或 `…-arm64.AppImage` | 单文件 AppImage |
| `KAMUCL-1.1.11-linux-x64.deb` 或 `…-arm64.deb` | 系统安装包；内部架构为 amd64／arm64 |
| `KAMUCL-1.1.11-linux-x64.tar.gz` 或 `…-arm64.tar.gz` | 用户目录便携包，根目录为 KAMUCL |
| `SHA256SUMS-linux-x64.txt` 或 `SHA256SUMS-linux-arm64.txt` | 三种成品的 SHA256 |
| `linux-proof-架构-packages/summary.json` | 源提交、架构、包大小、SHA256 与解压检查结果 |

输出在 `release/`。构建器保留完整 Electron 运行库和资源；AppImage 使用项目自己的 [AppRun](../scripts/linux-AppRun.sh)，不自动关闭 Chromium sandbox。最终发布还须核对成品与最终提交一致，不能把补改前的包绑定补改后的提交。

## 安装与启动

以下示例仅适用于后续得到且已校验的成品，并不是现有公开下载地址。先检查架构，再与交付的 SHA256 文件核对；不要将 x64 包安装到 ARM64 主机。只下载一种包时可以用 `--ignore-missing` 跳过其他未下载的包，但所使用包必须实际出现并校验成功。

```sh
taskArch="$(node -p process.arch)"
sha256sum -c "SHA256SUMS-linux-${taskArch}.txt" --ignore-missing
```

### DEB：推荐的系统安装路径

使用桌面系统安装器打开 DEB 并确认安装，或由用户明确执行：

```sh
sudo apt install "./KAMUCL-1.1.11-linux-${taskArch}.deb"
```

APT 会解析包的依赖；不能把 `dpkg-deb -x` 的解包结果当作完成系统安装。当前打包依赖的 electron-builder 安装脚本会处理桌面入口、sandbox 权限，并在系统支持时安装当前应用的 AppArmor userns profile；这些路径与安装结果仍需在实际 Ubuntu 24／26 主机验证。

应用作为普通用户从桌面入口或 `kamucl` 启动。不要以 root 身份运行 GUI。系统安装器所需权限由用户确认，启动器不会静默提权或直接写入 `/usr`、`/opt`。

### AppImage：正常 FUSE 启动与手动提取

正常挂载启动需要 FUSE2 兼容库和可用的 `/dev/fuse`。Ubuntu 24／26 使用包名 `libfuse2t64`；更新前读取内嵌包身份还需要 `squashfs-tools` 提供 `unsquashfs`。FUSE3 不能代替本成品要求的 FUSE2 兼容库。相关背景见 [AppImage 官方 FUSE 说明](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)。

```sh
sudo apt install libfuse2t64 squashfs-tools
chmod +x "KAMUCL-1.1.11-linux-${taskArch}.AppImage"
"./KAMUCL-1.1.11-linux-${taskArch}.AppImage"
```

缺少 FUSE 时，AppImage 的手动提取路径仍保留，可在独立用户目录尝试：

```sh
"./KAMUCL-1.1.11-linux-${taskArch}.AppImage" --appimage-extract
./squashfs-root/AppRun
```

也可使用 AppImage runtime 的 `--appimage-extract-and-run`。提取只解决文件系统挂载问题，不会绕过 GTK、图形驱动或 Chromium sandbox 的系统要求；当前候选尚未对这些运行路径进行原生验收。

**从解压模式运行的 AppImage，或 FUSE 不可用的环境，会拒绝受控 AppImage 自动替换。** 原程序与已下载包保留，用户可以手动安装 DEB、提取新包，或改用便携 tar.gz。此限制避免 extract-and-run 的外层进程退出后，真正的 Electron 仍运行，导致恢复时出现新旧实例同时运行。显式提取后的目录运行也不能据此承诺已通过自动更新及备份回退验收。

### tar.gz：用户目录便携运行

在独立且可写的目录保留整个 KAMUCL 文件夹：

```sh
tar -xzf "KAMUCL-1.1.11-linux-${taskArch}.tar.gz"
./KAMUCL/kamucl
```

保留资源文件、目录结构与执行权限。FAT／特殊挂载的 `noexec` 策略或人为去掉执行位可能阻止启动；更新时会在替换前检查执行权限。便携目录放入 `/usr` 或 `/opt` 会按系统安装路径处理，接续验收使用独立用户目录。

## 桌面依赖与安全限制

Ubuntu Desktop 通常已具备多数图形与音频库。对于精简桌面，当前候选的图形 smoke 使用 GTK3、NSS、Xss、ALSA、GBM、X11 和 D-Bus；用户目录包仍依赖主机库。可据缺失库诊断安装：

```sh
sudo apt install libgtk-3-0t64 libnss3 libxss1 libasound2t64 libgbm1 libx11-6 libxtst6 libnotify4 libsecret-1-0 xdg-utils
```

上述包名按 Ubuntu 24／26 的 t64 命名使用；其他发行版的包名、ABI、桌面策略与系统安装方式未纳入本轮认证。GTK3 包可查 [Ubuntu 26.04 官方包页](https://packages.ubuntu.com/resolute/libgtk-3-0t64)，ALSA 包可查 [Ubuntu 24.04 官方包页](https://packages.ubuntu.com/noble/libasound2t64)。仅安装共享库不等于已具备图形桌面、D-Bus 会话、音频设备或有效 GPU。

应用和游戏窗口控制以 X11 或 Wayland 会话中的 XWayland 为当前基线。需要实际可用的 `DISPLAY`；纯 Wayland、禁用 XWayland或管理员强制覆盖为纯 Wayland 的情况未获完整支持结论。窗口助手只匹配本次游戏 PID，发送正常关闭消息并观测焦点，不通过强杀游戏模拟正常保存。关闭启动器后游戏继续运行、游戏正常保存及焦点交接仍须实机验证。

Ubuntu 24／26 具有 AppArmor 对非特权 user namespace 的限制；浏览器 sandbox 使用该能力，未获应用 profile 允许的便携包可能因此被系统阻止。KAMUCL 的 AppRun 和桌面入口**不自动添加 `--no-sandbox`，也不为用户关闭全局 AppArmor 或 userns 限制**。优先使用正常 DEB 安装及每应用策略，并保存真实系统错误。相关机制见 [Ubuntu AppArmor 文档](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/) 与 [Ubuntu 支持版本安全功能表](https://documentation.ubuntu.com/security/security-features/security-features-tables/)。

工作流的 Xvfb smoke 只在一次性 GitHub hosted VM 中暂时调整 userns 限制，Chromium sandbox 仍保留。该配置不能复制成用户安装要求，也不能拿它替代默认安全策略下的真实桌面验收。

## 更新、凭据与数据保留

DEB 的更新流程下载并校验对应架构包，再在后续启动交给系统安装器。打开安装器成功只代表 `awaiting-system-confirmation`，**不代表自动更新完成**；用户取消、安装失败、系统没有 DEB handler 或仍运行旧版本都必须准确报告，原下载包保留。完成与否需核对系统安装结果及新版本实际启动。

正常 FUSE AppImage 与用户目录 tar.gz 更新使用对应安装形式的官方资产，核对大小、SHA256、版本及架构后才进入替换。更新助手等待原启动器退出；启动确认超时后只操作受控启动器 PID 与 starttime，待新启动器退出才恢复原应用，不停止游戏进程组。Linux 上的真实更新、超时恢复、取消及异常退出仍未完成验收。

账户令牌只允许受保护的 GNOME libsecret 或 KWallet 后端持久化。没有有效系统密钥服务、密钥服务锁定或后端为 `basic_text`／未知时，新登录令牌仅用于本次会话；已有密文保留。应使用正常桌面 D-Bus 会话并启用、解锁 GNOME Keyring 或 KWallet，再验证登录与重启恢复。联网工单的不可重复所有权密钥无法安全保存时会拒绝提交。机制背景见 [Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage)。

成品只包含应用资源与依赖，不包含玩家账户、图片、收藏、设置、人物计数、游戏目录、私有整合包或存档。Linux 常规用户数据位置由 Electron 的 `app.getPath('userData')` 决定，通常在 `~/.config/kamucl`；环境配置可改变位置，应以当前应用报告为准。接续验收始终用独立测试 profile 和游戏目录，保留原用户目录及未提交文件；`pelican-bicycle.html` 不属于本轮交付。

## 接续验收与发布条件

在 Linux 原生桌面准备 Node.js 24、`mesa-utils`、`x11-utils` 与带 X11 采集能力的 `ffmpeg`，先完成并保留当前提交的包验证结果，再执行：

```sh
node scripts/verify-linux-desktop.cjs "${taskArch}"
```

验证器拒绝 root、Xvfb／Xvnc／Xephyr 和 llvmpipe／SwiftShader 等软件渲染器作为真实桌面证据。它会运行当前共享 GUI 模块，覆盖四主题、皮肤／彩蛋、图片／收藏与导入选择等操作，保留原始桌面录像和帧时间。录屏的请求采样率不等于产品已达到目标帧率，低帧率、真实停顿和失败记录不得改写为通过。

GitHub hosted 的 `--fixture-smoke` 单独标记 `nativeDesktop:false`。真实桌面作业需要对应架构及 OS 标签的专用自托管 runner；`desktop_qa` 默认关闭。Ubuntu 26.04 ARM64 没有被本工作流的 hosted smoke 覆盖，必须在真正 ARM64 的 26.04 桌面补证。

尚须补齐的必测证据：

1. 四种 OS／架构组合的原生构建、三类成品干净解压、实际安装与启动、SHA256 和最终源提交。
2. 默认 AppArmor／userns 策略下 DEB 安装、FUSE AppImage 与提取路径；GTK、XWayland、密钥服务和音频环境。
3. 完整皮肤编辑手势、PNG 导出重读、所有关闭意图、失败恢复及真实账号登录后重启。
4. LOGO 动作与计数、键盘焦点、隐藏恢复、资源释放、原始帧率与实际声音听感；独立视觉／交互／动效评分各自达到 9／10。
5. 真实 Minecraft 下载、当前架构 Java 与 natives、世界启动及磁盘存档、正常关窗、关闭启动器后游戏继续。
6. 社区两平台真实服务、用户私有 PCL 包在隔离目录的完整导入与实际游玩、Sakura／Terracotta 与真实远端连接。
7. 正式可信资产的更新、DEB 系统确认、拒绝篡改、失败恢复、重启持久化及无同时运行的新旧实例。

当前桌面验证器也显式保留其中若干未覆盖项；单个脚本 `complete:true` 不会自行成为完整平台合格证明。发布前由最终截图、原始录屏、测试记录和独立评审汇总形成同一提交、同一成品的验收记录，再通过 [平台发布门槛](../scripts/platform-release-gate.cjs)。原生证据尚未补齐时，保留候选和成品状态，准确报告未完成环节。
