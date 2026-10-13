# 对应源码及重新构建

仓库：https://github.com/kamubaba-i/KAMUCL
新发行版应附带 KAMUCL-版本-source.zip，对应同名版本标签。
源码包含应用及 LGPL 部分、桥接 MOD、原生辅助程序、视觉资产、脚本、锁文件与许可。

1. 安装 Node.js 24、npm、完整 JDK 17 或更新版本；JAVA_HOME 和 PATH 指向 JDK，
   确认 javac 与 jar 可用。完整构建会编译桥接和离线皮肤组件。
2. 在源码根目录运行 npm ci。
3. node scripts/build-bridge.cjs 从 Fabric Maven 和 Maven Central 获取固定版本
   编译依赖并校验 SHA256。离线可用 KAMUCL_BUILD_LIBS 指向同坐标 Maven 目录。
4. 修改 src/main/core/voxlink 或其他源码，运行 npm run build。
   Windows 原生程序由系统 .NET Framework csc.exe 编译；Mac 不需要它。
5. npm start 启动修改版。Windows 用 npm run dist:win；本批 Windows 使用 Electron 44.3.0。
   Mac 构建使用 package.json 固定的 Electron 版本及 npm run dist:mac，
   与 Windows 共用界面与业务代码。本批目标为 Windows x64 和 Mac ARM64；
   原生构建、实际验收范围和未覆盖项以本版交付记录为准，不能以同源推断通过。
6. .github/workflows/mac-build.yml 描述原生构建、签名、APP ZIP 与 DMG 验证。
   npm test、npx tsc --noEmit 与 npm run license:check 提供本地检查。
7. scripts/build-offline-skin-agent.cjs 使用 javac --release 8 构建原创
   GPL-3.0-or-later 离线皮肤提供器；npm run build 自动构建并复制该 JAR。
   authlib-injector 由游戏首次使用时从官方来源校验下载，不包含在成品中。

LGPL 部分提供完整源码，可修改并重新编译组合应用，无需 KAMUCL 私有签名密钥。
不禁止为调试修改进行逆向工程。Mac 修改版可自行 ad-hoc codesign。
npm 依赖由锁文件固定，npm ci 需要网络。源码包不包含账户、游戏和下载缓存。
本说明不追溯确认历史版本授权。对应源码交付仍需实际完成并验证。

## 1.1.22 分发的运行时与安装插件源码

本版另附 `KAMUCL-1.1.22-runtime-source.zip`，供给与 Electron 44.3.0 对应的
Electron 原始源码、固定 FFmpeg revision 的完整源码、构建配置及 Electron 补丁。
其来源、固定坐标和 SHA256 见 `audit-reports/RUNTIME_SOURCE_PROVENANCE.json`。
Windows 便携安装器所用 StdUtils、Nsis7z 与 7-Zip 的完整原始源码位于
`licenses/source/`，相关声明及完整许可位于 `licenses/`。
这份补充包不包含完整 Chromium 源码，也没有声称重新构建运行时即可产生字节一致的二进制。
本版成品保留各平台原始 Electron/Chromium notices；上述运行时源码与应用源码分别提供。
请将补充包与发行说明、对应源码及 SHA256 清单一并保存；不以未兑现的书面供源承诺代替实际附件。
