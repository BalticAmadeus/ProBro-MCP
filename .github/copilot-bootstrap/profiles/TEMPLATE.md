# DB Profile: <DB_NAME>

Apply this profile only when connected database is <DB_NAME>.

## Known Constraints

1. List table-level schema/business constraints that commonly affect write operations.
2. Include known OpenEdge error codes and what they mean in this DB.

## Field/Relationship Notes

1. List important join keys and naming quirks.
2. Include required field qualification patterns if any differ from baseline.

## Query Caveats

1. Document known syntax limitations observed in this DB.
2. Add tested alternatives when a query form fails.

## High-Risk Operations

1. Record operations that can cause side effects (trigger-heavy tables, sensitive entities).
2. Note safer alternatives.

## Verified Examples

1. Add one successful query example.
2. Add one successful mutate example.
