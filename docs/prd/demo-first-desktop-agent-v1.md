# Agent_XXXXX Demo-first 桌面 Agent V1 PRD

> 版本：v1.1（Codex-style Local Workspace 本地评审稿）  
> 日期：2026-09-05  
> 产品定位：桌面 Agent 客户端，办公能力优先  
> UI 模式：`spec-driven`（规范驱动 UI）  
> 首发平台：Windows 优先（`platform-id=desktop`）  
> 默认运行模式：`Local Workspace Mode`  
> 仓库：https://github.com/mahiro424/Agent_XXXXX

---

## 问题陈述

用户希望用一个类似 Codex 的桌面客户端，以自然语言描述任务，让 Agent 在用户明确选择的本地工作区中读取文件、形成计划、调用工具、生成办公产物并验证结果。当前：

1. 文件工具只能处理文件，缺少线程、轮次、审批和历史任务体验；
2. 纯聊天 Agent 只给建议，不形成可恢复的工具执行过程；
3. 前台 GUI Agent 依赖截图和鼠标键盘，容易误操作且难以验证；
4. 办公文件能力、沙箱边界和桌面客户端之间缺少统一 Runtime。

Agent_XXXXX 要以 Codex 式 Local/Worktree/Cloud 分层为参考，先完成“本地工作区 → 计划 → 审批 → 工具执行 → 文件产物 → 验证”的完整 Demo，再扩展 Windows Bridge、Computer Use 和更多 App Pack。

---

## 解决方案

Agent_XXXXX V1 提供一个 Windows 优先的桌面 Agent 客户端，首个能力域是办公自动化：

- 用户输入自然语言任务，选择本地文件/文件夹作为工作区；
- Agent 通过独立 Runtime 管理 thread、turn、plan、approval、tool execution 和 artifact verification；
- 用户批准计划后，Runtime 在工作区沙箱内调用文件、文档和应用能力；
- 默认网络关闭；超出工作区、需要网络或具有副作用的工具调用必须请求批准；
- 客户端实时展示线程、轮次、工具调用、产物和验证证据；
- Windows Bridge 作为可选辅助 Adapter，用于打开输出目录或读取窗口状态，不作为 V1 主执行边界；
- 任务完成以独立证据判定，不使用模型自评。

### V1 的运行模式

#### `Local Workspace Mode`（V1 Must）

- Agent 在用户明确选择的本地工作区中运行；
- 沙箱定义可读写的技术边界；
- Approval Policy 定义何时必须暂停并请求用户批准；
- 网络默认关闭；
- 文件写入默认生成任务产物，不覆盖输入文件；
- 桌面客户端可最小化，但 Runtime 状态、线程和轮次可恢复；
- 不默认接管用户主桌面的鼠标键盘。

#### `Task Workspace/Worktree Mode`（V1.1 Should）

- 为任务创建独立目录、快照或 Git worktree；
- 允许多个任务互不干扰；
- 支持从 Local 工作区切换到隔离任务工作区；
- 办公文件使用任务目录/快照，不强行要求 Git。

#### Cloud / Computer Use Mode（Not Now）

- Cloud 在远程环境运行；
- Computer Use 通过截图、UIA、鼠标键盘控制应用；
- PiP/RDP 提供独立桌面会话；
- 这些能力保留接口，但不属于 V1 Demo 主路径。

---

## 用户故事

### 桌面会话

- **US-1**：作为用户，我想在桌面客户端中输入自然语言任务，以便不学习命令行。
- **US-2**：作为用户，我想选择本地工作区和任务范围，以便控制 Agent 可以读取和写入的内容。
- **US-3**：作为用户，我想看到当前线程、轮次、工具调用和文件状态，以便知道 Agent 正在做什么。
- **US-4**：作为用户，我想随时暂停、停止或拒绝工具调用，以便保留控制权；桌面接管属于后续 Computer Use 能力。
- **US-5**：作为用户，我想在客户端最小化后让任务继续或暂停，以便适应长任务。

### 规划和执行

- **US-6**：作为用户，我想先查看任务计划，以便纠正 Agent 的理解。
- **US-7**：作为用户，我想看到每一步使用的是文件引擎、应用 API、UIA 还是视觉动作。
- **US-8**：作为用户，我想看到动作前后的观察结果，以便确认动作真的发生。
- **US-9**：作为用户，我想限制最大动作数、运行时长和模型消耗。
- **US-10**：作为用户，我想让 Agent 在异常后重新观察而不是盲目重试。

### 办公能力

