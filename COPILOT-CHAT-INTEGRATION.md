# ProBro HTTP Wrapper and Copilot Chat (Advanced Guide)

This guide covers advanced HTTP wrapper usage for Copilot Chat. For the main setup flow, use README first.

## Recommended Setup Order

1. Start wrapper server:

```bash
npm run start:http
```

2. Build active Copilot instructions from global rules and DB profile:

```bash
npm run copilot:bootstrap
```

3. Optional profile selection:

- PowerShell:

```powershell
$env:COPILOT_DB_PROFILE="sports2020"
npm run copilot:bootstrap
```

- Bash:

```bash
COPILOT_DB_PROFILE=sports2020 npm run copilot:bootstrap
```

4. Ask Copilot Chat database questions.

Note: .github/copilot-instructions.md is generated. Edit source files in .github/copilot-bootstrap instead:

- .github/copilot-bootstrap/global-rules.md
- .github/copilot-bootstrap/profiles/<profile>.md

## HTTP Endpoint Pattern

All tool endpoints are exposed at:

- POST http://localhost:3000/api/<tool_name>

Examples:

- POST http://localhost:3000/api/probro_set_connection
- POST http://localhost:3000/api/probro_query_table
- POST http://localhost:3000/api/probro_mutate_table

## Request/Response Shape

Request body:

```json
{
    "mode": "remote",
    "agentHost": "127.0.0.1",
    "agentPort": 23456,
    "database": "sports2020"
}
```

Response envelope:

- Success: { "ok": true, "tool": "...", "result": { ... } }
- Failure: { "ok": false, "error": "..." }

## Practical HTTP Examples

### Set Connection

```javascript
const setConn = await fetch("http://localhost:3000/api/probro_set_connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        mode: "remote",
        agentHost: "127.0.0.1",
        agentPort: 23456,
        database: "sports2020"
    })
});

const setConnResult = await setConn.json();
```

### Query Customer

```javascript
const query = await fetch("http://localhost:3000/api/probro_query_table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        tableName: "Customer",
        wherePhrase: "Customer.CustNum = 3000",
        pageLength: 10
    })
});

const queryResult = await query.json();
```

### Update Customer Country (required payload fields)

```javascript
const update = await fetch("http://localhost:3000/api/probro_mutate_table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        tableName: "Customer",
        mode: "UPDATE",
        crud: [],
        data: [
            { key: "Country", value: "USA", defaultValue: "Mexico" }
        ],
        useWriteTriggers: true,
        useDeleteTriggers: true,
        wherePhrase: "Customer.CustNum = 3000",
        lastRowID: "0x0000000000002401"
    })
});

const updateResult = await update.json();
```

## Troubleshooting

### Connection refused on localhost:3000

- Ensure wrapper is running with npm run start:http.
- Confirm PROBRO_HTTP_PORT if using a non-default port.

### No active ProBro connection

- Call probro_set_connection first in the same session.
- Verify remote agent host/port and database values.

### Unknown profile during bootstrap

- List profiles with npm run copilot:profiles.
- Create a new profile from .github/copilot-bootstrap/profiles/TEMPLATE.md.

### Local mode start failures

- If local startup fails with spawn powershell.exe ENOENT, use remote mode.

## When to Edit Which File

- Edit README.md: primary install and usage flow.
- Edit this guide: advanced HTTP examples and troubleshooting.
- Edit .github/copilot-bootstrap files: AI agent behavior rules.
