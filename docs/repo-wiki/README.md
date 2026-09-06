# Agent_XXXXX 代码库架构导读 (Repo Wiki)

欢迎阅读 **Agent_XXXXX** 生产级本地工作区智能体系统的代码库架构导读。本文档专为人类开发者（工程师、架构师、技术评审）设计，旨在帮助您快速建立对系统全局架构、运行机制、关键模块和边界策略的高清认知。

---

## 一、系统全景概览

**Agent_XXXXX** 是一款专为本地离线与混合工作区打造的生产级智能体桌面端系统。它深度融合了主流 Coding Agent 的界面体验与坚固的双重沙箱安全运行时：

- **桌面交互层 (Desktop Presentation Layer)**：基于 Electron 构建的极简无边框工作台，包含自适应侧边栏、任务计划与审批卡片、富文本 Composer、上下文附件管理及动态模型配置弹窗；
- **智能体运行核心 (Agent Runtime Core)**：基于生产级 ReAct Loop 与状态机驱动，支持流式思考链呈现、单步/多步工具调度、崩溃恢复与断点会话隔离；
- **模型与推理层 (Model & Reasoning Layer)**：深度适配 DeepSeek 系列（V3 / R1 Reasoner / 官方原生参数）及标准 OpenAI 兼容端点，首创 `GET /models` 动态探测自适应选单；兼备 Deterministic 离线离线规划器；
- **能力扩展体系 (Tools & MCP Supervison)**：原生内置 Office 引擎（基于 `docx` 和 `ExcelJS`）、CodeAct 脚本沙箱（Node.js / PowerShell）、系统安全命令执行器以及符合协议的 Stdio MCP Client 外部工具热发现；
- **安全与证据闭环 (Sandbox & Evidence Verifier)**：以物理工作区为边界的技术级沙箱，结合 5 级权限审批策略与 OpenXML / JSON / 散列级物理证据链验证。

---

## 二、阅读导航指引

请按以下推荐路径逐步阅读：

| 章节 | 文件 | 核心内容 |
| :--- | :--- | :--- |
| **01 执行主流程** | [`01-execution-flow.md`](01-execution-flow.md) | 从用户下达指令到工具调用、证据校验与结果呈现的完整生命周期 |
| **02 核心模块图谱** | [`02-core-modules/index.md`](02-core-modules/index.md) | 核心模块划分、职责边界与源码定位锚点 |
| **03 跨边界交互** | [`03-cross-boundaries.md`](03-cross-boundaries.md) | Electron 进程间 IPC、Node 运行时与外部 MCP 进程监督隔离边界 |
| **04 数据与状态流** | [`04-data-state-flow.md`](04-data-state-flow.md) | Thread / Turn / Event / Plan 状态机流转与 JSONL 恢复机制 |
| **05 配置与边界** | [`05-config-boundaries.md`](05-config-boundaries.md) | 模型服务配置、MCP 服务器配置、用户偏好与权限模式持久化 |
| **06 扩展点机制** | [`06-extension-points.md`](06-extension-points.md) | 如何新增原生 Universal Tool、外部 MCP 服务或接入自定义模型 |
| **07 风险与质量点** | [`07-risk-points.md`](07-risk-points.md) | 安全红线、越界拦截、防覆盖机制与已知未覆盖边界 |
