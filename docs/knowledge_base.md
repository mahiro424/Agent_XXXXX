# 知识库与设计模式沉淀 (Knowledge Base)

## 1. 桌面智能体输入框 (Composer) 交互与上下文控制范式 (借鉴 EvoX)

### 1.1 背景与目标
在本地桌面 AI Agent 中，传统的纯文本输入框难以满足复杂的研发与办公场景。参考现代 AI IDE（如 EvoX）的成熟实现，我们建立了集「附件多源输入、细粒度安全审批分级、模型推理强度调控、环形 Token 记忆余量监控与上下文智能压缩」五位一体的 Composer 交互体系。

### 1.2 核心设计模式

#### 1. 多源附件导入与上下文注入
* **设计方案**：
  * 支持输入框原生的文件选择、拖拽放置（Drag & Drop）和剪贴板复制粘贴（Paste）。
  * 状态层维护独立的 `attachments: AttachmentItem[]` 队列，并在发送任务时将其序列化为 `<attachments>` 结构块注入提示词。
  * 发送完成后原子清空附件队列，确保各轮对话状态解耦。

#### 2. 5 级动态安全审批与沙箱隔离 (5-Tier Approval Policy)
* **分级理念**：
  * `full-access` (完全访问)：跳过写入与命令审核，适合可信自动化环境。
  * `auto` (全自动)：常规读写放行，拦截破坏性覆写（如原文件覆盖）与外部高危行为。
  * `accept-edits` (自动接受编辑)：仅限工作区和产物目录写操作，外部系统命令需确认。
  * `risk-gated` (仅高危)：低风险读取放行，所有写入与命令拦截。
  * `ask-approval` (每步确认)：人工全流程兜底审核。
* **收益**：兼顾开发执行效率与工作区数据物理安全。

#### 3. 环形上下文仪表盘与主动压缩 (Context Compaction)
* **设计方案**：
  * 输入框内嵌动态 SVG 环形进度条，直观反映当前上下文使用率（`约XX% · 已用Tokens/窗口容量`）。
  * 提供 `/compact` 斜杠指令以及点击仪表盘唤起的弹出面板，允许用户随时发起上下文精简。
  * 压缩算法主动提取已完结任务成果、关键决策与物理产物路径，生成结构化总结并释放上文冗余，防止超长会话导致上下文溢出或幻觉。

---

## 2. 现代 Agent Runtime 核心架构与 8 大必备技术支柱

### 2.1 架构分层
现代工业级 Agent Runtime（如 EvoX / Cline / Roo-Code / Aider）必须超越前端“壳层”，在底座构建完整的**控制与执行闭环**：
1. **多模态与多源内容感知管线 (Ingestion Pipeline)**：不仅传递文件元数据，更执行磁盘探测、文本截断采样与多格式转换。
2. **记忆图谱与自适应上下文折叠 (Compaction & Checkpoint Engine)**：基于语义提取目标、事实与产物，淘汰历史庞大 Tool Output，生成无状态可续接 Checkpoint。
3. **安全受控沙箱与原子工具原语 (Deterministic Workspace & Process Execution)**：提供通用 `write_file`, `edit_file` (精确 Diff 替换), `list_dir`, `run_command` (PowerShell 子进程隔离与超时守护)。
4. **5 级物理安全策略门禁 (5-Tier Approval Interception)**：在 Runtime Engine 派发工具调用的最内层执行 `policy.decide()` 物理拦截，严禁绕过。
5. **模型推理强度与 Token 精确计量 (Model Telemetry & Reasoning Effort Control)**：原生透传 `reasoning_effort`，捕获 API 真实 `usage` 并闭环回写会话指标。

---

## 3. CWD (当前工作目录) 直写范式与临时对话沙箱化

### 3.1 废弃人为的 `artifacts/` 隔离目录
在真实工程与代码辅助开发中，智能体不应当向代码库强塞人为的 `artifacts/` 子目录：
- **项目工作区 (Project CWD)**：`cwd` 指向真实项目根目录（如 `E:\Agent`）。智能体使用 `writeWorkspaceFile` 和 `editWorkspaceFile` 直接在项目中原地读写和修改源代码（`src/...`、`tests/...`、`README.md`），原地运行 `npm test`。
- **临时对话 (Ephemeral CWD)**：当用户未选项目或发起临时对话时，系统在 `%TEMP%\agent-scratch\<sessionId>` 分配独立的沙盒目录并设为 `cwd`。智能体直接在该临时目录下生成测试文件和脚本，会话结束即安全销毁，实现**物理零污染**。

### 3.2 纯粹的 6 档操作权限体系
前端下拉选项彻底剔除 `沙箱写保护: 仅限 artifacts/ 目录`，收敛为统一的 6 档控制：
1. `full-access` (完全访问)：`cwd` 内自由读写与执行命令，全免审批。
2. `auto` (全自动)：常规增删改自动放行，破坏性覆写暂停询问。
3. `accept-edits` (自动接受编辑)：仅限当前工作区 `cwd` 内修改，外部路径与系统命令需确认。
4. `risk-gated` (仅高危)：低风险读取放行，写入与命令拦截。
5. `ask-approval` (每步确认)：人工全流程兜底审核。
6. `read-only` (仅只读访问)：严禁任何写入，纯审查与问答。

---

## 4. 工具命令模式解耦与双轨内核统一 (ToolRegistry & Unified Turn Loop)

### 4.1 核心痛点与反模式 (Anti-patterns)
1. **上帝类 (God Class) 职责爆炸**：当 `engine.ts` 超过 1500 行，将状态机、审批流、Office 生成、脚本执行、文件读写全部写在同一个类并用庞大的 `if-else` 分发时，系统丧失了可维护性与扩展性。
2. **双轨架构割裂 (Dual-Track Disconnect)**：传统规划审批流 (`startTurn` / Plan / Step Approval) 与多轮 ReAct 聊天流 (`sendMessage`) 平行独立，导致对话沉淀的数据无法在任务规划中复用，页面切换时状态断层。

### 4.2 解决方案与重构规范
1. **命令模式与插件化 (Command Pattern + ToolRegistry)**：
   - 定义 `IToolHandler` 接口（`name`, `definition`, `canHandle`, `execute`）与统一上下文 `ToolContext`。
   - 所有具体工具自包含定义与执行逻辑，引擎仅作为调度器通过 `ToolRegistry.execute(name, args, context)` 进行委托调用。
   - 新增工具无需修改核心引擎，彻底符合开闭原则 (OCP)。
2. **不可变 Turn 状态流与双轨统一**：
   - 无论是闲聊还是复杂任务，`sendMessage` 内部统一驱动 `Turn` 生命周期（`turn.started` -> `tool.started/completed` 附带 `turnId` -> `turn.status_changed`）。
   - `DesktopSession` 通过事件流自动同步并持久化活跃的 `activeTurnId`，使多重视图投影（对话流与任务看板）底层共享唯一的不可变状态流。
3. **脚本沙箱环境变量白名单与凭据净化**：
   - 外部脚本执行时拒绝盲目传递宿主全局 `process.env`，通过 `createSanitizedProcessEnv` 仅白名单透传基础系统路径，显式剥离和净化所有 API Key 与私密凭据。
