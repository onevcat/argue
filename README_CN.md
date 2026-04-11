# argue

**[English](README.md) | [日本語](README_JP.md)**

> _理越辩越明，架越吵越嗨。_

argue 是一个结构化的多 Agent 辩论引擎。多个 AI Agent 独立分析同一个问题，跨轮次互相质疑彼此的主张，最终通过投票达成共识——比任何单个 Agent 都能产出更高质量的结果。

给它一个问题，拿回经过交叉审查的主张、量化了共识程度的投票结果，以及一份基于同行评审打分的代表性报告。更少幻觉，更多严谨。

## 快速开始

### 安装

```bash
npm install -g @onevcat/argue-cli
```

### 配置

```bash
# 创建配置文件 (~/.config/argue/config.json)
argue config init

# 添加两个 provider（Claude Code + Codex CLI）
argue config add-provider --id claude --type cli --cli-type claude --model-id sonnet
argue config add-provider --id codex --type cli --cli-type codex --model-id gpt-5.3-codex

# 添加 agent
argue config add-agent --id claude-agent --provider claude --model sonnet
argue config add-agent --id codex-agent --provider codex --model gpt-5.3-codex
```

### 发起辩论

```bash
argue run --task "微服务架构应该用 monorepo 还是 polyrepo？"
```

加上 `--verbose` 可以实时查看每个 agent 的推理过程、主张和判断。

需要 agent **付诸行动**？加上 `--action`：

```bash
argue run \
  --task "研究这个 issue 的解法：https://github.com/onevcat/argue/issues/22" \
  --action "根据讨论结果，实际解决这个 issue，开 PR" \
  --verbose
```

### 实际效果

```
[argue] run started
  task: 研究这个 issue 的解法：https://github.com/onevcat/argue/issues/22
  agents: claude-agent, codex-agent
  rounds: 2..3 | composer: representative

[argue] initial#0 dispatched -> claude-agent, codex-agent
[argue] initial#0 codex-agent responded (claims+6)
  推荐在 monorepo 根落地共享 ESLint+Prettier 配置，给两个 package 补 lint/format...
[argue] initial#0 claude-agent responded (claims+6)
  发现运行时问题：double normalization、API message leakage、template bug...

[argue] debate#1 dispatched -> claude-agent, codex-agent
[argue] debate#1 codex-agent responded (judgements=1✗ 5↻)
  大多数现有主张有效但超出 issue #22 的范围...
[argue] debate#1 claude-agent responded (judgements=5✗ 1↻)
  同意 codex-agent 的观点：issue #22 是关于 ESLint/Prettier 配置的。
  我之前的主张跑题了...

  ...（还有 2 轮辩论，agent 逐步收敛）...

[argue] result: consensus
  representative: codex-agent (score: 83.70)
  Claims: 11 active, 11/11 accepted (1 merged)

[argue] action completed by codex-agent
  创建 PR #28 — ESLint + Prettier 配置、CI 集成
```

注意发生了什么：claude-agent 最初误判了问题（它无法访问 GitHub issue），在结构化辩论中，codex-agent 的纠正促使 claude-agent 自我修正并收敛。最终共识全票通过，代表 agent 将结论转化为了一个实际的 PR。

