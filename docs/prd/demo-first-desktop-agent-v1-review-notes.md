# Demo-first 桌面 Agent V1 本地评审笔记

> 评审对象：`CONTEXT.md`、`docs/adr/000*.md`、`docs/design/DESIGN.md`、`docs/prd/demo-first-desktop-agent-v1.md`
> 修订时间：2026-09-05  
> 状态：Codex-style Local Workspace 本地评审稿，尚未发布 GitHub Issue

## 本次模式修正

原 PRD 把“Foreground Supervised V1”作为主执行模式，并把 Windows Bridge 的桌面观察/输入放在 Demo 主链路中。根据 Codex 官方 Windows App、Sandbox、Approval、Local/Worktree/Cloud 和 App Server 资料，已修正为：

- V1 默认：`Local Workspace Mode`；
- Runtime 通过 App Server Contract 与桌面客户端解耦；
- 沙箱定义技术边界，Approval Policy 定义何时请求用户批准；
- 网络默认关闭；
- 文件输入默认不覆盖，产物落在任务目录；
- Worktree/Task Workspace 为后续隔离增强；
- Cloud、Computer Use、PiP 和默认主桌面接管不属于 V1 Demo 主路径；
- Windows Bridge 降为可选辅助 Adapter，只负责打开输出目录/读取窗口状态等能力。

## 结构自检

- [x] `CONTEXT.md` 存在，仅包含领域词汇和不变量，不包含 Electron/C#/SQLite 等实现细节
- [x] `docs/adr/` 存在，ADR-0001~0006 已创建且为中文正文
- [x] `docs/design/DESIGN.md` 存在，文首为 `spec-driven`
- [x] DESIGN.md 包含 §1–§6、10 类通用原语、语义色、叠色表；不包含页面布局
- [x] PRD 存在，包含问题陈述、解决方案、用户故事、UI 模式、`### 状态策略`、`### 页面清单`、用户故事映射、实现决策、测试决策、范围外和补充说明
- [x] PRD 页面清单第一项为 `app-shell`
- [x] PRD 默认模式为 `Local Workspace Mode`
- [x] PRD 明确 `Local/Worktree/Cloud` 边界
- [x] PRD 包含独立 `### 状态策略`
- [x] PRD 为 `spec-driven`，未出现设计稿/PNG 要求
- [x] 用户故事 ↔ 页面映射表已覆盖所有带 UI 的故事
- [x] 实现/测试定位词已创建并唯一
- [x] Demo 0 黄金流程不依赖 UIA、鼠标键盘或主桌面接管

## 术语一致性

- PRD 使用 `CONTEXT.md` 中的术语：`本地工作区`、`任务工作区`、`工作区边界`、`本地工作区模式`、`桌面会话`、`HostAgent`、`AppAgent`、`观察`、`动作`、`动作策略`、`证据`、`用户接管`、`结果不确定`、`文件资产`。
- 未把实现技术写入 `CONTEXT.md`。

## 定位词唯一性

### 实现决策

- `Desktop Agent Runtime`
- `Demo Runtime`
- `Windows Desktop Bridge`
- `Document Engine Adapter`
- `Policy Before Action`
- `Evidence-Driven Completion`
- `HostAgent-AppAgent Boundary`
- `Codex-style Local Workspace Mode`
- `App Server Contract`
- `Sandbox Before Capability`
- `Local/Worktree Execution Modes`

### 测试决策

- `Runtime Seam`
- `App Server Seam`
- `Local Workspace Seam`
- `Sandbox Approval Seam`
- `Bridge Seam`
- `Document Engine Seam`
- `Policy Seam`
- `Evidence Seam`
- `Crash Recovery Seam`
- `Desktop Golden Journey`

以上定位词在 PRD 中各有唯一的小标题位置，可供 `to-issues` 与 `tdd` 路由。

## UI 门禁

- [x] UI 模式：`spec-driven`
- [x] 平台：`desktop` 单端
- [x] 页面总数：9，含 1 个 `app-shell`
- [x] 页面清单第一项是 `app-shell`
- [x] 参考图只用于 `app-shell`/`demo-home` 的气质和布局方向
- [x] 主入口是会话/工作区/任务输入，不是实时桌面接管
- [x] `workspace-session`/`task-run` 展示 thread/turn、工具、工作区和证据；Windows Bridge 为可选辅助

## Codex 模式对齐检查

- [x] Local：V1 在用户明确选择的本地工作区执行
- [x] Worktree：后续以任务工作区、快照或 Git worktree 隔离
- [x] Cloud：范围外，后续再做
- [x] Sandbox：工作区和网络边界先于工具能力
- [x] Approval：超出范围、网络和副作用动作需要批准
- [x] App Server：thread/turn/event 解耦客户端与 Runtime
- [x] 不默认接管用户主桌面

## 待产品确认的重点

1. 是否接受 `Local Workspace Mode` 作为 V1 默认运行模式；
2. 是否接受 Worktree/Task Workspace 作为后续增强，而不是 Demo 必须项；
3. 是否接受 Windows Bridge 只作为可选辅助 Adapter，不成为 Demo 主链路硬依赖；
4. 是否接受 Demo 0 黄金流程为“本地工作区 → Word 报告 → 产物目录 → 验证”；
5. 是否接受 9 个候选切片和新的依赖顺序作为下一阶段 `to-issues` 输入；
6. 是否接受参考图继续只作为首页气质方向，页面规格保持 `spec-driven`。

## 下一步门禁

- 产品确认本 PRD 后，运行 `to-issues` 创建 GitHub Issue；
- 按依赖顺序运行 `triage` 并设置 `ready-for-agent`；
- 对第一个 ready Issue 运行 `tdd`（RED → GREEN → REFACTOR）；
- 首轮代码完成后运行 `repo-wiki` 生成人类阅读导读。
