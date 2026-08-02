"""Run all 15 metrics queries and print results."""
import duckdb, re, textwrap

con = duckdb.connect(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\knickgasm_dtc.duckdb")

sql = open(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\queries\metrics.sql").read()

# Split into named blocks by the METRIC N: / BONUS header comments
blocks = re.split(r"--\s*-{5,}\s*\n--\s*(METRIC \d+|BONUS)[^\n]*\n--\s*-{5,}", sql)
headers = re.findall(r"--\s*-{5,}\s*\n--\s*(METRIC \d+[^\n]*|BONUS[^\n]*)\n--\s*-{5,}", sql)

# Pair headers with their SQL blocks (blocks[0] is the file header, skip it)
pairs = list(zip(headers, blocks[1:]))

for title, block in pairs:
    # Split block into individual statements
    stmts = [s.strip() for s in block.split(";") if s.strip() and not s.strip().startswith("--")]
    print(f"\n{'='*70}")
    print(f"  {title.strip()}")
    print(f"{'='*70}")
    for stmt in stmts:
        try:
            df = con.execute(stmt).df()
            if df.empty:
                print("  (no data)")
            else:
                # Print up to 8 rows, truncate wide columns
                preview = df.head(8).to_string(index=False, max_colwidth=22)
                for line in preview.split("\n"):
                    print("  " + line)
                if len(df) > 8:
                    print(f"  ... ({len(df)} rows total)")
        except Exception as e:
            print(f"  ERROR: {e}")

con.close()
