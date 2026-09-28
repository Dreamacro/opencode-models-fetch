# opencode-models-fetch

OpenCode plugin that discovers models from provider endpoints returning a models.dev-compatible `{ "models": {} }` response.

## Features

- Queries `/v1/models` with `User-Agent: opencode/discovery`
- Supports custom discovery request headers
- Projects models.dev model data into OpenCode's supported model configuration
- Projects models.dev `reasoning_options` effort levels into OpenCode model variants
- Supports filtering and per-model AI SDK selection through unified `include` rules
- Filters model IDs with `include` and `exclude` regular expressions
- Enables a persisted, provider-specific cache by default
- Immediately uses stale cache data and refreshes it asynchronously
- Retains stale cache data when a refresh request fails
- Provides `/models-fetch:refresh` to delete cache data before restarting OpenCode
- Uses standard Node.js APIs and pnpm without Bun scripts or runtime dependencies

## Installation

```bash
pnpm add opencode-models-fetch
```

Add the plugin and a provider to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-models-fetch"],
  "provider": {
    "gateway": {
      "name": "AI Gateway",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKey": "{env:GATEWAY_API_KEY}",
        "modelsDiscovery": {
          "headers": {
            "X-Tenant": "tenant-name"
          },
          "include": [
            {
              "match": "^claude",
              "npm": "@ai-sdk/anthropic"
            },
            {
              "match": "^(gpt|o[134])",
              "npm": "@ai-sdk/openai"
            }
          ],
          "exclude": ["embedding", "deprecated"]
        }
      }
    }
  }
}
```

Quit and restart OpenCode after changing its configuration.

## Response Format

The discovery endpoint must return an object containing a `models` map:

```json
{
  "models": {
    "claude-sonnet": {
      "id": "claude-sonnet",
      "name": "Claude Sonnet",
      "reasoning": true,
      "tool_call": true,
      "limit": {
        "context": 200000,
        "output": 64000
      },
      "provider": {
        "npm": "@ai-sdk/anthropic"
      }
    },
    "gpt-5": {
      "id": "gpt-5",
      "name": "GPT-5"
    }
  }
}
```

Model-level `provider.npm` and `provider.api` are preserved unless a matching local `include` rule overrides them. Models without a model-level override inherit the OpenCode provider's top-level `npm` and `api` settings.

OpenCode's provider model configuration is close to, but not identical to, the complete models.dev schema. The plugin keeps supported fields and removes unsupported extensions such as models.dev `experimental.modes`.

OpenCode only derives reasoning-effort variants from `reasoning_options` for models loaded from models.dev, so the plugin converts `reasoning_options` of type `effort` into OpenCode `variants` (using the same provider-specific option shapes OpenCode applies, e.g. `reasoningEffort`, `effort`, or `thinkingConfig.thinkingLevel`). `toggle` and `budget_tokens` options are left to OpenCode's built-in model heuristics. Cached data written by older plugin versions does not contain `reasoning_options`; delete the cache with `/models-fetch:refresh` and restart OpenCode to pick up effort variants.

## Configuration

Configure discovery under `provider.<id>.options.modelsDiscovery`:

| Option             | Type                 | Default      | Description                                                                                             |
| ------------------ | -------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `enabled`          | boolean              | `true`       | Enables discovery for this provider.                                                                    |
| `endpoint`         | string               | `/v1/models` | Relative path or absolute discovery URL.                                                                |
| `headers`          | object               | `{}`         | Additional GET request headers.                                                                         |
| `include`          | (string \| object)[] | `[]`         | Ordered model-key allow-list. Strings only filter; objects use `match` and may override `npm` or `api`. |
| `exclude`          | string[]             | `[]`         | Model-key regular expressions applied after `include`. Exclusion wins.                                  |
| `cache.enabled`    | boolean              | `true`       | Enables persisted cache data.                                                                           |
| `cache.ttlSeconds` | number               | `86400`      | Time before a cached inventory is refreshed in the background.                                          |

When `include` is empty, all models are allowed. Otherwise a model must match one rule. The first matching object rule applies its optional `npm` and `api` overrides. Global `exclude` rules are evaluated last and always win.

The plugin always sets the discovery request user agent to `opencode/discovery`. Custom headers may set authorization directly. If no `Authorization` header is supplied and `provider.options.apiKey` is a non-empty string, same-origin discovery requests use it as a bearer token. Absolute cross-origin endpoints never receive the provider API key automatically.

## Cache Behavior

Cache data is stored below the platform data directory:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode-models-fetch/providers/
```

On macOS it defaults to `~/Library/Application Support`; on Windows it uses `LOCALAPPDATA` when available.

- A fresh cache is injected without a network request.
- A stale cache is injected immediately and refreshed asynchronously.
- A successful asynchronous refresh is visible after the next OpenCode restart.
- A failed refresh leaves the stale cache intact and active.
- With no usable cache, the initial discovery request is awaited so models are available in the current session.
- Explicit `provider.<id>.models` entries override discovered models with the same map key.

Cached data contains only the projected model map and source identity. Discovery request headers and API keys are not persisted.

## Refresh Command

Delete all discovery cache data:

```text
/models-fetch:refresh
```

Delete one provider's cache:

```text
/models-fetch:refresh gateway
```

The command only deletes cache data. Quit and restart OpenCode afterward to fetch a new model inventory. The plugin does not add a debug command.

## Development

```bash
pnpm install
pnpm format
pnpm lint
pnpm validate
```

Use `pnpm lint:fix` to apply safe Oxlint fixes. `pnpm validate` checks Oxfmt formatting before linting, type checking, and testing.
`pnpm install` configures Lefthook to run the formatting check and Oxlint before each commit.
