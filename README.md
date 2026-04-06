# argue

A harness-agnostic orchestration package for multi-agent consensus workflows.

## Positioning

`argue` only does orchestration.

- It does **not** fetch input from GitHub/Discord/MeowHook/OpenClaw.
- It does **not** bind to any specific agent runtime.
- It defines stable interfaces for:
  - receiving normalized task input
  - dispatching agent tasks via delegates
  - collecting replies
  - running multi-round consensus
  - emitting structured outputs/events

## Status

- Draft planning stage.
- Initial plan: `docs/plan/v0-initial.md`
