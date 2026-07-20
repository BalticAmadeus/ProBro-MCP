# ProBro MCP Server

Standalone MCP server for ProBro/OpenEdge database access.

It exposes ProBro-style database operations as MCP tools so other extensions, agents, or clients can use them.

## Docs map

- README.md: primary setup and day-to-day usage.
- HTTP-WRAPPER.md: HTTP endpoint reference.
- COPILOT-CHAT-INTEGRATION.md: advanced Copilot Chat + HTTP wrapper examples and troubleshooting.
- .github/copilot-bootstrap/global-rules.md: reusable AI agent rules for any DB.
- .github/copilot-bootstrap/profiles/<profile>.md: DB-specific AI guidance.
- .github/copilot-instructions.md: generated active instruction file consumed by Copilot in this workspace (do not edit directly).

## Features

- Reuses the ProBro OpenEdge command protocol (base64 JSON over TCP)
- Supports both local and remote runtime modes
- Exposes schema, query, and CRUD operations
- Includes smoke and integration tests

## MCP tools

- `probro_set_connection`
- `probro_get_connection_status`
- `probro_get_version`
- `probro_list_tables`
- `probro_get_table_details`
- `probro_query_table`
- `probro_mutate_table`

## Requirements

- Node.js 18+
- OpenEdge runtime available when using local mode

## Install

```bash
npm install
```

## Start server

### As MCP Server (stdio)

```bash
npm start
```

### As HTTP REST API

For easier testing or integration with Copilot Chat:

```bash
npm run start:http
```

Server runs on `http://localhost:3000` (configurable via `PROBRO_HTTP_PORT`).

See [HTTP-WRAPPER.md](HTTP-WRAPPER.md) for HTTP endpoint documentation.

### Run Example Client

```bash
node example-client.mjs
```

Demonstrates all HTTP API endpoints with a real database connection.

## MCP client configuration example

```json
{
    "mcpServers": {
        "probro": {
            "command": "node",
            "args": ["c:/path/to/ProBro/mcp-server/src/index.js"]
        }
    }
}
```

## Out-of-box VS Code setup

This repository includes workspace MCP configuration in `.vscode/mcp.json`.

When VS Code starts MCP for this workspace, it runs `node src/index.js` and auto-connects from ProBro state first.

For this repository, saved ProBro state is the primary auto-connect source. Workspace settings are supported as a fallback, and `PROBRO_*` env vars are still supported as optional overrides.

The server supports both the temporary `probro.*` keys used in this repository and the real ProBro extension-style `pro-bro.*` keys.

Supported setting keys (fallbacks):

- `probro.mcp.autoConnect`, `probro.autoConnect`
- `probro.mcp.mode`, `probro.connection.mode`, `probro.mode`
- `probro.mcp.database`, `probro.connection.database`, `probro.database`
- `probro.mcp.agentHost`, `probro.connection.agentHost`, `probro.agentHost`
- `probro.mcp.agentPort`, `probro.connection.agentPort`, `probro.agentPort`
- `probro.mcp.dlc`, `probro.connection.dlc`, `probro.dlc`

This makes CRUD flows seamless when ProBro extension state is already configured in VS Code.

Saved ProBro connection definitions from VS Code state (`pro-bro.dbconfig`) are exposed through `probro_get_saved_connections` for inspection, but they are not used as an automatic connection fallback.

## Connection modes

### Local mode

Starts OpenEdge runtime from this repository under `resources/oe`.

Required tool args for `probro_set_connection`:

- `mode`: `local`
- `dlc`: OpenEdge DLC path
- `database`: database name or path

Optional:

- `projectRoot` (defaults to repo root)
- `agentPort` (defaults to `23456`)
- `dbHost`, `dbPort`, `user`, `password`, `params`
- `startupTimeoutMs`, `socketTimeoutMs`
- `tempFilesPath`, `logEntryTypes`

Important:

- If OpenEdge cannot resolve a short DB name in local mode, set `database` to an absolute `.db` path.

### Remote mode

Connects to an already-running OpenEdge agent.

Required tool args for `probro_set_connection`:

- `mode`: `remote`
- `agentHost`
- `agentPort`
- `database`

Optional:

- `dbHost`, `dbPort`, `user`, `password`, `params`
- `startupTimeoutMs`, `socketTimeoutMs`

## Minimal tool call examples

Local:

```json
{
    "name": "probro_set_connection",
    "arguments": {
        "mode": "local",
        "dlc": "C:\\Progress\\OpenEdge",
        "database": "C:\\data\\sports2020.db",
        "agentPort": 23456
    }
}
```

Remote:

```json
{
    "name": "probro_set_connection",
    "arguments": {
        "mode": "remote",
        "agentHost": "127.0.0.1",
        "agentPort": 23456,
        "database": "sports2020"
    }
}
```

## Testing

### Smoke test

Checks that the MCP server starts and all tools are registered.

```bash
npm run test:smoke
```

### Integration test

Performs a real connection and validates table listing.

```bash
npm run test:integration
```

Environment variables used by integration test:

- `PROBRO_MCP_MODE`: `remote` (default) or `local`
- `PROBRO_DB_DATABASE`: required

Remote mode:

- `PROBRO_AGENT_HOST`: required
- `PROBRO_AGENT_PORT`: optional (default `23456`)

Local mode:

- `PROBRO_DLC`: required
- `PROBRO_AGENT_PORT`: optional (default `23456`)
- `PROBRO_PROJECT_ROOT`: optional

Optional DB parameters:

- `PROBRO_DB_USER`
- `PROBRO_DB_PASSWORD`
- `PROBRO_DB_HOST`
- `PROBRO_DB_PORT`
- `PROBRO_DB_PARAMS`

PowerShell example (local mode):

```powershell
$env:PROBRO_MCP_MODE="local"
$env:PROBRO_DLC="C:\Progress\OpenEdge"
$env:PROBRO_DB_DATABASE="C:\data\sports2020.db"
$env:PROBRO_AGENT_PORT="23456"
npm run test:integration
```

## Using with Copilot Chat

You can expose the ProBro database to GitHub Copilot Chat via the HTTP wrapper:

1. Start the HTTP wrapper: `npm run start:http`
2. Build agent bootstrap instructions: `npm run copilot:bootstrap`
3. Optional: choose a DB profile (PowerShell: `$env:COPILOT_DB_PROFILE="sports2020"; npm run copilot:bootstrap`, bash: `COPILOT_DB_PROFILE=sports2020 npm run copilot:bootstrap`)
4. Keep global rules in `.github/copilot-bootstrap/global-rules.md`
5. Keep DB-specific rules in `.github/copilot-bootstrap/profiles/<profile>.md`
6. Start asking Copilot Chat questions about your database

See [COPILOT-CHAT-INTEGRATION.md](COPILOT-CHAT-INTEGRATION.md) for advanced HTTP wrapper examples and troubleshooting.

## Current limitations

- Local runtime bootstrap is currently Windows-focused.
- On Linux/macOS, use remote mode unless you add platform-specific startup logic.
