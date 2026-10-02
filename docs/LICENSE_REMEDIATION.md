# 实现替换记录（v1.0.60 已验证）

用户确认没有 PCL 下载移植及历史 VoxLink app-desktop 的额外授权。
本轮替换下载、联机和皮肤实现，不能以补署名代替授权。

- download.ts 改为基于应用接口与 HTTP Range 语义的新实现，保留完整校验、四路分段、取消续传、换源、本地复用和限流。
- 原有 Go 移植模块改为新的 Node 实现；协议部分依据 VoxLink Java revision 6b11d93，适用 LGPL，保留作者、许可原文与构建说明。
- 皮肤模型采用 MIT skinview3d 3.4.2，转换采用 MIT skinview-utils 0.7.1，交互由 KAMUCL 适配。

这是当前工作树的工程替换记录，不宣称洁净室开发或绝对法律清白。
Git 历史及旧发行版不会因此追溯获得授权；旧版重新分发需单独核实。
发布检查继续保留。完整回归 386 项、许可材料 3 项、类型检查及生产构建通过。
生产皮肤页面已检查浅色、深色、行走/待机、缩放和回正。
本地双端房间、认证 UDP、TCP 和 TURN 测试通过；不等同于所有公网 NAT 均已验证。
对应源码 ZIP 已逐项校验 506 个文件；独立目录安装依赖、构建桥接模组与生产界面通过。
Windows EXE 冷/热启动入口、ZIP 解压入口与 ASAR 一致性检查通过。
Mac ARM64、Intel 的 APP ZIP / DMG 在各自原生 CI 上构建，挂载 DMG 后主界面启动验证通过。
Mac 沿用临时签名，未进行 Apple 公证。

发行源码提交：578ea885b0d9f1169fa3ef90ba3c9a061ccbd6be。
Mac 构建记录：https://github.com/kamubaba-i/KAMUCL/actions/runs/34595528167 。
发行附件及校验值：https://github.com/kamubaba-i/KAMUCL/releases/tag/v1.0.60 。
本记录为发行后的验证补充，不改变上述源码标签与对应源码包。
