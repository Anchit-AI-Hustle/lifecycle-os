import duckdb, os, re

base = r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine"
db = duckdb.connect(os.path.join(base, "knickgasm_dtc.duckdb"))

with open(os.path.join(base, "KNICKGASM_DuckDB_DDL.sql")) as f:
    sql = f.read()

# Remove comment lines, then split on semicolons
lines = [l for l in sql.split("\n") if not l.strip().startswith("--")]
clean_sql = "\n".join(lines)
statements = [s.strip() for s in clean_sql.split(";") if s.strip()]

# Create schemas first
for stmt in statements:
    if re.match(r"CREATE\s+SCHEMA", stmt, re.I):
        db.execute(stmt)

# Then create tables
for stmt in statements:
    if not re.match(r"CREATE\s+SCHEMA", stmt, re.I):
        db.execute(stmt)

schemas = db.execute(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','pg_catalog')"
).fetchall()
print("Schemas:", schemas)

tables = db.execute(
    "SELECT table_schema, COUNT(*) as cnt FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','pg_catalog') GROUP BY table_schema ORDER BY table_schema"
).fetchall()
print("Tables per schema:", tables)
db.close()
print("Done.")
