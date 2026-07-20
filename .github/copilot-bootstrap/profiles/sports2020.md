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
