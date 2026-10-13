# KAMUCL 1.1.22 许可证与实际分发材料审计

这是工程合规审计，不是“所有历史版本/素材均合法”的承诺。按使用方式分别检查代码复制、bundle/native链接、独立Agent/进程、网络接口、构建工具及实际二进制分发。风险等级、证据置信度与法律结论分开。

## 清单与真实覆盖

补丁前基线锁文件有552个非根package条目，均含许可证声明；本机437个条目实际安装、版本与锁相符，115个主要平台可选条目未安装。基线是沿用1.1.21依赖版本的采集工作树，根包版本未另存，不冒称原发行包或clean Git提交。它保存在`DEPENDENCY_LICENSE_BASELINE_1.1.21.json`。

补丁后已重新读取实际当前锁与安装目录：adm-zip0.6.1、undici6.28.1、sharp0.35.5、source-map-js1.2.2；仍为552个package条目、437个实际安装、0安装版本不符、115个未安装条目。当前锁SHA256为`7138c2aae62d6c6f56a3bb8e30092afa3c9caa5558929fa3d50dbee9678891af`。12组真实保留/安装许可正文全部一致（@iarna仅尾端空白差异）；见`CURRENT_LICENSE_TEXT_VERIFICATION.json`，不是只核metadata。仍有22个安装目录未在限定搜索深度找到LICENSE/NOTICE候选，不将其直接判无许可：例如平台Koffi包由主Koffi许可覆盖，部分构建包声明/上游材料需继续核对。

`DEPENDENCY_LICENSE_INVENTORY.json`逐项记录declared/installed/version/dev/optional/许可文件哈希与真实生命周期脚本；`PACKAGED_LICENSE_INVENTORY.json`来自**原正式1.1.21**包，不冒充新包：Windows ASAR435项、Mac ASAR508项，各有6个实际Node包，包括相应架构Koffi原生子包、@iarna/toml、adm-zip、koffi、undici、ws。Vue/Three/skinview-utils作为打包代码进入前端，不能因不再有独立package.json就认为未分发。两个ASAR未发现sharp/@img/esbuild/electron-builder/vite构建包目录。

原Windows外部运行时完整保留Electron MIT 1,096字节、Chromium综合许可20,472,830字节，精确SHA在清单中。综合HTML有780个条目，含跨平台/可选组件；这不是780个实际二进制库的证明。没有对所有Chromium组件做逐个二进制归因或再编译。

## 实证发现与整改

| 编号 | 风险/置信度 | 文件/行号与证据 | 适用条件与处理 | 状态 |
| --- | --- | --- | --- | --- |
| L-01 | HIGH工程发布材料缺失；高 | 原Mac ZIP中央目录没有任何外部LICENSE/NOTICE/COPYING命名条目；Mac ASAR也无Electron/LICENSES.chromium.html；`scripts/pack-mac.mjs:23-40`旧打包流程仅构建/签名/归档 | Electron MIT及所分发Chromium库需相应通知。主任务增加从本次Darwin官方dist复制、哈希及APP/ZIP/DMG一致性验证 | 原1.1.21缺失已确认；源码修复及新成品验证分开，不将旧包改记通过 |
| L-02 | MEDIUM材料缺口；高 | 原Windows包删去Koffi vendor目录，原native代码 `node_modules/koffi/src/koffi/src/ffi.cc:36`等包含napi.h；node-addon-api为header-only实现 | 新增Node API两MIT原文，与锁定Koffi3.2.1 tar包完整性及固定上游文本逐字归一化相等。不能把许可文本同版本直接当header代码revision证明 | 已补真实文本和来源hash，待新包静态确认 |
| L-03 | MEDIUM材料/供源缺口；高 | 原EXE静态提取 `$PLUGINSDIR/StdUtils.dll`102400B与`nsis7z.dll`434176B；`portable.nsi:80`/`extractAppPackage.nsh:97`调用；StdUtils.nsh第2-19行LGPL2.1 | 旧材料仅GPL3/LGPL3，不完整覆盖插件；新增LGPL2.1、精确NSIS COPYING、StdUtils声明/clarification、7Zip19原文、3个完整原始源归档，总1,755,398B随包 | 当前文本/归档及12项材料测试通过；不是旧EXE法律清白认定 |
| L-04 | MEDIUM对应运行时source范围不足；高 | `release/win-unpacked/ffmpeg.dll`、Chromium notice的ffmpeg条目；原CORRESPONDING_SOURCE仅描述应用源码 | LGPL来源与匹配build选项需独立提供。已沿Electron44.3.0→Chromium152.0.7977.78→FFmpeg固定revision取得完整source及Electron补丁/DEPS/build材料 | `KAMUCL-1.1.22-runtime-source.zip`已生成；正式附件、SHA和匿名下载核对由最终交付验证，不能仅有URL就称已供源 |
| L-05 | LOW门禁覆盖误读风险；高 | 旧`check-licenses.cjs:5-21`只检查少量文件存在/模型哈希/SPDX；`license-status.json:3-4`仅replacement scope | 当前门禁补全文本/原上游SHA、完整plugin源归档SHA、路径边界；仍不将材料检查说成全树版权扫描 | 已整改，12/12测试；素材/历史/成品仍由独立记录控制 |
| L-06 | MEDIUM，非当前代码确认侵权 | `docs/LICENSE_REMEDIATION.md:3-11`历史来源问题；COPYRIGHT_AUDIT素材A-01至A-04 | 补作者名称、LICENSE或当前替换都不能追溯证明旧未授权实现/素材清白；缺授权标待核实 | 保留原记录，不重新分发旧版时推断已解决 |

