# argue v0 初期计划（已按最新讨论更新）

> 本文是 v0 的总览版。
> 详细协议字段见：`docs/plan/v0-shape-spec.md`。

## 1. 目标与边界

### 目标

把“多 agent 并行产出 -> 多轮互评 -> 收敛共识 -> 代表发言”的流程做成可复用编排组件。

### 非目标（强约束）

`argue` 不负责：

1. 触发源接入（GitHub/IM/CLI 等）
2. 具体 agent 调用实现（OpenClaw hook / ACP / 本地 runtime）
3. 外部平台写回（GitHub 评论、消息发送等）

以上都由宿主通过委托接口注入。

---

## 2. 核心流程（MVP）

1. **Start**：接收 `ArgueStartInput`，创建 `ArgueSession`。
2. **Initial Round**：并行派发初始任务，收集各参与者完整回答。
3. **Debate Rounds**（默认 3 轮）：
   - 每个参与者在**固定同一会话**中继续讨论（sticky）。
   - 轮次输入优先带入“他人上一轮完整回答”（预算内，必要时截断）。
   - 每位参与者按**论点粒度**返回 `agree/disagree/revise`。
4. **Synthesis**：基于 claim-level judgement 生成统一 `finalClaims`。
5. **Final Vote**：各参与者对统一稿投票 `accept/reject` 并可附修正。
6. **Scoring & Representative**：计算分数并选出最高分代表发言。
7. **Finalize**：
   - 满足共识条件 -> `status=consensus`
   - 轮次/时间到达上限仍未收敛 -> `status=unresolved`
   - 有效参与人数不足或关键任务失败 -> `status=failed`

---

## 3. 输入输出（v0 形状）

## 3.1 输入：`ArgueStartInput`（总览）

```ts
type ArgueStartInput = {
  requestId: string;
  topic: string;
  objective: string;

  participants: Array<{ id: string; role?: string }>;

  roundPolicy?: {
    minRounds?: number; // default 2
    maxRounds?: number; // default 3
  };

  sessionPolicy?: {
    mode: "sticky-per-participant"; // v0 固定
    sessionKeyPrefix?: string;
  };

  peerContextPolicy?: {
    passMode: "full-response-preferred";
    maxCharsPerPeerResponse?: number;
    maxPeersPerRound?: number;
    overflowStrategy?: "truncate-tail" | "truncate-middle";
  };

  scoringPolicy?: {
    enabled: true;
    representativeSelection: "top-score";
    tieBreaker: "latest-round-score" | "least-objection";
  };

  waitingPolicy?: {
    mode: "event-first" | "polling" | "hybrid";
    perTaskTimeoutMs?: number;
    perRoundTimeoutMs?: number;
    globalDeadlineMs?: number;
    lateArrivalPolicy?: "accept-if-before-finalize" | "drop";
  };

  constraints?: {
    language?: string;
    tokenBudgetHint?: number;
  };

  context?: Record<string, unknown>;
};
```

## 3.2 参与者轮次输出：`ParticipantRoundOutput`（总览）

```ts
type ParticipantRoundOutput = {
  participantId: string;
  phase: "initial" | "debate" | "final_vote";
  round: number;

  fullResponse: string; // 保留完整回答

  extractedClaims?: Array<{
    claimId: string;
    title: string;
    statement: string;
    category?: "pro" | "con" | "risk" | "tradeoff" | "todo";
  }>;

  judgements: Array<{
    claimId: string;
    stance: "agree" | "disagree" | "revise";
    confidence: number; // 0~1
    rationale: string;
    revisedStatement?: string;
  }>;

  vote?: "accept" | "reject"; // final_vote 时使用
  summary: string;
};
```

## 3.3 最终输出：`ArgueResult`（总览）

```ts
type ArgueResult = {
  requestId: string;
  sessionId: string;
  status: "consensus" | "unresolved" | "failed";

  finalClaims: Array<{
    claimId: string;
    title: string;
    statement: string;
    category?: string;
  }>;

  representative: {
    participantId: string; // 分数最高
    reason: "top-score" | "tie-breaker";
    score: number;
    speech: string;
  };

  scoreboard: Array<{
    participantId: string;
    total: number;
    byRound: Array<{ round: number; score: number }>;
  }>;

  votes: Array<{
    participantId: string;
    vote: "accept" | "reject";
    reason?: string;
  }>;

  disagreements?: Array<{
    claimId: string;
    participantId: string;
    reason: string;
  }>;

  metrics: {
    elapsedMs: number;
    totalTurns: number;
    retries: number;
    waitTimeouts: number;
  };

  error?: { code: string; message: string };
};
```

---

## 4. 通讯与等待机制（补全）

### 4.1 通讯原则

`argue` 与外部系统仅通过委托接口通信：

- `AgentTaskDelegate`：派发任务、等待结果、可选取消
- `ArgueObserver`：会话事件上报
- `SessionStore`：会话状态读写（可插拔）

### 4.2 等待机制（v0 必备）

每轮派发后必须进入 `waitRound`：

1. 优先事件驱动收集结果（event-first）
2. 事件缺失时按策略轮询（hybrid/polling）
3. 到达 `perRoundTimeoutMs`：
   - 若有效参与人数 >= 2，带缺席标记继续
   - 否则 `failed`
4. 对迟到结果应用 `lateArrivalPolicy`

> 这部分是 `argue` 的核心能力之一，不依赖宿主实现业务判断。

---

## 5. 共识与评分（v0）

1. 共识判断基于 claim-level 结果 + final vote。
2. 每位参与者按统一 rubric 计分（默认 correctness/completeness/actionability/consistency）。
3. 最终由最高分参与者代表发言。
4. 平分时按 tie-breaker 决定（默认 latest-round-score）。

---

## 6. 与宿主集成方式（示例，不绑定）

宿主负责：

1. 将外部触发转换为 `ArgueStartInput`
2. 提供 `AgentTaskDelegate` 执行路径
3. 订阅事件并写回外部平台

`argue` 只负责协议与编排，不关心 GitHub/MeowHook/OpenClaw 的具体实现。

---

## 7. 目录建议

```text
argue/
  src/
    core/
      engine.ts
      state-machine.ts
      consensus-delphi.ts
      scoring.ts
      wait-coordinator.ts
    contracts/
      request.ts
      task.ts
      result.ts
      delegate.ts
      events.ts
    store/
      memory-store.ts
    index.ts
  docs/
    plan/
      v0-initial.md
      v0-shape-spec.md
      sequence-mermaid.md
```

---

## 8. MVP 里程碑

### M1（先跑通）

- 3 参与者
- initial + 3 轮 debate + final vote
- sticky-per-participant session
- claim-level judgement
- event-first waitRound + timeout

### M2（可集成）

- 持久化 SessionStore
- 评分细化与 tie-breaker 完整实现
- 迟到结果与失败补偿策略完善

### M3（增强）

- 多种共识策略（majority/judge 等）
- 参与者动态增减
- 更丰富质量指标与观测面板

---

## 9. 待细化项

1. `consensus` 硬判定阈值（全票 vs 加权）
2. rubric 默认权重与可配置边界
3. `unresolved` 时的输出要求（是否必须给行动建议）
4. round prompt 模板规范与长度预算
