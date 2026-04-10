# argue CLI v0 plan

## 1. 定位

`argue-cli` 是 `argue` 库的官方 host 前端，目标是把“可集成引擎”变成“可直接运行的产品”。

- 库：`packages/argue`
- CLI：`packages/argue-cli`

## 1.1 决策记录（2026-04-08）

- 使用 **AI SDK** 作为 `type="api"` provider 的默认实现路径，以降低 API provider 接入成本。
- `sdk` provider 直接纳入 v0，可通过 adapter module 接入 agent-native SDK（例如 Claude/Codex/OpenAI Agents 等）。
- provider 与 model 继续使用“逻辑 ID（config）→ providerModel（底层）”映射，保持配置稳定性。
- `mock` provider 作为官方测试/验证路径，必须支持完整 headless run。

## 2. 模式与入口（固定）

### 2.1 无头模式（headless）

- `argue run ...`
- `argue exec ...`（`run` 别名）

## 3. 输入契约

### 3.1 静态配置（catalog）

默认查找顺序：

1. `--config <path>`
2. `./argue.config.json`
3. `~/.config/argue/config.json`

配置内容：

- `providers`：provider 定义（api/cli/sdk/mock）
- `agents`：agent catalog
- `defaults`：默认运行参数与默认参与者
- `output`：默认输出路径模板（支持 `{requestId}`）

### 3.2 单次输入（run input）

- `--input <path>`（例如 `task.json`）
- 用于本次 run 的 task/agents 与策略覆盖

### 3.3 覆盖优先级

`CLI flags > input JSON (--input) > config defaults`

## 4. Headless 参数（v0）

- 选择与输入
  - `--config`
  - `--input`
  - `--agents a,b,c`
  - `--task`
  - `--request-id`
- 输出
  - `--jsonl`
  - `--result`
  - `--summary`
- 轮次与时限
  - `--min-rounds`
  - `--max-rounds`
  - `--per-task-timeout-ms`
  - `--per-round-timeout-ms`
  - `--global-deadline-ms`
- 共识与报告
  - `--threshold`
  - `--composer`
  - `--representative-id`
  - `--trace`
  - `--trace-level`
- 约束
  - `--language`
  - `--token-budget`

## 5. 里程碑

### CLI-M1（已完成）

- JSON config schema + 校验
- run input schema + 校验
- 运行计划解析（resolve run plan）
- 入口模式固定（run/exec）

### CLI-M2（已完成）

- runtime adapters（api via AI SDK + claude/codex/mock）
- 将 run plan 映射到 `AgentTaskDelegate`
- 接入 `ArgueEngine.start()`
- `sdk` provider 类型与 adapter 接口
- artifact 输出：`result.json` + `events.jsonl` + `summary.md`

### CLI-M3（收敛）

- 配置初始化命令（如 `argue config init`）
- `argue agents list` 等可观测命令
