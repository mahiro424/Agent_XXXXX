# Agent_XXXXX 领域词汇表

本上下文描述 Agent_XXXXX：一个运行在桌面上的 Agent 客户端。它以自然语言接收任务，在用户明确选择的本地工作区中规划和执行任务，调用结构化能力完成办公工作，并在关键动作前请求确认、执行后以独立证据验证结果。V1 首个能力域是办公自动化；编程能力属于未来的独立能力包。

## 领域语言

**本地工作区（Local Workspace）**：用户明确选择并授权给 Agent 处理的本地目录及其文件范围；V1 默认所有读取、写入和产物生成都受此边界约束。
_避免使用_：整个电脑 (Whole Computer)、任意目录 (Any Directory)

**任务工作区（Task Workspace）**：为一次文件任务准备的独立工作范围，包含输入引用、任务产物和可回退版本；它可以来自本地工作区的副本或快照。
_避免使用_：临时目录 (Temp Folder)、缓存目录 (Cache Folder)

**工作区边界（Workspace Boundary）**：规定 Agent 可以读取、写入或外发哪些文件资产的范围；超出边界的动作必须被阻止或请求用户批准。
_避免使用_：路径限制 (Path Limit)、文件白名单 (File Allowlist)

**本地工作区模式（Local Workspace Mode）**：Agent 在当前设备的本地工作区中运行，桌面客户端负责会话与审查，Agent Runtime 负责计划、审批、工具执行和产物验证。
_避免使用_：前台接管模式 (Foreground Takeover Mode)、全桌面模式 (Full Desktop Mode)

**桌面会话（Desktop Session）**：一次 Agent 在本地工作区中运行的连续上下文；包含线程、轮次、计划、审批、观察、动作和验证记录。桌面会话不等于默认接管用户的鼠标键盘。
_避免使用_：会话窗口 (Session Window)、后台进程 (Background Process)

**线程（Thread）**：围绕一个持续任务目标组织的对话和工作上下文；可以包含多个轮次，并在历史中恢复。
_避免使用_：聊天窗口 (Chat Window)、任务列表 (Task List)

**轮次（Turn）**：线程中一次用户输入触发的计划或执行单元；包含模型输出、工具调用、审批请求和结果事件。
_避免使用_：消息 (Message)、步骤 (Step)

**HostAgent**：负责理解用户目标、将任务拆解为能力级子任务、协调多个 AppAgent 并管理全局生命周期与用户交互的控制层。
_避免使用_：主 Agent (Main Agent)、总控 (Controller)

**AppAgent**：面向单个应用或能力域的执行模块，例如文件管理器 AppAgent、Word AppAgent；负责该应用或能力的观察、工具选择和执行。
_避免使用_：应用助手 (App Helper)、工具代理 (Tool Agent)

**观察（Observation）**：Agent 在某一时刻获得的事实，包括工作区文件状态、应用状态、窗口状态、UI 控件树、截图和工具返回值。
_避免使用_：环境快照 (Snapshot)、屏幕信息 (Screen Info)

**动作（Action）**：Agent 请求执行的一个可追踪操作，例如读取文件、生成文件、打开目录、调用应用能力或在授权范围内执行桌面动作。
_避免使用_：步骤 (Step)、命令 (Command)、操作码 (Opcode)

**动作策略（Policy）**：在动作执行前判定目标、工作区边界、权限、风险等级和是否需要用户确认的策略层。
_避免使用_：权限配置 (Permission Config)、安全清单 (Safety List)

**证据（Evidence）**：证明动作或任务确实产生预期结果的独立依据，例如文件存在与哈希、重新读取的内容、验证报告或窗口状态。
_避免使用_：结果反馈 (Feedback)、日志 (Log)

**用户接管（Takeover）**：用户暂停 Agent 并亲自控制桌面输入或应用窗口的状态；接管期间 Agent 只观察，不执行动作。该能力不是 V1 Local Workspace 主路径。
_避免使用_：打断 (Interrupt)、抢占 (Preempt)

**结果不确定（Reconciliation Required）**：系统无法确认动作是否已产生副作用的状态；此时禁止盲重试，必须重新读取现场并由用户决定。
_避免使用_：待确认 (Pending)、重试 (Retry)

**文件资产（Artifact）**：任务实际读取或产出的文件，如 `.docx`、`.xlsx`、`.pptx`、`.pdf` 或输出目录，以及其元数据和校验信息。
_避免使用_：文档对象 (Document Object)、资源 (Resource)

### 角色

**用户（User）**：桌面 Agent 的使用者；拥有工作区授权、任务审批、暂停和结果接受的最终控制权。
_避免使用_：客户 (Customer)、操作员 (Operator)

**产品方（Product Owner）**：对 Agent_XXXXX 的产品范围、评审门和发布决策负责的角色。
_避免使用_：需求方 (Stakeholder)、老板 (Boss)

## 规则

- **要有主见。** 同一个概念有多个词时，优先采用本词汇表给出的术语，并在 `_避免使用_` 下列出替代词。
- **定义要精炼。** 每个术语最多一两句话，定义它是什么，不写实现细节。
- **仅包含本项目上下文特有的术语。** Electron、C#、SQLite、UIA、JSON-RPC、沙箱等通用技术概念不属于领域词汇表。
- **涉及桌面 Agent 领域时统一使用本词汇表。** 例如：任务有“计划”“审批”“执行”“验证”阶段，但只有在表达本项目领域含义时才作为领域术语使用。
- **本地工作区优先于任意桌面控制。** V1 先保证工作区边界、任务线程、轮次事件和文件资产可验证；Computer Use、PiP 和默认用户接管属于后续能力。
