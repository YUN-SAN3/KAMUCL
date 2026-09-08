# KAMUCL 提交规范

本文档约定 Git Commit 和 Pull Request 的格式，让提交历史可检索、可回溯，便于版本发布和问题定位。

## Commit 结构

```text
<type>(<scope>): <subject>

<body>

<footer>
```

- `type`：修改类型，必填，使用英文前缀以便工具识别。
- `scope`：影响范围，可选，建议使用英文项目领域名。
- `subject`：提交标题，必填，使用中文概括本次提交做了什么。
- `body`：提交正文，可选，说明原因、方案、边界和验证。
- `footer`：Issue、破坏性变更等信息，可选。

## 提交标题

标题使用 Conventional Commits 的结构，但主题统一使用中文：

```text
docs: 新增开发指南
fix(launch): 修复启动器退出时 Java 进程被终止
feat(mods): 增加安装前依赖确认
refactor(ipc): 将校验逻辑移入主进程
```

标题规范：

- 使用动词，描述“做了什么”。
- 一行完成，建议不超过 72 个字符。
- 首字母小写，不加句号。
- 不混合多个无关主题。
- 不使用 `update`、`change`、`修改一下` 等模糊描述。

## 类型前缀

| 类型 | 使用场景 |
| --- | --- |
| `feat` | 新增用户功能或对外能力 |
| `fix` | 修复 Bug 或错误行为 |
| `docs` | 文档、注释或示例 |
| `refactor` | 不改变外部行为的代码重构 |
| `test` | 新增或调整测试 |
| `build` | 构建脚本、依赖或打包配置 |
| `perf` | 性能优化 |
| `style` | 不影响逻辑的格式调整 |
| `chore` | 其他维护性改动 |
| `revert` | 回退已有提交 |

## 提交范围建议

```text
ui        页面、组件和样式
ipc       IPC 契约与桥接
launch    Java / Minecraft 启动生命周期
versions  版本、加载器和实例
mods      模组、整合包和资源安装
accounts  微软、离线和 Yggdrasil 账号
skins     皮肤、披风和头像
network   联机、下载和网络请求
settings  设置、主题和功能开关
build     构建、原生辅助程序和发布
```

## 提交正文

正文重点回答：

1. 为什么要改？
2. 核心方案是什么？
3. 有哪些边界、兼容性或迁移影响？
4. 如何验证？

示例：

```text
修复启动器退出时 Java 进程被一并终止的问题。

- 分离游戏进程生命周期
- 保留正常结束、强制结束和快速重启状态
- 启动失败时继续导出诊断日志

验证：npm test；手动验证原版和 Fabric 实例的启动、结束与重启。
```

使用 Git 命令时，第一个 `-m` 是标题，第二个 `-m` 是正文：

```powershell
git commit `
  -m "docs: 新增提交规范" `
  -m "统一 Commit 标题和正文格式，补充类型前缀、范围、破坏性变更与 Pull Request 要求。"
```

正文较长时使用 `git commit`，在编辑器中分段填写。

## 提交拆分

- 一个提交只解决一个主题。
- 功能代码、测试和必要文档可以放在同一提交。
- 无关格式化、批量重命名和功能修改应拆开。
- 纯格式化提交不要混入逻辑变化。
- 修复回归时，应将回归测试放在同一提交或紧邻提交中。
- 不提交构建产物、临时日志、截图和个人配置。

## 破坏性变更

如果修改 IPC、配置文件、实例目录结构或外部协议，标题末尾加 `!`，并在正文说明迁移方式：

```text
feat(settings)!: 修改游戏文件夹配置格式
```

```text
BREAKING CHANGE: settings.folders 改为保存绝对路径。
旧配置会在首次启动时自动备份并迁移。
```

## Pull Request 规范

Pull Request 标题应与主要 Commit 保持同一风格，正文至少包含：

```markdown
## 变更摘要
- 做了什么
- 为什么需要

## 实现范围
- 影响的页面、IPC、核心模块或数据格式

## 验证结果
- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] 必要的手动回归

## 风险与兼容性
- 是否有配置迁移或破坏性变更
- 是否影响已有实例、账号或存档

## 截图 / 日志
涉及界面或运行时行为变化时附上脱敏材料。
```

## 提交前检查

```powershell
git diff --check
npx tsc --noEmit
npm test
npm run build
git status --short
```

提交前确认：

- 标题能独立说明改动。
- 正文包含原因、方案和验证方式（有必要时）。
- 只包含本次主题相关文件。
- 没有 token、密码、Cookie、私有地址或本机绝对路径。
- 没有 `node_modules/`、`out/`、`release/` 等生成物。
- 功能、协议或安全边界变化已同步到 `docs/`。

## 协作分支

日常开发使用功能分支，不直接向 `main` 提交。分支名建议与提交 Scope 对齐：

```text
feature/mod-dependency-install
fix/launch-process-lifecycle
docs/commit-convention
refactor/ipc-validation
```

相关文档：[开发指南](DEVELOPMENT.md)、[功能树](FEATURE_TREE.md)。