- **US-11**：作为用户，我想让 Agent 读取和修改 Word 文档。
- **US-12**：作为用户，我想让 Agent 读取和修改 Excel 数据、公式和图表。
- **US-13**：作为用户，我想让 Agent 生成和修改 PowerPoint。
- **US-14**：作为用户，我想让 Agent 读取和转换 PDF。
- **US-15**：作为用户，我想让 Agent 整理文件夹并生成汇总文件。

### 安全和交付

- **US-16**：作为用户，我想在覆盖、删除、上传和发送前确认。
- **US-17**：作为用户，我想看到已验证、部分完成、失败和不确定等真实状态。
- **US-18**：作为用户，我想查看历史任务和动作日志。
- **US-19**：作为用户，我想重试安全的只读步骤。
- **US-20**：作为用户，我想配置模型、隐私和应用权限。

---

## UI 与设计要求

### UI 模式

采用 `spec-driven`：不要求制作逐页 PNG 设计稿；页面布局和状态规格以本 PRD 为唯一实现依据。通用颜色、字体、按钮、弹窗和状态组件由 `docs/design/DESIGN.md` 提供。用户提供的参考图仅用于确定 `app-shell` 与 `demo-home` 的浅色留白、左侧导航、会话优先和任务输入优先方向，不构成 mockup 依赖。

### 平台

- `platform-id`：`desktop`
- 首发 Windows；默认窗口建议 1280×800，最小可用窗口 1024×700。

### 状态策略

| 状态 | 处理方式 |
|---|---|
| 空闲 | 不进行任何工具执行，展示新线程入口 |
| Thread 创建 | 建立本地线程和工作区引用 |
| Turn 进行中 | 展示当前轮次、模型输出和工具请求 |
| 观察中 | 展示工作区文件、产物和可选应用状态 |
| Plan 生成中 | 只读分析，不执行写入工具 |
| Approval 等待 | 暂停 Runtime，展示工具、参数、范围和风险 |
| Tool Execution 中 | 展示当前工具、输入、输出和停止按钮 |
| 用户暂停 | 不发送后续工具调用，保留线程现场 |
| 用户拒绝 | 拒绝当前工具或计划，说明策略原因 |
| Artifact Verification 中 | 重新读取产物并执行结构/内容验证 |
| 已验证 | 展示证据链和结果 |
| 部分完成 | 分项显示成功、失败和未执行项 |
| 失败 | 停止并显示原因，不默认盲重试 |
| 结果不确定 | 进入 `RECONCILIATION_REQUIRED`，禁止盲重试 |
| 客户端崩溃 | 恢复线程和事件，不自动重放写入动作 |

### 页面清单

#### `app-shell`（桌面客户端整体框架）

- **主任务**：提供任务入口、全局状态和安全控制。
- **覆盖的用户故事**：—（壳层）
- **DESIGN 复用**：侧栏导航 §5、状态徽章 §5、主按钮/次按钮/文字按钮 §5、环境阴影 §4、无描边规则 §2。
- **UI 设计描述**：左侧为可折叠主导航，包含“新会话、案例中心、定时任务、技能、连接器”；左侧下方为置顶线程、工作空间和历史任务列表。顶部为当前工作区、线程标题、模型连接、沙箱/网络状态和全局任务状态；右上角为帮助/客服/状态入口。中央为路由内容区，右侧为可收起的计划/审批/证据面板。全局任务状态使用文字 + 图标 + 轻色块共同表达，不只依赖颜色。线程执行中切换页面不得终止 Runtime；最小化到托盘后线程可继续或被暂停，托盘必须提供停止入口。所有需要用户决定的工具调用都在壳层内显示确认卡。
  - **空状态变体**：尚未配置任何本地工作区时，左侧工作空间列表显示引导文案和“选择文件夹”入口。
  - **禁用变体**：模型未连接、工作区未授权或沙箱未就绪时，任务入口显示具体原因，不直接禁用全部功能。
- **各状态行为**：`default` 展示导航与线程状态；`empty` 工作区为空；`disabled` 工作区/模型/权限未就绪。

#### `demo-home`（Demo 首页）

- **主任务**：启动可重复的 Demo 并输入任务。
- **覆盖的用户故事**：US-1~US-3, US-5
- **DESIGN 复用**：欢迎区标题 §3、主按钮 §5、次按钮 §5、状态徽章 §5、空状态 §5、导航 §5。
- **UI 设计描述**：继承 `desktop` app-shell，左侧导航选中“新会话”。中央为欢迎区和任务输入区：欢迎语说明“告诉 Agent 你想完成什么”，下方为快捷任务示例（如“整理会议材料并生成 Word 报告”）。输入框下方展示当前本地工作区、沙箱范围、网络状态和模型状态；提交后创建 thread 并进入 `task-plan`。页面同时提供“Fake Model Demo”和“Live Model Demo”两种模式，Fake Model 不依赖 API Key。执行后页面自动切换到 `workspace-session`/`task-run`。
  - **空状态变体**：未选择本地工作区时，输入区下方显示“尚未选择工作区”引导。
  - **禁用变体**：模型、工作区或审批能力未就绪时，主按钮不可用并显示具体原因。

