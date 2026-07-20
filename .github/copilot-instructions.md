<!-- AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. -->
<!-- Source: .github/copilot-bootstrap/global-rules.md + selected profile -->

# ProBro MCP Agent Bootstrap Rules

Use these rules at the start of every session. They are ordered by priority.

## 1) Global Rules (Apply To Any OpenEdge DB)

1. Always verify connection first with `probro_get_connection_status`.
2. If not connected, call `probro_set_connection` before any query or mutate call.
3. For `probro_query_table` where clauses, use table-qualified fields.
   - Example: `Customer.CustNum = 3000`
4. For `probro_mutate_table`, always include:
   - `crud` (array, may be empty)
   - `useWriteTriggers`
   - `useDeleteTriggers`
5. For UPDATE operations:
   - Query target row first.
   - Use returned `ROWID` as `lastRowID` in mutate payload.
   - Include `defaultValue` in each `data` entry.
6. After every INSERT, UPDATE, or DELETE, run a verification query and report result.
7. If a mutate call fails, surface exact OpenEdge error code and message before retrying.
8. If the selected DB profile is missing:
   - Create a new profile file from `.github/copilot-bootstrap/profiles/TEMPLATE.md`.
   - Name it to match the active database profile key.
   - Ask the user to confirm DB-specific constraints before performing the first write operation.

## 2) Runtime Caveats (Environment Level)

1. Local mode can fail with `spawn powershell.exe ENOENT` in some MCP stdio setups.
2. Remote mode is generally more reliable if a socket agent is already running.
3. Remote mode requires valid values for:
   - `agentHost`
   - `agentPort`
   - `database`

## 3) Execution Pattern

1. Read intent.
2. Confirm connection.
3. Introspect schema when field names are uncertain.
4. Execute smallest safe query/mutation.
5. Verify and summarize exactly what changed or what was returned.

## 4) Response Contract

1. For reads: return concise result rows and key fields.
2. For writes: return before/after for changed fields when possible.
3. For failures: include error code, likely cause, and next safe step.

## 5) Active DB Profile

# DB Profile: Sports2020

Apply this profile only when connected database is Sports2020.

## Known Constraints

1. DELETE can be blocked by schema/business validation on some tables.
2. Known example: `State` delete may fail with OpenEdge 7347.
3. Do not interpret 7347-style failures as MCP transport failures.

## Field/Relationship Notes

1. Vacation uses `Vacation.EmpNum`.
2. Employee uses `Employee.EmpNum`.
3. Prefer table-qualified fields in `wherePhrase` expressions.

## Query Caveats

1. OPEN QUERY can reject some subquery-like forms.
2. Prefer two-step checks when existence expressions are rejected.

## Verified Examples

1. UPDATE flow: query target row -> use returned `ROWID` as `lastRowID` -> include `defaultValue` in `data`.
2. Distinct-style checks may require client-side dedupe when DB query syntax is constrained.

## 6) Profile Switch Template

When changing databases, keep global rules unchanged and swap only the DB profile file.

Suggested profile format:

- DB name
- Known table constraints
- Required field naming quirks
- High-risk operations
- Verified examples
