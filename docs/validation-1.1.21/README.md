# KAMUCL 1.1.21 验收与交付

本批依据用户DOCX的14组要求修复兼容性、社区下载队列、个性化与导航、更新镜像、嵌套包、默认材质包、图片及服务器版本显示。仅交付Windows x64和Mac ARM64，Electron44.3.0不变，资源占用优化暂停。

- [需求与原样例边界](REQUIREMENTS.md)
- [构建、测试和源码绑定](BUILD_TESTS.json)
- [Windows独立评分](INDEPENDENT_WINDOWS.json)
- [Mac实际验收与未通过](MAC_ACCEPTANCE.json)
- [Mac修改范围独立评分](INDEPENDENT_MAC.json)
- [历史失败](HISTORICAL_FAILURES.md)
- [模块说明](MODULES.md)
- [原始代表图及SHA绑定](EVIDENCE_BINDINGS.json)
- [后续测试脚本与原成品绑定](FINAL_QA_FOLLOWUPS.json)

合理性、功能性、外观分开评分，适用的每项须不低于8.5，不使用平均分。后端没有UI表面时外观明确不适用。分数仅适用于评审实际看过的证据，不代表全部功能或完整平台通过。

Windows原生证据来自最终成品EXE/ASAR、RTX5080硬件GPU和观察到的DPI120/系统125%；补充离屏真实renderer的四类主题、960×620/1366×768、100/125%页面缩放矩阵。六主题社区与gallery业务夹具分开标明。旧黑橙色原生DWM次级文字偏弱在1.1.20同机原图也存在，不能把离屏对比代替桌面效果。

Mac为macOS26 ARM64原生云桌面，最低macOS13尚无实体测试。APP/DMG、实际网络下载、游戏、更新和工具的job逐项列明；测试失败不会因共享源码或Windows通过而改为Mac通过。游戏1.20.1 NSGL失败、现代游戏画面不足、显示恢复、人工听感和完整帧率单列。仅ad-hoc签名，未Developer ID或公证。

真实服务：官方API/CDN资源与正式prepare/commit专项；夹具：合成整合包、受控IPC、合成资源及本地HTTP；故障注入：保存/传输/取消/回滚；原生桌面：所属APP窗口。它们不混为同一验收。

本目录只提供去私有内容的摘要和少量未改字节的原始代表图。全部原始证据保留在私有独立验收目录，原截图时间、录像、帧时间不重判。公开图里合成测试目录标签可能存在，不包含原用户整合包、存档、私钥、令牌或真实玩家配置。逐文件大小/SHA与解码检查不冒充人工看过每一帧。

最终标签、独立master/main提交、源码和成品差异、包大小与SHA256由Release的DELIVERY-1.1.21.json和SHA256SUMS.txt绑定。公开附件与匿名完整下载在发布后另行核对，不提前写成成功。

原包补验应通过既有CI运行及原始artifact逐字节复核。本次授权运行当时的master为263df7aacacbb4577e2f8c0f0232cec5d1a4b9b1，来自官方仓库的GitHub Actions workflow_dispatch、refs/heads/master，且显式设置resume_mac_arm64=true；HEAD与GITHUB_SHA一致。最终发布提交另增验收与交接文档，严格七路径源码差异守卫保持原样，因此当前master或最终标签不能直接重跑该冻结复用工作流。检出263df7可运行合同测试或隔离driver，但这属于新的诊断执行，不能称为重放历史授权CI。原工作流运行ID、实际结果、成品及源码差异分别绑定。