#### `task-compose`（任务输入）

- **主任务**：输入任务并选择范围。
- **覆盖的用户故事**：US-1, US-2, US-9
- **DESIGN 复用**：输入框 §5、卡片容器 §5、按钮 §5。
- **UI 设计描述**：继承 app-shell。提供大输入框、本地工作区、任务工作区/快照选项、只读模式、网络访问开关、最大步骤和最长时间设置；底部为“生成方案”主按钮。提交后只进入 thread/turn 计划阶段，不直接执行工具。只读模式下禁止写入类工具；网络默认关闭，打开网络必须进入审批策略。

#### `task-plan`（计划确认）

- **主任务**：查看和批准计划。
- **覆盖的用户故事**：US-6, US-7, US-16
- **DESIGN 复用**：卡片容器 §5、列表行 §5、状态徽章 §5、主/次/文字按钮 §5。
- **UI 设计描述**：继承 app-shell。按 thread/turn 展示计划步骤、工具名称、参数摘要、工作区范围、预计产物、网络需求、风险和验证方式。用户可以批准、拒绝、修改任务或切换为只读模式。超出工作区、打开网络或产生副作用的工具调用单独标出并请求确认。计划确认前不得产生任何写入事件。

#### `workspace-session`（工作区会话）

- **主任务**：查看 thread/turn、工作区观察和工具执行状态。
- **覆盖的用户故事**：US-3, US-4, US-8, US-10
- **DESIGN 复用**：列表行 §5、状态徽章 §5、按钮 §5、卡片容器 §5。
- **UI 设计描述**：继承 app-shell。中央显示当前 thread/turn 的消息、计划和工具时间线；右侧显示本地工作区、任务工作区、文件变化和当前工具输出；底部显示“暂停、停止、重新观察”。如果启用了可选 Windows Bridge，才显示窗口状态或打开输出目录的证据卡；V1 不要求实时接管用户鼠标键盘。
  - **只读变体**：只允许观察和读取，不显示写入工具。
  - **结果不确定变体**：显示 `RECONCILIATION_REQUIRED`，锁定继续执行按钮，要求重新读取现场。

#### `task-run`（实时执行）

- **主任务**：查看动作时间线和执行结果。
- **覆盖的用户故事**：US-7~US-10, US-17
- **DESIGN 复用**：时间线、卡片容器 §5、状态徽章 §5、按钮 §5。
- **UI 设计描述**：继承 app-shell。时间线按 thread、turn、plan、approval、tool execution、artifact verification 分组；每个工具调用显示工具名、参数摘要、工作区范围、输出摘要和证据引用。可选的 Windows Bridge 事件显示窗口状态或打开路径，但不把截图/鼠标动作作为默认主链路。错误动作红色显示，但必须同时提供文字原因和恢复策略；动作失败时提供“重试只读步骤/重新规划/停止”，不自动连续重试高风险动作。

#### `artifact-review`（结果审查）

- **主任务**：查看文件和验证证据。
- **覆盖的用户故事**：US-11~US-15, US-17
- **DESIGN 复用**：文件列表、预览面板、Diff、状态徽章 §5、按钮 §5。
- **UI 设计描述**：继承 app-shell。左侧文件列表，中央 Word/Excel/PPT/PDF 预览，右侧 Diff 和验证卡。最终状态必须显示 `VERIFIED`、`PARTIALLY_COMPLETED`、`FAILED` 或 `RECONCILIATION_REQUIRED` 的中文解释和证据链。可以打开系统原生应用，但打开不等于任务已验证。

#### `history`（历史任务）

- **主任务**：查看和恢复任务。
- **覆盖的用户故事**：US-18, US-19
- **DESIGN 复用**：列表行 §5、卡片容器 §5、状态徽章 §5、按钮 §5。
- **UI 设计描述**：继承 app-shell。显示 thread、turn、工作区、任务产物、耗时和终态。只读观察和工具结果可回放；写入动作恢复时必须重新读取工作区，不直接重放。`RECONCILIATION_REQUIRED` 任务恢复时第一步必须重新读取现场。对 Git 项目可显示 Worktree 关联；普通办公目录使用任务工作区/快照。