[查看这次运行的完整输出。](https://gist.github.com/onevcat/bbf42778888180c443bea78f395f255b)

## 作为库使用

CLI 构建在 `@onevcat/argue` 之上，这是一个独立的引擎，可以嵌入到任何系统中。只需实现一个接口——`AgentTaskDelegate`——引擎负责所有编排工作。

### 安装

```bash
npm install @onevcat/argue
```

### 实现 Delegate

```ts
import type { AgentTaskDelegate } from "@onevcat/argue";

const delegate: AgentTaskDelegate = {
  async dispatch(task) {
    // 发起任务并立即返回 taskId。引擎会并行 dispatch 所有参与者，
    // 然后分别 await 结果——所以这里应尽快返回，不要长时间阻塞。
    const taskId = await myAgentFramework.submit(task);
    return { taskId, participantId: task.participantId, kind: task.kind };
  },

  async awaitResult(taskId, timeoutMs) {
    // 按 taskId 收集结果。引擎用它来管理超时、淘汰和逐步结算。
    const result = await myAgentFramework.waitFor(taskId, timeoutMs);
    return { ok: true, output: result };
  }
};
```

### 运行引擎

```ts
import { ArgueEngine, MemorySessionStore, DefaultWaitCoordinator } from "@onevcat/argue";

const engine = new ArgueEngine({
  taskDelegate: delegate,
  sessionStore: new MemorySessionStore(),
  waitCoordinator: new DefaultWaitCoordinator(delegate)
});

const result = await engine.start({
  requestId: "review-42",
  task: "审查 PR #42 的安全性和正确性问题",
  participants: [
    { id: "security-agent", role: "security-reviewer" },
    { id: "arch-agent", role: "architecture-reviewer" },
    { id: "correctness-agent", role: "correctness-reviewer" }
  ],
  roundPolicy: { minRounds: 2, maxRounds: 4 },
  consensusPolicy: { threshold: 0.67 },
  reportPolicy: { composer: "representative" },
  actionPolicy: {
    prompt: "修复所有发现的问题并发布总结评论。"
  }
});

// result.status → "consensus" | "partial_consensus" | "unresolved"
// result.claimResolutions → 每个主张的投票结果
// result.representative → 得分最高的 agent
// result.action → action 输出（如果设置了 actionPolicy）
```

### 集成示例：Claude Code Hook

可以通过 hook 将 argue 接入现有工具。例如，作为 [Claude Code hook](https://docs.anthropic.com/en/docs/claude-code/hooks)，在每次提交前触发多 agent 审查：

```jsonc
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node ./hooks/argue-review.mjs \"$TASK_INPUT\""
          }
        ]
      }
    ]
  }
}
```

```ts
// hooks/argue-review.mjs
import { ArgueEngine, MemorySessionStore, DefaultWaitCoordinator } from "@onevcat/argue";
import { createDelegate } from "./my-delegate.mjs";

const input = JSON.parse(process.argv[2]);
if (!input.command?.includes("git commit")) process.exit(0);

const delegate = createDelegate();
const engine = new ArgueEngine({
  taskDelegate: delegate,
  sessionStore: new MemorySessionStore(),
  waitCoordinator: new DefaultWaitCoordinator(delegate)
});

const result = await engine.start({
  requestId: `pre-commit-${Date.now()}`,
  task: "审查暂存的变更，检查 bug、安全问题和风格违规",
  participants: [
    { id: "security", role: "security-reviewer" },
    { id: "quality", role: "code-quality-reviewer" }
  ],
  roundPolicy: { minRounds: 1, maxRounds: 2 },
  consensusPolicy: { threshold: 1.0 }
});

if (result.status !== "consensus") {
  console.error("审查未达成共识，阻止提交。");
  process.exit(1);
}
```

## 工作原理

### 辩论流程

```
+------+                      +--------+                           +---------+         +---------+
| Host |                      | Engine |                           | Agent A |         | Agent B |
+------+                      +--------+                           +---------+         +---------+
    |                              |                                    |                   |
    |  start(task, participants)   |                                    |                   |
    |------------------------------>                                    |                   |
    |                              |                                    |                   |
    |                              |                 +-------------------+                  |
    |                              |                 | Round 0 - Initial |                  |
    |                              |                 +-------------------+                  |
    |                              |                                    |                   |
    |                              |         dispatch(initial)          |                   |
    |                              |------------------------------------>                   |
    |                              |                   dispatch(initial)|                   |
    |                              |-------------------------------------------------------->
    |                              |              claims                |                   |
    |                              <....................................|                   |
    |                              |                        claims      |                   |
    |                              <........................................................|
    |                              |                                    |                   |
    |                              |                +---------------------+                 |
    |                              |                | Round 1..N - Debate |                 |
    |                              |                +---------------------+                 |
    |                              |                                    |                   |
    |                              |  dispatch(debate + peer context)   |                   |
    |                              |------------------------------------>                   |
    |                              |            dispatch(debate + peer context)             |
    |                              |-------------------------------------------------------->
    |                              |        judgements, merges          |                   |
    |                              <....................................|                   |
    |                              |                  judgements, merges|                   |
    |                              <........................................................|
    |                              |                                    |                   |
    |                       +-------------+                             |                   |
    |                       | early-stop? |                             |                   |
    |                       +-------------+                             |                   |
    |                              |                                    |                   |
    |                              |              +------------------------+                |
    |                              |              | Round N+1 - Final Vote |                |
    |                              |              +------------------------+                |
    |                              |                                    |                   |
    |                              |       dispatch(final_vote)         |                   |
    |                              |------------------------------------>                   |
    |                              |                 dispatch(final_vote)                   |
    |                              |-------------------------------------------------------->
    |                              |      accept/reject per claim       |                   |
    |                              <....................................|                   |
    |                              |                accept/reject per claim                 |
    |                              <........................................................|
    |                              |                                    |                   |
    |                   +---------------------+                         |                   |
    |                   | consensus + scoring |                         |                   |
    |                   +---------------------+                         |                   |
    |                              |                                    |                   |
    |                              |         dispatch(report)           |                   |
    |                              |------------------------------------>                   |
    |                              |       representative report        |                   |
    |                              <....................................|                   |
    |                              |                                    |                   |
    |         ArgueResult          |                                    |                   |
    <..............................|                                    |                   |
    |                              |                                    |                   |
+------+                      +--------+                           +---------+         +---------+
| Host |                      | Engine |                           | Agent A |         | Agent B |
+------+                      +--------+                           +---------+         +---------+
```

### 各阶段规则

| 阶段                        | Agent 做什么                                            | 引擎做什么                                   |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| **Initial**（第 0 轮）      | 提出主张，评判已有主张                                  | 将所有主张汇入共享池                         |
| **Debate**（第 1..N 轮）    | 评判同伴的主张（`agree`/`disagree`/`revise`），提议合并 | 合并重复项，追踪立场变化，检查是否可提前停止 |
| **Final Vote**（第 N+1 轮） | 对每个活跃主张投 `accept`/`reject`                      | 计算每个主张的共识率，与阈值比较             |

### 关键机制

- **主张生命周期**：每个主张的状态为 `active`、`merged` 或 `withdrawn`。合并后的主张会将其提出者转移给存活的主张。
- **提前停止**：如果所有判断一致且没有新主张出现，达到 `minRounds` 后辩论提前结束——不浪费轮次。
- **淘汰机制**：超时或报错的 agent 会被永久移除，共识计算的分母自动调整。
- **评分**：Agent 通过同行评审在正确性（35%）、完整性（25%）、可操作性（25%）和一致性（15%）四个维度上打分。
- **代表**：得分最高的 agent 撰写最终报告。失败时退回到内置摘要。
- **Action**：可选地，代表（或指定 agent）根据共识执行实际操作。

### Provider 类型

CLI 支持四种 provider 类型来连接 agent：

| 类型   | 用途                    | 示例                                            |
| ------ | ----------------------- | ----------------------------------------------- |
| `cli`  | 有 CLI 接口的编码 agent | Claude Code, Codex CLI, Copilot CLI, Gemini CLI |
| `api`  | 直接 API 调用           | OpenAI, Anthropic, Ollama, 任何 OpenAI 兼容 API |
| `sdk`  | 自定义 agent 框架适配器 | 你自己的 SDK 集成                               |
| `mock` | 测试和开发              | 确定性响应、模拟超时                            |

## 配置参考

完整配置示例见 [`packages/argue-cli/examples/config.example.json`](packages/argue-cli/examples/config.example.json)。

配置查找顺序：

1. `--config <path>` 参数
2. `./argue.config.json`（本地）
3. `~/.config/argue/config.json`（全局）

CLI 参数 > input JSON > 配置默认值。

## 开发

```bash
npm install
npm run dev              # watch 模式
npm run ci               # 类型检查 + 测试 + 构建
npm run release:check    # 加上 tarball 冒烟测试
```

## License

MIT
