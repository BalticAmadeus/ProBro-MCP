# ProBro HTTP Wrapper

This wrapper exposes the ProBro MCP server as REST endpoints, making it easy to call from HTTP clients like Copilot Chat, browser clients, or cURL.

## Starting the Server

```bash
npm run start:http
```

The server starts on `http://localhost:3000` by default. You can override the port:

```bash
PROBRO_HTTP_PORT=5000 npm run start:http
```

## API Endpoints

All endpoints are `POST` and accept/return JSON.

### `POST /api/probro_set_connection`

Sets up the database connection.

**Request:**

```json
{
    "mode": "local",
    "dlc": "C:/Progress/OpenEdge",
    "database": "C:/OpenEdge/WRK/sports2020/sports2020.db",
    "agentPort": 23456
}
```

**Response:**

```json
{
  "ok": true,
  "tool": "probro_set_connection",
  "result": {
    "ok": true,
    "runtime": { ... },
    "version": { ... }
  }
}
```

### `POST /api/probro_get_version`

Get ProBro and OpenEdge version info.

**Request:**

```json
{}
```

**Response:**

```json
{
  "ok": true,
  "tool": "probro_get_version",
  "result": {
    "debug": { ... },
    "dbversion": "12",
    "proversion": "12.8.6.0.1236"
  }
}
```

### `POST /api/probro_list_tables`

List all tables in the database.

**Request:**

```json
{}
```

**Response:**

```json
{
  "ok": true,
  "tool": "probro_list_tables",
  "result": [
    { "table": "Customer", "type": "Data" },
    { "table": "Invoice", "type": "Data" },
    ...
  ]
}
```

### `POST /api/probro_get_table_details`

Get column details for a table.

**Request:**

```json
{
    "tableName": "Customer"
}
```

**Response:**

```json
{
  "ok": true,
  "tool": "probro_get_table_details",
  "result": {
    "table": "Customer",
    "fields": [
      {
        "column": "CustNum",
        "type": "INTEGER",
        "extent": 0,
        "mandatory": true
      },
      ...
    ]
  }
}
```

### `POST /api/probro_query_table`

Query data from a table.

**Request:**

```json
{
    "tableName": "Customer",
    "wherePhrase": "where Name starts 'A'",
    "pageLength": 10,
    "start": 0,
    "sort": "CustNum"
}
```

**Response:**

```json
{
  "ok": true,
  "tool": "probro_query_table",
  "result": {
    "table": "Customer",
    "data": [ ... ],
    "count": 5,
    "limit": 10,
    "start": 0
  }
}
```

### `POST /api/probro_mutate_table`

Insert, update, or delete records.

**Request (INSERT):**

```json
{
    "tableName": "Customer",
    "mode": "INSERT",
    "data": {
        "CustNum": 9999,
        "Name": "New Company",
        "Address": "123 Main St"
    }
}
```

**Response:**

```json
{
    "ok": true,
    "tool": "probro_mutate_table",
    "result": {
        "ok": true,
        "table": "Customer",
        "mode": "INSERT",
        "affected": 1
    }
}
```

## Testing

Run the HTTP wrapper test:

```bash
npm run test:http
```

Configure with environment variables:

```bash
set PROBRO_DB_DATABASE=C:/OpenEdge/WRK/sports2020/sports2020.db
set PROBRO_DLC=C:/Progress/OpenEdge
set PROBRO_AGENT_PORT=23456
npm run test:http
```

## Using with cURL

Set connection:

```bash
curl -X POST http://localhost:3000/api/probro_set_connection \
  -H "Content-Type: application/json" \
  -d '{"mode":"local","dlc":"C:/Progress/OpenEdge","database":"C:/OpenEdge/WRK/sports2020/sports2020.db","agentPort":23456}'
```

List tables:

```bash
curl -X POST http://localhost:3000/api/probro_list_tables \
  -H "Content-Type: application/json" \
  -d '{}'
```

Query data:

```bash
curl -X POST http://localhost:3000/api/probro_query_table \
  -H "Content-Type: application/json" \
  -d '{"tableName":"Customer","pageLength":5}'
```

## Using with Copilot Chat

You can configure VS Code Copilot Chat to use this wrapper by creating a custom tool handler. Here's an example using a custom Copilot Chat extension or agent prompt:

### Option 1: Custom Agent Prompt

Create or modify `.github/copilot-instructions.md`:

```markdown
# Database Query Tools

You have access to the ProBro database via HTTP API at http://localhost:3000.

## Available Functions

You can call these endpoints by sending POST requests:

- **setConnection(mode, dlc, database, agentPort)** → /api/probro_set_connection
- **listTables()** → /api/probro_list_tables
- **getTableDetails(tableName)** → /api/probro_get_table_details
- **queryTable(tableName, wherePhrase, pageLength, start, sort)** → /api/probro_query_table
- **mutateTable(tableName, mode, data)** → /api/probro_mutate_table

## Example Workflow

When user asks "What are all the tables in the database?":

1. First call setConnection if not already done
2. Then call listTables
3. Present results in a formatted list

When user asks "Show me the first 10 customers":

1. Call queryTable with tableName="Customer", pageLength=10
2. Format the response as a table
3. Ask if they want more details or filters

## Important Notes

- Always handle errors gracefully
- Display response status and any error messages
- For mutations, ask for confirmation first
- Respect the agentPort configuration (default 23456)
```

### Option 2: VS Code Extension Wrapper

For tighter Copilot Chat integration, you could wrap this in a VS Code extension:

```typescript
// extension.ts
import * as vscode from 'vscode';
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000/api';

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'probro.queryTable',
            async (tableName) => {
                const result = await fetch(`${API_BASE}/probro_list_tables`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                const data = await result.json();
                vscode.window.showInformationMessage(
                    `Found tables: ${JSON.stringify(data)}`,
                );
            },
        ),
    );
}
```

## Error Handling

All error responses follow this format:

```json
{
    "ok": false,
    "error": "Error message here"
}
```

Common errors:

- **"No active ProBro connection"** → Call probro_set_connection first
- **"Connection timeout"** → Increase agentPort timeout or check OpenEdge
- **"Table not found"** → Verify table name spelling
