"""Load Shopify Analytics CSV exports into shopify_analytics schema (append + dedup)."""

import os
import re
import time
import logging
import hashlib
from datetime import datetime

import duckdb
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "shopify_analytics")
DB_PATH  = os.path.join(BASE_DIR, "knickgasm_dtc.duckdb")

KNOWN_TABLES = {
    "revenue_metrics", "orders_by_status", "traffic_metrics",
    "conversion_funnel", "acquisition_metrics", "device_metrics",
    "geography_metrics", "customer_metrics", "customer_cohorts",
    "product_performance", "collection_performance",
    "marketing_attribution", "discount_usage",
}

logger = logging.getLogger(__name__)


def _clean_column_names(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [
        re.sub(r"[^a-z0-9_]", "", col.strip().lower().replace(" ", "_"))
        for col in df.columns
    ]
    return df


def _parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.columns:
        if col.endswith("_date") or col == "date" or col.endswith("_at"):
            try:
                df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
                df[col] = df[col].dt.tz_localize(None)
            except Exception:
                pass
    return df


def _make_id(row: pd.Series) -> str:
    key = f"{row.get('report_date','')}|{row.get('report_period','')}"
    return hashlib.md5(key.encode()).hexdigest()


def _append_dedup(con: duckdb.DuckDBPyConnection, table: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0

    full_table = f"shopify_analytics.{table}"
    existing_cols = {
        row[0]
        for row in con.execute(
            f"SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema='shopify_analytics' AND table_name='{table}'"
        ).fetchall()
    }

    df["_loaded_at"] = datetime.utcnow()

    # Generate synthetic ID if not present
    if "id" not in df.columns:
        df["id"] = [
            hashlib.md5(f"{table}|{i}|{datetime.utcnow().isoformat()}".encode()).hexdigest()
            for i in range(len(df))
        ]

    # Deduplicate on (report_date, report_period) if both exist
    dedup_cols = [c for c in ("report_date", "report_period") if c in df.columns]
    if dedup_cols:
        df = df.drop_duplicates(subset=dedup_cols, keep="last")

        # Remove existing rows with same dedup keys to avoid duplicates
        if "report_date" in df.columns and "report_period" in df.columns:
            pairs = list(df[["report_date", "report_period"]].drop_duplicates().itertuples(index=False))
            for rd, rp in pairs:
                con.execute(
                    f"DELETE FROM {full_table} WHERE report_date=? AND report_period=?",
                    [str(rd), str(rp)],
                )
        elif "report_date" in df.columns:
            dates = df["report_date"].dropna().unique().tolist()
            if dates:
                placeholders = ",".join(["?"] * len(dates))
                con.execute(f"DELETE FROM {full_table} WHERE report_date IN ({placeholders})", [str(d) for d in dates])

    df = df[[c for c in df.columns if c in existing_cols]]
    if df.empty:
        return 0

    con.execute(f"INSERT INTO {full_table} SELECT * FROM df")
    return len(df)


def ingest() -> dict:
    summary = {}
    if not os.path.isdir(DATA_DIR):
        logger.warning("Data dir not found: %s", DATA_DIR)
        return summary

    con = duckdb.connect(DB_PATH)

    for fname in sorted(os.listdir(DATA_DIR)):
        if not fname.endswith(".csv"):
            continue
        table_name = os.path.splitext(fname)[0].lower()
        if table_name not in KNOWN_TABLES:
            logger.warning("Skipping unknown table file: %s", fname)
            continue

        path = os.path.join(DATA_DIR, fname)
        t0 = time.time()
        try:
            for enc in ("utf-8", "latin-1"):
                try:
                    df = pd.read_csv(path, low_memory=False, encoding=enc)
                    break
                except UnicodeDecodeError:
                    continue
            df = _clean_column_names(df)
            df = _parse_dates(df)

            rows = _append_dedup(con, table_name, df)
            elapsed = round(time.time() - t0, 2)
            logger.info("shopify_analytics.%s — %d rows in %.2fs", table_name, rows, elapsed)
            summary[table_name] = rows
        except Exception as exc:
            logger.error("Error loading %s: %s", fname, exc)
            summary[table_name] = 0

    con.close()
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = ingest()
    print("Shopify Analytics ingest complete:", result)