#### `settings`（设置与诊断）

- **主任务**：配置模型、权限和限制。
- **覆盖的用户故事**：US-9, US-16, US-20
- **DESIGN 复用**：表单 §5、卡片容器 §5、按钮 §5。
- **UI 设计描述**：继承 app-shell。分为模型服务、本地工作区、任务工作区、沙箱与审批、网络访问、可选桌面 Bridge、数据和诊断。API Key 不明文展示；设置页必须说明工作区范围、网络默认关闭、工具审批和可选截图/UIA/鼠标键盘能力。运行限制可调整，但放宽沙箱和审批边界需要说明风险。

### 用户故事 ↔ 页面映射

| 用户故事 | page-id |
|---|---|
| US-1~US-3, US-5 | `demo-home`、`workspace-session` |
| US-1, US-2, US-9 | `task-compose` |
| US-6, US-7, US-16 | `task-plan` |
| US-3, US-4, US-8, US-10 | `workspace-session` |
| US-7~US-10, US-17 | `task-run` |
| US-11~US-15, US-17 | `artifact-review` |
| US-18, US-19 | `history` |
| US-9, US-16, US-20 | `settings` |

页面总数：9，包含且仅包含 1 个 `app-shell`。

---

## Demo 0 黄金流程

Demo 0 的唯一主场景是“本地工作区中的会议材料整理与报告生成”：

```text
选择固定 demo-workspace
→ 创建 thread/turn
→ 读取 meeting-notes.md、decisions.txt、sales.csv
→ 生成 plan
→ 用户批准 approval
→ 使用 Document Engine 创建 weekly-meeting-report.docx
→ 输出到任务产物目录
→ 重新读取并渲染报告
→ 验证文件存在、非空、可重开、包含关键内容
→ 展示 VERIFIED 结果
```

可选的 Windows Bridge 只用于打开输出目录或读取窗口状态，不是 Demo 通过的必要条件。Demo 通过条件不依赖 UIA、鼠标键盘或主桌面接管。

Demo 必须同时覆盖异常路径：用户拒绝、用户暂停、文件写入失败、结果不确定（`RECONCILIATION_REQUIRED`）、客户端崩溃后恢复；用户接管属于后续 Computer Use 能力的接口预留，不作为 Demo 主路径。

---

## 实现决策

### `Desktop Agent Runtime`

桌面 Agent 的核心是可恢复的 Runtime，而不是 UI。UI、CLI 和未来远程客户端都通过同一协议调用 Runtime。Runtime 包含任务状态机、HostAgent、Policy、工具路由、事件存储和验证器。

### `Demo Runtime`

Demo 阶段使用 Fake Model/Fake Bridge/Fake Document Engine 与 Live Adapter 同一公共接口，确保不依赖 API Key 也能跑通完整闭环；后续逐个替换真实能力。Fake 适配器可确定性注入暂停、失败和结果不确定状态。

### `Windows Desktop Bridge`

桌面观察与动作由独立 C#/.NET sidecar 提供，通过受限 JSON-RPC/Named Pipes 暴露窗口、截图、UIA 和输入能力；Renderer 不得直接访问系统。V1 将其作为可选辅助 Adapter，Demo 最多使用启动/聚焦 File Explorer、打开路径、读取 UIA 和截图；它不属于 Local Workspace Runtime 的主契约，不默认提供主桌面鼠标键盘接管。

### `Document Engine Adapter`

产品通过统一 `DocumentEngine` 接口接入 AIOffice/OfficeCLI；最终选型以 Windows 黄金文件验证为准。Demo 至少实现读取 Markdown/文本/CSV、创建 `.docx`、渲染、校验和重读。

### `Policy Before Action`

任何动作必须先经过目标、权限、风险和前置条件检查；模型不能直接调用系统能力。Demo 默认禁止删除、覆盖输入、工作区外访问、上传、网络请求和任意 Shell。

### `Evidence-Driven Completion`

任务完成必须由验证器根据实际文件、应用状态或独立读取结果确认，不能由模型最终回复决定。

### `HostAgent-AppAgent Boundary`

HostAgent 只做任务分解、协调和全局策略；AppAgent 负责单个应用的观察、能力和执行。V1 先实现 `FileExplorerAgent` 与 `Demo Office AppAgent`。

### `Codex-style Local Workspace Mode`

V1 默认在用户明确选择的本地工作区中运行；沙箱定义技术边界，Approval Policy 定义何时请求用户批准，网络默认关闭。桌面客户端通过 App Server 与 Runtime 解耦；不默认接管用户主桌面。

### `App Server Contract`

