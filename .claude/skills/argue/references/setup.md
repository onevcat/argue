# Argue Setup & Configuration

## Config Location & Precedence

Argue uses a JSON config file. Lookup order (highest priority first):

1. CLI flags (`--config <path>`)
2. Input JSON (`--input <path>`)
3. Project-local: `./argue.config.json`
4. Global: `~/.config/argue/config.json`

### Init Commands

```bash
# Project-local config (recommended for repos)
argue config init --local

# Global config (for general use)
argue config init --global

# Custom path
argue config init -c /path/to/config.json
```

## Provider Types

### CLI-based providers (recommended)

Agents run via their respective CLIs — no API keys needed if you're already authenticated:

```bash
# OpenAI Codex CLI
argue config add-provider --id codex --type cli --cli-type codex --model-id gpt-5.4

# Google Gemini CLI
argue config add-provider --id gemini --type cli --cli-type gemini --model-id gemini-3.1-pro-preview

# Anthropic Claude CLI
argue config add-provider --id claude --type cli --cli-type claude --model-id claude-4-sonnet

# GitHub Copilot CLI
argue config add-provider --id copilot --type cli --cli-type copilot --model-id gpt-5.4

# Other CLI types: pi, opencode, droid, amp, generic
```

For `generic` CLI type, specify `--command` and `--args`:
```bash
argue config add-provider --id custom --type cli --cli-type generic --command my-cli --args "--model,model-name"
```

### API-based providers

For direct API access without a CLI:

```bash
# Anthropic API (uses ANTHROPIC_API_KEY env var)
argue config add-provider --id anthropic --type api --vendor anthropic --model-id claude-4-sonnet

# OpenAI API (uses OPENAI_API_KEY env var)
argue config add-provider --id openai --type api --vendor openai --model-id gpt-5.4

# OpenAI-compatible endpoint (Ollama, vLLM, etc.)
argue config add-provider --id local \
  --type api --protocol openai-compatible \
  --base-url http://localhost:11434/v1 \
  --model-id llama3

# Other vendors: groq, together, mistral, deepseek
# Custom API key env var: --api-key-env MY_CUSTOM_KEY
```

### SDK-based providers

For custom adapters loaded from Node modules:
```bash
argue config add-provider --id my-sdk --type sdk --adapter ./my-adapter.js --model-id my-model
```

### Mock provider (testing)

```bash
argue config add-provider --id mock --type mock --model-id test
```

## Adding Agents

Agents reference providers and specify which model to use:

```bash
# Basic agent
argue config add-agent --id codex-agent --provider codex --model gpt-5.4

# Agent with role (affects debate behavior)
argue config add-agent --id devil-agent --provider claude --model claude-4-sonnet --role "devil's advocate"

# Agent with custom system prompt
argue config add-agent --id expert-agent --provider gemini --model gemini-3.1-pro-preview --system-prompt "You are a senior architect with 20 years experience."

# Agent with temperature and timeout
argue config add-agent --id creative-agent --provider openai --model gpt-5.4 --temperature 0.9 --timeout-ms 120000
```

## Removing Providers/Agents

No CLI command exists for removal. Edit the config file directly:

```bash
# Edit with your preferred editor
code ~/.config/argue/config.json
# or for project-local
code ./argue.config.json
```

Remove entries from the `providers` object or `agents` array, then save.

## Config Schema (v1)

```json
{
  "schemaVersion": 1,
  "providers": {
    "<provider-id>": {
      "type": "cli|api|sdk|mock",
      "cliType": "codex|claude|gemini|...",
      "command": "optional-binary-name",
      "args": [],
      "models": {
        "<model-id>": {}
      }
    }
  },
  "agents": [
    {
      "id": "<agent-id>",
      "provider": "<provider-id>",
      "model": "<model-id>",
      "role": "optional-role-description",
      "systemPrompt": "optional-system-prompt",
      "temperature": 0.7,
      "timeoutMs": 60000
    }
  ]
}
```

## Composer Options

- **`builtin`** (default): Synthesized summary from all agents' contributions
- **`representative`**: Single best agent writes the final report
  ```bash
  argue run --task "..." --composer representative --representative-id codex-agent
  ```