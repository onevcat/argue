# argue v0 形状规范（按最新反馈修订）

> 目标：先把协议形状钉住，便于宿主（如 MeowHook）接入。

## 0. 关键决策（本版）

1. **每个参与者默认固定同一会话（sticky session）**，保证上下文连续。
2. 轮次输入中，**优先传递他人上一轮完整回答**（在预算内），不是仅摘要。
3. 输出从“单结论 stance”升级为**逐论点 stance**（claim-level）。
4. 引入**评分系统**，最终由最高分参与者作为代表发言。
5. 明确等待机制：编排器负责“派发 + 等待 + 超时 + 补偿”。

---

## 1. 输入协议

```ts
export type ArgueStartInput = {
  requestId: string;
  topic: string;
  objective: string;

  participants: Array<{
    id: string;               // logical id, e.g. onevclaw
    role?: string;            // optional persona/role hint
  }>;

  roundPolicy?: {
    maxRounds?: number;       // default: 3
    minRounds?: number;       // default: 2
  };

  sessionPolicy?: {
    mode: "sticky-per-participant"; // v0 固定这个
    sessionKeyPrefix?: string;        // 交给宿主解释
  };

  peerContextPolicy?: {
    passMode: "full-response-preferred";
    maxCharsPerPeerResponse?: number; // default: 6000
    maxPeersPerRound?: number;        // default: all-others
    overflowStrategy?: "truncate-tail" | "truncate-middle";
  };

  scoringPolicy?: {
    enabled: true;
    representativeSelection: "top-score";
    tieBreaker: "latest-round-score" | "least-objection";
    rubric?: {
      correctness?: number;   // 0~1 权重
      completeness?: number;
      actionability?: number;
      consistency?: number;
    };
  };

  waitingPolicy?: {
    mode: "event-first" | "polling" | "hybrid";
    perTaskTimeoutMs?: number;      // default: 10m
    perRoundTimeoutMs?: number;     // default: 20m
    globalDeadlineMs?: number;
    lateArrivalPolicy?: "accept-if-before-finalize" | "drop";
  };

  constraints?: {
    language?: string;
    tokenBudgetHint?: number;
  };

  context?: Record<string, unknown>; // 平台无关透传
};
```

---

## 2. 轮次任务输入（发给参与者）

```ts
export type RoundTaskInput = {
  sessionId: string;
  requestId: string;
  participantId: string;
  phase: "initial" | "debate" | "final_vote";
  round: number;

  prompt: string;

  selfHistoryRef?: {
    stickySession: true;
    // 说明：完整历史主要依赖参与者自己的会话上下文
  };

  peerRoundInputs?: Array<{
    participantId: string;
    round: number;
    fullResponse: string;           // 预算内保留全文
    truncated?: boolean;
  }>;

  claimCatalog?: Claim[];           // 当前统一论点集合（编排器维护）

  metadata?: Record<string, unknown>;
};
```

---

## 3. 参与者输出（逐论点）

```ts
export type Claim = {
  claimId: string;
  title: string;
  statement: string;
  category?: "pro" | "con" | "risk" | "tradeoff" | "todo";
};

export type ClaimJudgement = {
  claimId: string;
  stance: "agree" | "disagree" | "revise";
  confidence: number;               // 0~1
  rationale: string;
  revisedStatement?: string;        // stance=revise/disagree 时可填
};

export type ParticipantRoundOutput = {
  participantId: string;
  phase: "initial" | "debate" | "final_vote";
  round: number;

  fullResponse: string;             // 原始完整回答

  extractedClaims?: Claim[];        // initial 阶段可新增
  judgements: ClaimJudgement[];     // 对现有 claim 逐条表态

  selfScore?: number;               // 可选：参与者自评
  vote?: "accept" | "reject";     // final_vote 阶段必填

  summary: string;
};
```

---

## 4. 等待与编排（补上“等待”坑位）

```ts
export interface AgentTaskDelegate {
  dispatch(task: RoundTaskInput): Promise<{ taskId: string; participantId: string }>;

  // 推荐事件驱动：宿主回调推进
  awaitResult(taskId: string, timeoutMs?: number): Promise<{
    ok: boolean;
    output?: ParticipantRoundOutput;
    error?: string;
  }>;

  cancel?(taskId: string): Promise<void>;
}

export interface WaitCoordinator {
  waitRound(args: {
    round: number;
    taskIds: string[];
    policy: NonNullable<ArgueStartInput["waitingPolicy"]>;
  }): Promise<{
    completed: ParticipantRoundOutput[];
    timedOutTaskIds: string[];
    failedTaskIds: string[];
  }>;
}
```

等待策略（v0）：

1. 发完一轮后进入 `waitRound`。
2. 优先事件驱动收集结果；无事件时按策略轮询。
3. 到达 `perRoundTimeoutMs`：
   - 有最小有效人数（>=2）则继续下一步并标记缺席。
   - 否则会话 `failed`。
4. 允许迟到结果在 finalize 前补入（按 `lateArrivalPolicy`）。

---

## 5. 最终输出协议

```ts
export type ParticipantScore = {
  participantId: string;
  total: number;
  byRound: Array<{ round: number; score: number }>;
  breakdown?: {
    correctness?: number;
    completeness?: number;
    actionability?: number;
    consistency?: number;
  };
};

export type ArgueResult = {
  requestId: string;
  sessionId: string;
  status: "consensus" | "unresolved" | "failed";

  finalClaims: Claim[];

  representative: {
    participantId: string;          // 分数最高者
    reason: "top-score" | "tie-breaker";
    score: number;
    speech: string;                 // 代表发言文本
  };

  scoreboard: ParticipantScore[];

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

  rounds: Array<{
    round: number;
    outputs: ParticipantRoundOutput[];
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

## 6. 与宿主的边界（再次强调）

`argue` 本体仅提供：

- 状态机与轮次编排
- 协议定义
- 等待与超时控制
- 评分与代表发言选择

宿主负责：

- 外部触发源（GitHub/IM/CLI）
- 具体 agent 调用实现
- 外部结果回写
