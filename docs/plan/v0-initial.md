# argue v0 初期计划（草案）

## 1. 目标与边界

### 目标

把“多 agent 并行产出 -> 多轮互评 -> 收敛共识”的流程做成一个可复用编排组件。

### 非目标（强约束）

`argue` 不负责：

1. 触发源接入（例如 GitHub webhook、聊天消息、CLI）
2. 具体 agent 运行时调用细节（例如 OpenClaw hook、ACP、本地进程）
3. 平台写回（例如发 GitHub 评论）

这些都由上层宿主（首个用户可为 MeowHook）通过委托/适配器实现。

---

## 2. 核心流程（MVP）

1. **Start**：接收标准化输入，创建 `ArgueSession`。
2. **Initial Round**：向所有参与者并行派发任务，收集初始结论。
3. **Debate Rounds**（默认 3 轮）：
   - 每轮把“他人上一轮摘要 + 自己上一轮结论”发给当前 agent。
   - agent 返回：`agree/disagree/revise` + 理由 + 更新结论。
4. **Synthesis**：生成 `consensusDraft`。
5. **Vote/Confirm**：各 agent 对 draft `accept/reject`，可附修正建议。
6. **Finalize**：
   - 全员接受 -> 输出 `status=consensus`。
   - 到达轮次上限仍未统一 -> 输出 `status=unresolved` + 分歧点。

---

## 3. 输入 / 输出（协议层）

### 输入：`ArgueRequest`

```ts
type ArgueRequest = {
  requestId: string;                  // 调用方生成的全局 ID
  topic: string;                      // 议题
  objective: string;                  // 期望产物定义
  participants: string[];             // 逻辑参与者 ID, e.g. ["onevclaw","onevpaw","onevtail"]
  maxRounds?: number;                 // 默认 3, 上限建议 6
  consensusPolicy?: "delphi";        // MVP 先固定 delphi
  context?: Record<string, unknown>;  // 上层透传上下文（平台无关）
  constraints?: {
    deadlineMs?: number;
    tokenBudgetHint?: number;
    language?: string;
  };
};
```

### 输出：`ArgueResult`

```ts
type ArgueResult = {
  requestId: string;
  sessionId: string;
  status: "consensus" | "unresolved" | "failed";
  finalAnswer?: string;               // 共识稿（或失败时为空）
  agreedBy?: string[];                // 接受最终稿的参与者
  disagreements?: Array<{
    participant: string;
    reason: string;
  }>;
  rounds: Array<{
    round: number;
    participant: string;
    stance: "agree" | "disagree" | "revise";
    summary: string;
  }>;
  metrics: {
    elapsedMs: number;
    totalTurns: number;
    retries: number;
  };
  error?: {
    code: string;
    message: string;
  };
};
```

---

## 4. 通讯方式（包内与包外）

## 4.1 包外通讯原则

`argue` 只通过接口与宿主通信，不直接访问网络平台 API。

- 上层把输入转成 `ArgueRequest` 调用 `argue.start(...)`
- `argue` 通过委托触发 agent 任务
- `argue` 通过事件回调上报状态
- 上层决定是否把状态写回 GitHub/聊天工具

## 4.2 包内通讯模型

采用“状态机 + 事件”模型：

- `SessionStarted`
- `RoundDispatched`
- `ParticipantResponded`
- `RoundCompleted`
- `ConsensusDrafted`
- `Finalized`
- `Failed`

事件用于观测与调试，可由上层订阅。

---

## 5. 委托接口（关键）

### 5.1 Agent 执行委托

```ts
interface AgentTaskDelegate {
  dispatch(input: {
    sessionId: string;
    requestId: string;
    participant: string;
    phase: "initial" | "debate" | "final_vote";
    round: number;
    prompt: string;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ taskId: string }>;

  awaitResult(taskId: string, timeoutMs?: number): Promise<{
    ok: boolean;
    output?: string;
    error?: string;
    usage?: Record<string, number>;
  }>;

  cancel?(taskId: string): Promise<void>;
}
```

### 5.2 事件上报委托

```ts
interface ArgueObserver {
  onEvent(event: {
    sessionId: string;
    requestId: string;
    type:
      | "SessionStarted"
      | "RoundDispatched"
      | "ParticipantResponded"
      | "RoundCompleted"
      | "ConsensusDrafted"
      | "Finalized"
      | "Failed";
    at: string;
    payload?: Record<string, unknown>;
  }): Promise<void> | void;
}
```

### 5.3 可插拔状态存储

```ts
interface SessionStore {
  save(session: unknown): Promise<void>;
  load(sessionId: string): Promise<unknown | null>;
  update(sessionId: string, patch: unknown): Promise<void>;
}
```

默认可先给内存实现；生产由宿主注入持久化实现。

---

## 6. 共识策略（MVP 固定）

先实现单一策略：**Delphi-like iterative consensus**。

规则：

1. 每轮都先做“他人观点摘要”。
2. 强制输出结构化 stance（agree/disagree/revise）。
3. 若连续两轮无实质变化，可提前终止为 `unresolved`。
4. 最终稿必须经过确认投票，不靠编排器单方面判定。

---

## 7. 失败与超时策略

- 单参与者任务失败：可重试 `n` 次（MVP 默认 1 次）。
- 多参与者中断：若无法满足最小参与人数（MVP=2）则 `failed`。
- 全局超时：到 `deadlineMs` 立即终止并输出当前最佳草案 + 未完成项。

---

## 8. 与宿主集成方式（示例，不绑定）

宿主侧职责：

1. 将外部触发（如 GitHub comment `/argue`）转换为 `ArgueRequest`。
2. 提供 `AgentTaskDelegate`（例如调用 OpenClaw hook）。
3. 订阅 `ArgueObserver` 并回写进度/结果到目标平台。

`argue` 只关心协议与编排，不关心 GitHub/MeowHook/OpenClaw 具体细节。

---

## 9. 目录建议（包本体）

```text
argue/
  src/
    core/
      engine.ts
      state-machine.ts
      consensus-delphi.ts
    contracts/
      request.ts
      result.ts
      delegate.ts
      events.ts
    store/
      memory-store.ts
    index.ts
  docs/
    plan/
      v0-initial.md
```

---

## 10. MVP 里程碑

### M1（先跑通）

- 支持 3 参与者
- 支持 initial + 3 轮 debate + final vote
- 产出结构化 `ArgueResult`
- 内存 store + observer

### M2（可集成）

- 可恢复会话（持久化 store）
- 更细粒度事件
- 失败重试和 deadline 完整化

### M3（增强）

- 可选共识策略（majority / judge）
- 参与者动态增减
- 更强的质量评估指标

---

## 11. 当前待你细化的问题

1. `consensus` 的硬判定条件（必须全票？还是 2/3 + 无高风险异议）
2. 每轮 prompt 模板的标准化程度
3. `unresolved` 时是否仍输出“建议行动方案”
4. 观测事件最少字段（便于后续 dashboard）
