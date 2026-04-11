# argue

**[English](README.md) | [中文](README_CN.md)**

> _議論が深まるほど、答えは研ぎ澄まされる。_

argue は構造化されたマルチエージェント討論エンジンです。複数の AI エージェントが同じ問題を独立に分析し、ラウンドを超えて互いの主張を検証し合い、投票によって合意を形成します——単一エージェントでは到達できない品質の結果を生み出します。

問いを与えれば、クロスレビューを経た主張、合意度を定量化した投票結果、そしてピアレビュースコアリングに裏付けされた代表レポートが返されます。ハルシネーションが減り、厳密さが増します。

## クイックスタート

### インストール

```bash
npm install -g @onevcat/argue-cli
```

### 設定

```bash
# 設定ファイルを作成 (~/.config/argue/config.json)
argue config init

# プロバイダーとエージェントを追加
argue config add-provider --id claude --type cli --cli-type claude --model-id sonnet --agent claude-agent
argue config add-provider --id codex --type cli --cli-type codex --model-id gpt-5.3-codex --agent codex-agent
```

### 討論を開始

```bash
argue run --task "マイクロサービスにはモノレポとポリレポのどちらを採用すべきか？"
```

`--verbose` をつけると、各エージェントの推論過程・主張・判断がリアルタイムで確認できます。

エージェントに結果を**実行**させるには `--action` を追加：

```bash
argue run \
  --task "この issue を調査して解決策を検討：https://github.com/onevcat/argue/issues/22" \
  --action "合意に基づいて issue を修正し、PR を作成" \
  --verbose
```

### 実行結果

```
[argue] run started
  task: 研究这个 issue 的解法：https://github.com/onevcat/argue/issues/22
  agents: claude-agent, codex-agent
  rounds: 2..3 | composer: representative

[argue] initial#0 dispatched -> claude-agent, codex-agent
[argue] initial#0 codex-agent responded (claims+6, judgements=0, votes=0)
  推荐在 monorepo 根落地共享 ESLint+Prettier 配置，给两个 package 补 lint/format，
  并在 CI 加 lint 门禁；规则先轻量化（recommended）以快速稳定落地，后续再渐进加严。
[argue] initial#0 claude-agent responded (claims+6, judgements=0, votes=0)
  Identified 6 issues through code review: double normalization in delegate+runner,
  API runner message leakage across task kinds, CLI template {phase} bug for actions,
  hardcoded timeout in argue act. Unable to access the actual issue #22 content
  due to network restrictions.
[argue] initial#0 completed: done=2 timeout=0 failed=0 claims=6 (+6, -0)

[argue] debate#1 dispatched -> claude-agent, codex-agent
[argue] debate#1 codex-agent responded (claims+4, judgements=1✗ 5↻, votes=0)
  Most existing claims are valid-but-out-of-scope for issue #22; c6 duplicates c2.
  The solution focus should shift to ESLint/Prettier setup, package scripts,
  and CI lint checks.
[argue] debate#1 claude-agent responded (claims+5, judgements=5✗ 1↻, votes=0)
  Agree with codex-agent that issue #22 is about ESLint/Prettier setup.
  My previous claims (c1-c6) are off-topic.
[argue] debate#1 claim merged c6 -> c2

  ...（さらに 2 ラウンドの詳細な議論を経て収束）...

[argue] final_vote#4 claude-agent responded (claims+0, judgements=11✓, votes=11)
[argue] final_vote#4 codex-agent responded (claims+0, judgements=11✓, votes=11)

[argue] result: consensus
  representative: codex-agent (score: 83.70)
  Scoreboard:
  codex-agent: 83.70 (cor=74.29, cpl=87.20, act=91.60, con=86.64)
  claude-agent: 81.86 (cor=65.79, cpl=90, act=94, con=85.54)

[argue] action completed by codex-agent
  已按共识完成 #22，并已开 PR：https://github.com/onevcat/argue/pull/28
```

何が起きたか：codex-agent は issue にアクセスし、ESLint/Prettier タスクとして正しく特定、6 つの実行可能な主張を提出しました。claude-agent はネットワーク制限で URL にアクセスできず、代わりにコードレビューを行い 6 つのランタイムバグを発見しました。最初の討論ラウンドで、codex-agent は claude-agent の主張を有効だがスコープ外と指摘（judgements `1✗ 5↻`）、claude-agent は同意して自己修正しました（judgements `5✗ 1↻`）。さらに 2 ラウンドの詳細な議論を経て、全 11 件の主張が最終投票で全会一致で可決。代表エージェントが合意を実際の PR に変換しました。

各実行後、argue は 3 つの出力ファイルを `~/.argue/output/<requestId>/`（グローバル設定）または `./out/<requestId>/`（ローカル設定）に書き出します：

| ファイル       | 内容                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| `events.jsonl` | ストリーミングイベントログ——dispatch、応答、統合、投票、スコアリングの全記録 |
| `result.json`  | 構造化された結果——ステータス、主張、決議、スコア、代表、アクション           |
| `summary.md`   | 代表エージェントが作成した人間が読めるレポート                               |

