# scripts/

One-shot build helpers and patch utilities. The `_` prefix marks them as
internal — they're not meant to be entry points, only orchestrated by
`run_all.py` at the repo root.

| Script | Purpose |
|---|---|
| `_init_db.py` | Create the DuckDB file + run `KNICKGASM_DuckDB_DDL.sql` |
| `_seed_data.py` | Load CSV exports (Matrixify / Shopify Analytics / Klaviyo / WebEngage) into DuckDB |
| `_run_metrics.py` | Run `queries/metrics.sql` and emit JSON for the strategy report |
| `_run_metrics2.py` | Second-pass metrics with cohort retention windows |
| `_verify.py` | Sanity-check counts + null-rate per fact table |
| `_build_strategy_v2.py` | Rebuild `reports/strategy.html` from templates + metric JSON |
| `_restructure.py` | One-shot migration that reshapes a legacy DuckDB schema to the current one |
| `_patch_html.py` | Targeted HTML patches applied across reports (theme tokens, footer) |
| `_add_flowcharts.py` | Inject the tier-protocol SVG flowcharts into the strategy report |
| `_add_metric_registry.py` | Generate the metric-registry navigation block |
| `_add_sidebar.py` | Build the strategy-report sidebar |
| `_sidebar_v4.py` | Current sidebar generator (v2 and v3 retired) |
| `_sidebar_counts.py` | Compute metric counts per tier for sidebar badges |
| `_minimap.py` | Build the right-rail minimap of section anchors |
| `_nav_fix.py` | Repair broken intra-doc anchors after restructuring |
| `_story_visuals.py` | Inline the strategic-narrative SVGs |

## Run order

```bash
python _init_db.py        # once
python _seed_data.py      # whenever CSVs change
python _run_metrics.py    # daily
python _run_metrics2.py   # daily
python _build_strategy_v2.py
python _add_flowcharts.py
python _add_sidebar.py
python _add_metric_registry.py
python _minimap.py
python _verify.py
```

`run_all.py` at the repo root chains the canonical pipeline.

For the realtime dashboard, see `infra/README.md` (Supabase setup +
`ingest/sync_to_supabase.py`).
