# CurseForge 整合包 CDN 补全验证（1.1.4）

## 修复范围

整合包内及本地都没有精确副本、文件仍可用、元数据和独立下载地址接口都未提供 URL 时，按 fileID 整除/取余 1000 与编码后的文件名构造 edge.forgecdn.net 地址。使用不带 Range 的 HEAD 请求，手动处理重定向，只在收到 302 时将地址交给原下载器。探测支持八秒超时及用户取消。

文件大小、SHA1 校验、资源类型目录分配、Modrinth/CurseMaven/手动补充回退均保留。此次未扩展文档中的可选社区单文件下载路径。

## 自动化验证

- `npx tsc --noEmit` 通过。
- `npm test` 最终 532/532 通过。首轮一项 TURN 测试遇到 Windows 随机端口 `EACCES`，该测试单独重跑以及全套重跑均通过。
- 新增 URL 拆分/编码、无 Range 的 HEAD 探测、不跟随跳转、HTTP 失败/连接中断、取消、真实安装编排、普通文件不触发探测、不可用文件不探测、同大小错误内容被 SHA1 拒绝及失败回滚验证。
- 既有包内/本地复用、API 补链、Maven 补全、手动补充流程回归通过。

## 真实网络验收

执行 `node --import tsx scripts/verify-curseforge-cdn.ts`；可通过 `HTTPS_PROXY` 配置验证脚本的网络代理。使用独立临时目录及最小本地原版运行环境，真实导入文档指定的四个 CurseForge 文件。探测、CDN 下载、大小/SHA1 校验及文件安装均使用项目实现；没有启动游戏。

四个文件的 API 元数据 `downloadUrl` 均为 null；全部经过 CDN HEAD 302 探测并真实下载，安装后重新计算的大小及 SHA1 均与独立查询的 MCIM 元数据一致，没有触发手动补充。详见同目录 `curseforge-cdn-1.1.4.json`，含 CDN 请求证据。

文档列出的 `D:\test` 两个原始整合包在此机器上不存在，因此没有宣称完成两个完整包的端到端导入验收。验证覆盖其四个问题文件的真实自动补全。

文档将 Vulmoons ZIP 列为应进入 mods 的文件，但实际 CurseForge 项目 1359195 的 classId 为 12（资源包）。正确安装路径为 `resourcepacks/Vulmoons calaclysm remake_0.5.zip`；另一个 Create Style ZIP 同样进入 resourcepacks，两个 JAR 进入 mods。

## 构建说明

应用构建成功。默认打包下载 Electron 时遇到 GitHub 直连超时，改用本机已安装的同版本 Electron 44.3.0 继续打包，未改变项目依赖版本或运行时内容。

打包后的硬件及软件渲染界面验证均通过，覆盖版本显示、首页、皮肤预览、本地图片、IPC、原生模块及扫描工作线程。
