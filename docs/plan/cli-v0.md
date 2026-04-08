# argue CLI v0 plan

## 1. 定位

`argue-cli` 是 `argue` 库的官方 host 前端，目标是把“可集成引擎”变成“可直接运行的产品”。

- 库：`packages/argue`
- CLI：`packages/argue-cli`

## 2. 模式与入口（固定）

### 2.1 交互模式（TUI）

- `argue`（无子命令）
  - 有 TTY：进入 TUI
  - 无 TTY：报错并提示使用 headless
- `argue tui`
  - 强制进入 TUI（无 TTY 则报错）

### 2.2 无头模式（headless）

- `argue run ...`
- `argue exec ...`（`run` 别名）

## 3. 输入契约

### 3.1 静态配置（catalog）

默认查找顺序：

1. `--config <path>`
2. `./argue.config.json`
3. `~/.config/argue/config.json`

配置内容：

- `providers`：provider 定义（api/cli）
- `agents`：agent catalog
- `defaults`：默认运行参数与默认参与者
- `output`：默认输出路径模板（支持 `{requestId}`）

### 3.2 单次输入（run input）

- `--input <path>`（例如 `topic.json`）
- 用于本次 run 的 topic/objective/agents 与策略覆盖

### 3.3 覆盖优先级

`CLI flags > input JSON (--input) > config defaults`

## 4. Headless 参数（v0）

- 选择与输入
  - `--config`
  - `--input`
  - `--agents a,b,c`
  - `--topic`
  - `--objective`
  - `--request-id`
- 输出
  - `--jsonl`
  - `--result`
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
- 入口模式固定（TUI 默认 + run/exec）

### CLI-M2（进行中）

- runtime adapters（claude/codex/mock）
- 将 run plan 映射到 `AgentTaskDelegate`
- 接入 `ArgueEngine.start()`

### CLI-M3（收敛）

- TUI 真正可用（选 agent、填 topic/objective）
- 配置初始化命令（如 `argue config init`）
- `argue agents list` 等可观测命令
