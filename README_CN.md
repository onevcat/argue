# argue

**[English](README.md) | [日本語](README_JP.md)**

> _兼听则明，偏信则暗。_ —— 魏徵，《资治通鉴》

argue 是一个结构化的多 Agent 辩论引擎。多个 AI Agent 独立分析同一个问题，跨轮次互相质疑彼此的主张，最终通过投票达成共识——比任何单个 Agent 都能产出更高质量的结果。

给它一个问题，拿回经过交叉审查的主张、量化了共识程度的投票结果，以及一份基于同行评审打分的代表性报告。更少幻觉，更多严谨。

## 在线 Demo

[![一份在官方 viewer 中渲染的 argue 示例报告](docs/assets/argue-report-sample.jpeg)](https://argue.onev.cat/example)

**[https://argue.onev.cat/example](https://argue.onev.cat/example)** —— 一次真实的 argue 运行，渲染在官方 viewer 里。打开就能看到 argue 实际产出的东西：

- **agent 当面对线。** 每条主张、每次同行判断、每次合并和投票，按轮次完整呈现。
- **一份精致的报告。** 由得分最高的 agent 撰写，开箱即读，可以分享、可以贴进 PR。
- **完整原始数据落盘。** 渲染 viewer 用的同一份 JSON 保留在本地，可以喂给下游任意步骤（代码审查机器人、代码生成、审计日志……）。

## 安装 argue skill

已经在用支持 skill 的 coding agent（Claude Code、Codex 等等）？那就把整套流程交给 agent。argue 以 [agent skill](https://skills.sh/) 的形式发布，内置了何时用 argue、怎么装和配置 CLI、推荐哪些默认值、怎么端到端跑一次辩论的全套指引。

```bash
npx skills add https://github.com/onevcat/argue --skill argue
```

装完之后直接跟 agent 说"让 argue 讨论一下 X"或"帮我问一下第二意见"就行。它会在首次使用时帮你搭好 CLI（全局安装前会先跟你确认），然后替你把辩论、报告、以及任何后续 action 一条龙跑完。

## 快速开始

如果你偏好像"原始人"那样亲手敲 CLI，那就请便——下面是手动路线。

### 安装

```bash
npm install -g @onevcat/argue-cli
```

### 配置

```bash
# 创建配置文件 (~/.config/argue/config.json)
argue config init

# 添加 provider 和 agent
argue config add-provider --id claude --type cli --cli-type claude --model-id sonnet --agent claude-agent
argue config add-provider --id codex --type cli --cli-type codex --model-id gpt-5.3-codex --agent codex-agent
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
  agents: claude-agent, codex-agent | rounds: 2..3

[argue] initial#0  codex-agent (claims+6) — ESLint+Prettier setup, CI lint gate
[argue] initial#0  claude-agent (claims+6) — runtime bugs (couldn't access the issue URL)

[argue] debate#1   codex-agent (1✗ 5↻) — claude's claims valid but out-of-scope
[argue] debate#1   claude-agent (5✗ 1↻) — agreed, self-corrected
[argue] debate#1   claim merged c6 -> c2
  ... 2 more rounds, agents refine and converge ...

[argue] final_vote  11/11 claims accepted unanimously
[argue] result: consensus — codex-agent representative (83.70)
[argue] action: codex-agent opened PR #28
```

codex-agent 访问了 issue 并提出 ESLint/Prettier 相关主张。claude-agent 因网络限制无法访问 URL，转而发现了运行时 bug。辩论中 codex-agent 指出这些主张超出范围，claude-agent 自我修正，双方收敛。全部 11 条主张全票通过，代表 agent 将共识转化为[实际的 PR](https://github.com/onevcat/argue/pull/28)。

每次运行后，argue 会将三个输出文件写入 `~/.argue/output/<requestId>/`（全局配置）或 `./out/<requestId>/`（本地配置）：

| 文件           | 内容                                                |
| -------------- | --------------------------------------------------- |
| `events.jsonl` | 流式事件日志——每次 dispatch、响应、合并、投票和评分 |
| `result.json`  | 结构化结果——状态、主张、决议、评分、代表、action    |
| `summary.md`   | 代表 agent 撰写的可读报告                           |

[查看这次运行的完整输出。](https://gist.github.com/onevcat/bbf42778888180c443bea78f395f255b)

### 查看报告

每次运行结束后，argue 会打印一行提示，告诉你如何在托管 viewer 中打开本次报告：

```
→ View report: argue view argue_1712345678901_a3f9c2
```

也可以直接打开最近一次运行：

```bash
argue view                  # 打开最近一次运行
argue view <request-id>     # 打开指定的运行
argue run --view            # 运行完成后自动打开
```

报告会被 gzip 压缩后以 base64url 编码写入 URL fragment，所有解码都在浏览器端完成——**任何服务器都不会收到数据**。默认的 viewer 托管在 `https://argue.onev.cat/`。如需指定其它地址（例如本地 viewer 开发），在 config 里设置 `viewer.url` 或通过 `--viewer-url https://your-viewer/` 覆盖。

### 常用选项

对于复杂或重复的任务，可以使用 [input JSON 文件](https://github.com/onevcat/argue/blob/master/packages/argue-cli/examples/task.example.json)代替内联参数：

```bash
argue run --input task.json
```

常用参数：

```bash
--agents a1,a2                            # 从配置中选择特定 agent
--min-participants 2                      # 继续辩论所需的最少存活参与者数
--on-insufficient-participants interrupt  # interrupt（默认）或 fail
--min-rounds 2                            # 至少 2 轮辩论才能提前停止
--max-rounds 5                            # 辩论轮数上限
--threshold 0.67                          # 共识阈值（默认 1.0 = 全票通过）
--action "修复它"                          # 辩论后由代表执行的操作
--verbose                                 # 实时显示每个 agent 的推理过程
```

运行 `argue --help` 查看完整参数列表。

> **0.5.0 行为变更：** 当存活参与者降到 `minParticipants` 以下时，argue 现在会返回结构化的 `interrupted` 结果，而不是直接抛硬错误。如需保留旧行为，在命令行使用 `--on-insufficient-participants fail`，或在配置中设置 `defaults.participantsPolicy.onInsufficientParticipants: "fail"`。

## 作为库使用

argue-cli 的背后是 `@onevcat/argue`，一个独立的辩论引擎，可以嵌入到任何系统中。你只需实现一个接口——`AgentTaskDelegate`，argue 引擎负责所有编排工作。

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

// result.status → "consensus" | "partial_consensus" | "unresolved" | "interrupted" | "failed"
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

`reasoning` 是 provider model 配置和 agent 配置上的可选字符串：

- `providers.<id>.models.<modelId>.reasoning`：model 级默认值
- `agents[].reasoning`：agent 级覆盖

`reasoning` 的透传是 best-effort，取决于 provider 类型/运行路径：

- `cli` providers：
  - `claude` → `--effort <reasoning>`
  - `codex` → `-c model_reasoning_effort=<reasoning>`
  - `generic` → 作为 stdin envelope 中的 `agent.reasoning` 传递
  - 其他 `cliType` → no-op，并告警（每个 runner 仅一次）
- `api` providers：当前为 no-op（配置可接受，但尚未向下游转发）

用户责任：

- `argue` 只存储/转发该字符串，不校验 provider 可接受值是否合法。
- 与下游模型/工具能力的兼容性由用户自行保证。
- 如果 provider 拒绝该值，错误会由下游 runtime/API 暴露。

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
