import duckdb, os

db = duckdb.connect(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\knickgasm_dtc.duckdb")
schemas = db.execute(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','pg_catalog') ORDER BY schema_name"
).fetchall()
tables = db.execute(
    "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','pg_catalog') ORDER BY table_schema, table_name"
).fetchall()

print("Schemas:", [s[0] for s in schemas])

from collections import defaultdict
by_schema = defaultdict(list)
for s, t in tables:
    by_schema[s].append(t)

for schema, tbls in sorted(by_schema.items()):
    print(f"  {schema} ({len(tbls)} tables): {', '.join(tbls)}")

print(f"\nTotal tables: {len(tables)}")
db.close()