[この実行の完全な出力を確認する。](https://gist.github.com/onevcat/bbf42778888180c443bea78f395f255b)

## ライブラリとして使用

argue-cli の裏側にあるのは `@onevcat/argue`、任意のシステムに組み込める独立した討論エンジンです。`AgentTaskDelegate` という 1 つのインターフェースを実装するだけで、argue エンジンがすべてのオーケストレーションを処理します。

### インストール

```bash
npm install @onevcat/argue
```

### Delegate の実装

```ts
import type { AgentTaskDelegate } from "@onevcat/argue";

const delegate: AgentTaskDelegate = {
  async dispatch(task) {
    // タスクを発行し、taskId を即座に返す。エンジンは全参加者を
    // 並列に dispatch してから個別に結果を await するため、
    // ここで長時間ブロックせず速やかに返すこと。
    const taskId = await myAgentFramework.submit(task);
    return { taskId, participantId: task.participantId, kind: task.kind };
  },

  async awaitResult(taskId, timeoutMs) {
    // taskId ごとに結果を収集。エンジンはこれを使ってタイムアウト、
    // 排除、段階的な結果確定を管理する。
    const result = await myAgentFramework.waitFor(taskId, timeoutMs);
    return { ok: true, output: result };
  }
};
```

### エンジンの実行

```ts
import { ArgueEngine, MemorySessionStore, DefaultWaitCoordinator } from "@onevcat/argue";

const engine = new ArgueEngine({
  taskDelegate: delegate,
  sessionStore: new MemorySessionStore(),
  waitCoordinator: new DefaultWaitCoordinator(delegate)
});

const result = await engine.start({
  requestId: "review-42",
  task: "PR #42 のセキュリティと正確性の問題をレビュー",
  participants: [
    { id: "security-agent", role: "security-reviewer" },
    { id: "arch-agent", role: "architecture-reviewer" },
    { id: "correctness-agent", role: "correctness-reviewer" }
  ],
  roundPolicy: { minRounds: 2, maxRounds: 4 },
  consensusPolicy: { threshold: 0.67 },
  reportPolicy: { composer: "representative" },
  actionPolicy: {
    prompt: "発見されたすべての問題を修正し、サマリーコメントを投稿。"
  }
});

// result.status → "consensus" | "partial_consensus" | "unresolved"
// result.claimResolutions → 主張ごとの投票結果
// result.representative → 最高スコアのエージェント
// result.action → アクション出力（actionPolicy が設定されている場合）
```

### 統合例：Claude Code Hook

hook を通じて argue を既存ツールに接続できます。例えば、[Claude Code hook](https://docs.anthropic.com/en/docs/claude-code/hooks) として、コミット前にマルチエージェントレビューをトリガー：

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
  task: "ステージされた変更をバグ、セキュリティ問題、スタイル違反の観点でレビュー",
  participants: [
    { id: "security", role: "security-reviewer" },
    { id: "quality", role: "code-quality-reviewer" }
  ],
  roundPolicy: { minRounds: 1, maxRounds: 2 },
  consensusPolicy: { threshold: 1.0 }
});

if (result.status !== "consensus") {
  console.error("レビューが合意に達しませんでした。コミットをブロックします。");
  process.exit(1);
}
```

## 仕組み

### 討論フロー

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

### 各フェーズのルール

| フェーズ                  | エージェントの動作                                          | エンジンの動作                               |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| **Initial**（ラウンド 0） | 主張を提出、既存の主張を評価                                | すべての主張を共有プールに集約               |
| **Debate**（1..N）        | 他者の主張を評価（`agree`/`disagree`/`revise`）、統合を提案 | 重複を統合、立場の変化を追跡、早期終了を判定 |
| **Final Vote**（N+1）     | 各アクティブな主張に `accept`/`reject` で投票               | 主張ごとの合意率を閾値と比較                 |

### 主要メカニズム

- **主張のライフサイクル**：各主張のステータスは `active`、`merged`、`withdrawn`。統合された主張は提案者を存続する主張に引き継ぎます。
- **早期終了**：すべての判断が一致し新しい主張が出なければ、`minRounds` 到達後に討論を早期終了——無駄なラウンドを削減。
- **排除**：タイムアウトまたはエラーのエージェントは永久に除外。合意計算の分母は自動調整されます。
- **スコアリング**：正確性（35%）、網羅性（25%）、実行可能性（25%）、一貫性（15%）の4軸でピアレビュー評価。
- **代表**：最高スコアのエージェントが最終レポートを作成。失敗時は内蔵サマリーにフォールバック。
- **アクション**：オプションで、代表（または指定エージェント）が合意に基づいて実際の操作を実行。

### プロバイダータイプ

CLI はエージェント接続用に 4 つのプロバイダータイプをサポート：

| タイプ | 用途                                               | 例                                                 |
| ------ | -------------------------------------------------- | -------------------------------------------------- |
| `cli`  | CLI インターフェースを持つコーディングエージェント | Claude Code, Codex CLI, Copilot CLI, Gemini CLI    |
| `api`  | モデル API への直接アクセス                        | OpenAI, Anthropic, Ollama, OpenAI 互換 API         |
| `sdk`  | エージェントフレームワーク用カスタムアダプター     | 独自の SDK 統合                                    |
| `mock` | テストと開発                                       | 決定的なレスポンス、タイムアウトのシミュレーション |

## 設定リファレンス

完全な設定例：[`packages/argue-cli/examples/config.example.json`](packages/argue-cli/examples/config.example.json)

設定ファイルの検索順序：

1. `--config <path>` フラグ
2. `./argue.config.json`（ローカル）
3. `~/.config/argue/config.json`（グローバル）

CLI フラグ > input JSON > 設定デフォルト値。

## 開発

```bash
npm install
npm run dev              # watch モード
npm run ci               # 型チェック + テスト + ビルド
npm run release:check    # tarball スモークテスト付き
```

## License

MIT