Desktop Client 与 Agent Runtime 通过版本化的 thread/turn/event 公共协议通信；UI 不直接调用模型、文件系统或系统能力。协议至少支持创建线程、开始轮次、流式事件、审批响应、暂停、取消和历史恢复。

### `Sandbox Before Capability`

工具能力只有在工作区沙箱和权限策略先通过后才能被调用。工具描述不等于授权；超出工作区、网络访问和具有副作用的工具调用必须由沙箱或 Approval Policy 阻止/请求确认。

### `Local/Worktree Execution Modes`

V1 默认 `Local Workspace Mode`；后续通过任务工作区、快照或 Git Worktree 隔离并行任务；Cloud Runtime、Computer Use 和 PiP 不进入 V1 Demo 主链路。

---

## 测试决策

### `Runtime Seam`

使用 Fake Model 和 Fake Adapter 验证：创建 thread、开始 turn、生成 plan、等待 approval、执行 tool、验证 artifact、暂停、取消、失败和恢复。断言事件顺序与状态转换，不调用真实模型。

### `App Server Seam`

通过公开的 thread/turn/event 协议验证客户端与 Runtime 解耦：客户端可以创建线程、开始轮次、接收流式事件、响应审批并恢复历史线程。

### `Local Workspace Seam`

使用临时本地工作区验证文件读取、产物目录、工作区边界、任务工作区/快照和默认不覆盖输入文件；越界访问必须被拒绝。

### `Sandbox Approval Seam`

表驱动验证网络关闭、工作区外访问、写入、覆盖和外发工具调用；技术沙箱拒绝与用户 Approval Policy 拒绝都必须产生可观察事件。

### `Bridge Seam`

作为可选 Windows 辅助能力，在 Windows VM 中验证窗口枚举、打开输出目录、读取 UIA 和截图；不把鼠标键盘接管作为 V1 Demo 必测主路径。

### `Document Engine Seam`

使用真实 `.docx` 验证创建、重开、渲染、结构检查和关键文本；未修改部分保留；文件可被目标 Office 软件或 LibreOffice/ONLYOFFICE 打开。

### `Policy Seam`

表驱动验证 Local Workspace 的权限矩阵：读取、创建产物、修改副本、覆盖、删除、外发、网络和可选桌面 Bridge。审批事件必须包含目标、工具、参数摘要、范围和风险。

### `Evidence Seam`

验证动作前后截图、文件哈希、文件重读和窗口状态；确保“界面显示成功”不等于“业务效果已发生”。

### `Crash Recovery Seam`

在生成文件或打开目录中途杀掉 Runtime，重启客户端后任务进入 `INTERRUPTED` 或 `RECONCILIATION_REQUIRED`，不得自动重放写入。

### `Desktop Golden Journey`

使用 Playwright/本地 Fake Adapter 完成完整 Demo Journey：打开客户端 → 输入任务 → 选择 Local Workspace → 创建 thread/turn → 生成 plan → approval → 执行工具 → 生成 Word → 重新读取/渲染 → 验证 → 结果；同时覆盖拒绝、暂停、失败、`RECONCILIATION_REQUIRED` 和恢复。Windows Bridge 打开目录作为可选集成检查，不阻塞主 Journey。

---

## 范围外

V1 不包含：Cloud Runtime；浏览器和邮箱等开放互联网应用；自动付款、发送邮件、提交审批和账号注册；摄像头、麦克风、屏幕录制；系统设置、注册表和驱动操作；多用户云端控制台；手机端；多 Agent 自由协商；自研 GUI 基础模型；编程 Agent；完整 Office 编辑器；PiP/RDP 隔离桌面；默认主桌面鼠标键盘接管；MCP 扩展生态。Worktree/Task Workspace 是后续增强能力，V1 先用 Local Workspace 和任务产物目录完成 Demo。

---

## 补充说明

- Demo 默认使用 Fake Model，不依赖 API Key；
- Live Model 通过 Provider Adapter 接入，模型只能看到允许发送的文件摘要和观察结果；
- Runtime 采用 thread/turn/event 的版本化客户端协议；
- V1 默认使用 `Local Workspace Mode`，网络默认关闭，沙箱边界与 Approval Policy 分离；
- Worktree/Task Workspace、Cloud、Computer Use、PiP 属于后续模式；
- Windows Bridge 仅作为可选辅助 Adapter，不是 Demo 主链路硬依赖；
- 文件引擎最终选型以 Windows 黄金文件验证为准；
- 参考图仅用于 `app-shell`/`demo-home` 的气质与布局方向，页面规格以本 PRD 为准；
- 本 PRD 为本地评审稿，尚未发布到 GitHub Issue。
