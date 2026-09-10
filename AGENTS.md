# 项目默认交付流程

用户已明确授权：每批修改完成后，默认完成验证、打包，并更新到 https://github.com/kamubaba-i/KAMUCL ，无需再次询问是否打包或发布。

- 每批功能或修复递增版本尾号，同步 package.json、package-lock.json 根包版本、内置更新日志。更新日志日期必须采用本地时间 YYYY-MM-DD HH:mm，精确到小时和分钟。
- 运行与改动相关的验证及构建；生成 Windows 便携 EXE、ZIP，验证便携包启动和 SHA256。
- 提交项目源码并推送 origin/master；沿用 main 的独立历史，通过 cherry-pick 同步本批提交，禁止强制推送或覆盖远端更新。
- 在上述仓库发布对应版本的 GitHub Release，上传 EXE、ZIP、SHA256SUMS.txt，并核对远端提交、标签和附件。
- 不合并或推送 wuhui 分支。保留现有用户改动，不结束他人的游戏进程。
- 如当次用户明确要求只分析、暂不执行、暂不发布或有其他限制，以当次指令为准。发布失败应保留成品并准确报告失败环节。