### 精确来源与触发义务

| 部分 | 实际使用 | 条件及已保留材料 |
| --- | --- | --- |
| 根原创代码MIT | 应用代码及原生辅助程序作者声明 | 版权/许可保留，免责声明；不是整个第三方组合的通用许可证 |
| Vue/Three/skinview3d/skinview-utils/ws/adm-zip/undici/koffi | 源码bundle或Node/native包 | MIT版权和完整许可；已比较12个当前主材料与安装上游文本，@iarna仅尾端空白差异，不作为违规；新增头文件归属notice |
| @iarna/toml | 真实runtime独立包 | ISC版权、许可、免责保留，与MIT不能只按名称混为同一个许可证 |
| VoxLink Java协议适配 | TS源码改编并合并bundle | LGPL3对应源码、可修改/重组/调试逆向权限及通知；完整KAMUCL源与构建脚本用于重组，不直接要求所有原创前端改LGPL |
| 离线皮肤Agent | 独立游戏JVM Agent/loopback服务 | GPL3组件源码、构建脚本、完整条款保留。组合是否构成派生需看接口/代码联系，不能凭同一个发行包就推整个应用GPL |
| authlib-injector | 官方哈希校验按需下载，游戏JVM Java Agent、HTTP接口，非成品嵌入 | 上游AGPL3+AUTHLIB-INJECTOR明确例外涵盖未改二进制独立捆绑/IPC/Java Agent使用。例外仅按实际条件适用，库自身AGPL义务仍保留；改库/构建服务需重审。新增固定commit完整例外原文，不将任意未来版本算已核 |
| StdUtils 1.14 | 不改DLL经NSIS接口加载；作为EXE数据payload | LGPL2.1+原作者clarification允许caller自选许可证，库本身通知/源仍提供。原clarification保留原文，不擅自纠正其中“GPL2.1”措辞；上下文依其LGPL文本分析 |
| Nsis7z 19/7Zip19 | 实际未改x86-unicode DLL；只用7z解压 | 官方19.00 DLL与原EXE提取DLL字节完全相等；供应插件完整source+7Zip19完整source/project及LGPL/按文件条款。SDK公共领域声明不能泛化为全部7Zip C++代码 |
| NSIS/System | EXE wrapper；原EXE静态显示Deflate压缩 | 原COPYING包含zlib/bzip2/CPL/LZMA链接例外，完整保留。不能因COPYING列CPL就推本次Deflate wrapper启用LZMA组件或整个launcher为CPL |
| FFmpeg共享库 | Electron官方release配置动态库；现Windows与Mac实物路径核查 | LGPL2.1+与对应source/许可保留。固定win/x64和mac/arm64源配置GPL/NONFREE/VERSION3=0；不是二进制重编译证明，也不赋予商用codec专利权 |
| sharp/libvips/@img | 开发/图片生成，原ASAR无这些包 | Apache2/LGPL/特定兼容组合按实际工具分发判断；普通渲染图像不因此自动变成LGPL代码。将工具/库二进制再打包时必须另供材料/source |
| BlueOak/Python/CC-BY构建依赖 | lock/本机工具，如caniuse-lite | 原ASAR未见这些包目录。源码锁文件不是这些库完整代码分发；仍要核查未来bundle引入/额外工具交付，CC-BY资料需署名，不能只看元数据宣称全通过 |
| Fabric-loader/Gson | 固定版本编译期依赖 | 原桥接JAR条目检查未见其类嵌入；实际游戏用户下载/安装遵守各自包许可，不能混同launcher自带源复制 |
| Temurin/Zulu/Minecraft及模组包 | 用户选择后从官方/配置来源下载，不嵌入该启动器成品 | 保留发行物原license/notice；SDK/游戏资产/模组的许可与平台条件分别适用。未取得每个未来用户自选模组/服务授权 |

