# Triage 标签

## 类别角色

| 角色 | 跟踪器中的标签 | 含义 |
| --- | --- | --- |
| `bug` | `bug` | 已有行为损坏 |
| `enhancement` | `enhancement` | 新功能或改进 |
| `design-input` | `design-input` | Design issue；仅 `spec-driven` / `mockup-driven` 使用 |

## 状态角色

| 角色 | 跟踪器中的标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 待评估 |
| `needs-info` | `needs-info` | 待报告人反馈 |
| `ready-for-agent` | `ready-for-agent` | 可由 Agent 接手 |
| `ready-for-human` | `ready-for-human` | 待人工处理 |
| `wontfix` | `wontfix` | 不处理 |

每个已分拣 issue 应恰好有一个类别角色和一个状态角色。`headless` 工作不使用 `design-input`。
