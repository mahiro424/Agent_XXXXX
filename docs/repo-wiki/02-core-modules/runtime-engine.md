# 核心模块：RuntimeEngine 运行时引擎

- **源码主文件**：[`src/runtime/engine.ts`](../../../src/runtime/engine.ts)
- **协议契约**：[`src/runtime/protocol.ts`](../../../src/runtime/protocol.ts)
- **测试用例**：[`tests/runtime-seam.test.ts`](../../../tests/runtime-seam.test.ts)

---

## 1. 设计目标

RuntimeEngine 是整个智能体操作系统的“内核”。它不依赖任何 UI 框架，负责在无损、可恢复的状态机驱动下编排任务。

## 2. 核心状态机 (TurnStatus)

- `proposed`：计划已生成，等待调度；
- `awaiting_approval`：需要用户介入进行物理权限审批；
- `running`：正在执行大模型推理或工具调用；
- `completed`：所有步骤执行完毕且产物通过物理证据链核验；
- `failed`：执行过程报错或物理证据校验未通过；
- `reconciliation_required`：执行中途遭遇异常断电或不确定副作用，锁定现场禁止盲目重放。

## 3. 关键实现

- `executeApprovedTurn(threadId, turnId)`：在用户批准后调度对应的工具处理器；
- `verifyWorkspaceArtifact(thread, turn, artifactName, verificationId)`：解耦业务强约束，策略化核验各类办公产物。
