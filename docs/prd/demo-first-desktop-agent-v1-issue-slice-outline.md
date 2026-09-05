# Codex-style Local Workspace 桌面 Agent V1 候选 Issue 切片提纲

> 本文档是下一阶段 `to-issues` 的输入提纲，**不是 Issue 本体**。  
> 在本地 PRD 评审通过前，不创建任何 GitHub Issue。

## 切片 1：`#D-global`（Design Issue）

- **类型**：design-input
- **依赖**：无
- **覆盖的用户故事**：—（设计系统）
- **PRD 定位词**：`docs/design/DESIGN.md`
- **预期验收**：`DESIGN.md` 按模板就绪，包含 §1–§6、10 类通用原语、语义色和叠色表；不含页面布局。

## 切片 2：`app-shell`（UI Issue）

- **类型**：AFK（依赖 `#D-global`）
- **依赖**：切片 1
- **覆盖的用户故事**：US-1~US-3, US-5
- **PRD 定位词**：PRD 页面清单 §`app-shell`；`spec-driven`
- **预期验收**：侧栏导航、thread/turn 全局状态、工作区状态、沙箱/网络状态、审批入口、任务不因页面切换中断、托盘停止。

## 切片 3：`demo-home`（UI Issue）

- **类型**：AFK
- **依赖**：切片 2（app-shell）
- **覆盖的用户故事**：US-1~US-3, US-5
- **PRD 定位词**：PRD 页面清单 §`demo-home`；`spec-driven`
- **预期验收**：参考图方向的欢迎区、快捷任务、Fake/Live 模式、Local Workspace 选择、沙箱/网络提示、提交后创建 thread 并进入计划。

## 切片 4：App Server / Demo Runtime（功能 Issue）

- **类型**：AFK
- **依赖**：切片 1、2、3
- **覆盖的用户故事**：US-6~US-10, US-17~US-19
- **PRD 定位词**：`Desktop Agent Runtime`、`Demo Runtime`、`App Server Contract`、`Runtime Seam`
- **预期验收**：Fake Model 驱动完成 thread → turn → plan → approval → tool execution → artifact verification → result；支持流式事件、暂停、拒绝、失败、`RECONCILIATION_REQUIRED` 和历史恢复；不依赖 API Key。

## 切片 5：Local Workspace Sandbox（功能 Issue）

- **类型**：AFK
- **依赖**：切片 4
- **覆盖的用户故事**：US-2, US-9, US-16, US-20
- **PRD 定位词**：`Codex-style Local Workspace Mode`、`Sandbox Before Capability`、`Local Workspace Seam`、`Sandbox Approval Seam`
- **预期验收**：只读/工作区写入/工作区外访问/网络访问策略可区分；网络默认关闭；越界和高风险工具调用被阻止或进入审批；输入文件默认不覆盖。

## 切片 6：Document Engine Adapter（功能 Issue）

- **类型**：AFK
- **依赖**：切片 4、5
- **覆盖的用户故事**：US-11~US-15
- **PRD 定位词**：`Document Engine Adapter`、`Document Engine Seam`
- **预期验收**：读取 Markdown/文本/CSV、创建 `.docx`、渲染、校验、重读；黄金文件可被 Office/LibreOffice/ONLYOFFICE 打开；结果落在任务产物目录。

## 切片 7：Verifier（功能 Issue）

- **类型**：AFK
- **依赖**：切片 4、5、6
- **覆盖的用户故事**：US-8, US-10, US-17
- **PRD 定位词**：`Evidence-Driven Completion`、`Evidence Seam`、`Crash Recovery Seam`
- **预期验收**：文件存在/非空/重开/内容/结构验证；任务结果区分 `VERIFIED`、部分完成、失败和 `RECONCILIATION_REQUIRED`；不确定状态不盲重试。

## 切片 8：可选 Windows Bridge 辅助能力（功能 Issue）

- **类型**：AFK（可与切片 6/7 并行）
- **依赖**：切片 4
- **覆盖的用户故事**：US-3, US-8
- **PRD 定位词**：`Windows Desktop Bridge`、`Bridge Seam`
- **预期验收**：受限 sidecar 能打开输出目录、读取窗口状态和生成辅助截图；不提供主桌面默认接管；不成为 Demo 主链路硬依赖。

## 切片 9：Demo E2E（集成 Issue）

- **类型**：AFK
- **依赖**：切片 4、5、6、7
- **覆盖的用户故事**：US-1~US-20 主路径
- **PRD 定位词**：`Desktop Golden Journey`
- **预期验收**：Local Workspace 下完整 Demo Journey 通过：输入任务 → thread/turn → plan → approval → 读取材料 → 生成 Word → 任务产物目录 → 重新读取/渲染/验证 → 结果；拒绝、暂停、失败、`RECONCILIATION_REQUIRED`、恢复路径通过；Fake Model 可离线运行。Windows Bridge 只作为可选辅助检查。