公共主源已核：[StdUtils固定1.14源码](https://github.com/lordmulder/stdutils/tree/4e1117321001e54dcd2c52f72d3c359d5215e426)、[Nsis7z作者页/19.00](https://nsis.sourceforge.io/Nsis7z_plug-in)、[7Zip固定19源码](https://www.7-zip.org/a/7z1900-src.7z)、[authlib准确例外](https://raw.githubusercontent.com/yushijinhun/authlib-injector/879c6cbfce848f37e7da656d59a20cb93bd7102b/AGPLv3-with-authlib-injector-exception.txt)、[Electron固定DEPS](https://raw.githubusercontent.com/electron/electron/v44.3.0/DEPS)。所有public下载均为读取资料，没有用发现的凭据登录/测试，也没有执行下载包中的install/build脚本。

## 生命周期、二进制与工具限制

实际安装package的preinstall/install/postinstall元数据和脚本文件单独登记。esbuild等下载/定位平台二进制，Koffi的CNoke可触发CMake/原生编译，electron-winstaller选择已有7z工具；这些行为不是恶意的充分证据。审计没有运行npm install/ci或这些钩子。新版本正式构建需由主任务在已审查、固定锁的环境中进行，其执行不能冒充审计时已跑过。

Koffi平台包的MIT text由主包覆盖，额外Node headers材料已补；独立FFmpeg、GPU回退、Chromium及Electron资源没有为消除风险而删除。系统DLL/SDK、Mach-O签名及codec专利许可仍按各自条件分析，不把ad-hoc签名等同于版权授权。

专用扫描工具未运行；只使用Git、Node/Python内容读取、标准ZIP/ASAR解析及已安装7-Zip静态列目录/精确提取DLL，不加载、启动或调用其代码。锁中其他未安装平台包的源码/完整文本不宣称已逐个验证；完整Chromium dependency graph不在本次source附件内。

## 分发场景结论

| 场景 | 条件性结论 |
| --- | --- |
| 个人/内部使用 | 部分分发义务可能尚未触发，不免除授权、账号/平台与素材条件；不证明现有全部历史使用合法 |
| 公开应用源码 | 保留每个部分原许可/作者/变更和源码边界；历史来源/素材仍待核实，不可只给根MIT |
| 免费分发二进制 | 仍有MIT/ISC/LGPL/GPL通知、实际对应源与重组条件；免费不能免除这些义务或Minecraft资产政策 |
| 商业销售 | 上述义务仍适用；素材、商标、codec专利、服务合同/地域另核，当前不能无条件给“可商用”结论 |
| SaaS/远程服务 | MIT/LGPL仅网络调用一般不自动触发全app开源；改AGPL服务/向网络用户交互时按AGPL13及准确例外判断，不用“用过AGPL=整项目开源”捷径 |

发布前技术门槛：新包实际携带运行时许可、Koffi/NSIS文本、3完整plugin源归档；独立runtime-source附件真实公开且哈希匹配；完整对应应用source/构建方式与最终commit绑定；已确认应用身份/秘密问题由CLIENT_ID/SECURITY报告清除。素材/历史/商业授权缺口明确保留，技术门禁通过不能代替权利人或法律专业人员判断。
