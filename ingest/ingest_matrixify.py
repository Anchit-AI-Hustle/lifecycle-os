"""Load Matrixify (Shopify raw) CSV exports into matrixify schema."""

import os
import re
import time
import logging
from datetime import datetime

import duckdb
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "matrixify")
DB_PATH  = os.path.join(BASE_DIR, "knickgasm_dtc.duckdb")

KNOWN_TABLES = {
    "smart_collections", "custom_collections", "customers", "companies",
    "discounts", "draft_orders", "orders", "order_line_items", "payouts",
    "payout_transactions", "pages", "blog_posts", "products",
    "product_variants", "redirects", "activity", "files", "metaobjects",
    "menus", "shop",
}

JSON_COLUMNS = {
    "line_items", "metafields", "addresses", "transactions", "fulfillments",
    "refunds", "variants", "images", "rules", "image", "items", "fields",
    "options", "locations", "contacts", "billing_address", "shipping_address",
    "default_address", "applied_discount", "discount_codes", "tax_lines",
    "properties",
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
        if (col.endswith("_at") or col.endswith("_date") or col == "date") and col not in JSON_COLUMNS:
            try:
                df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
                df[col] = df[col].dt.tz_localize(None)
            except Exception:
                pass
    return df


def _read_csv(path: str) -> pd.DataFrame:
    for enc in ("utf-8", "latin-1"):
        try:
            return pd.read_csv(path, low_memory=False, encoding=enc)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Cannot decode {path}")


def _upsert(con: duckdb.DuckDBPyConnection, table: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0

    full_table = f"matrixify.{table}"
    existing_cols = {
        row[0]
        for row in con.execute(
            f"SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema='matrixify' AND table_name='{table}'"
        ).fetchall()
    }

    df["_loaded_at"] = datetime.utcnow()

    # Keep only columns that exist in the target table
    df = df[[c for c in df.columns if c in existing_cols]]

    if df.empty:
        return 0

    has_id = "id" in df.columns

    if has_id:
        # DELETE + INSERT for upsert
        ids = df["id"].dropna().tolist()
        if ids:
            placeholders = ",".join(["?"] * len(ids))
            con.execute(f"DELETE FROM {full_table} WHERE id IN ({placeholders})", ids)

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
            df = _read_csv(path)
            df = _clean_column_names(df)
            df = _parse_dates(df)

            # Coerce JSON columns to string
            for col in df.columns:
                if col in JSON_COLUMNS:
                    df[col] = df[col].astype(str)

            rows = _upsert(con, table_name, df)
            elapsed = round(time.time() - t0, 2)
            logger.info("matrixify.%s — %d rows in %.2fs", table_name, rows, elapsed)
            summary[table_name] = rows
        except Exception as exc:
            logger.error("Error loading %s: %s", fname, exc)
            summary[table_name] = 0

    con.close()
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = ingest()
    print("Matrixify ingest complete:", result)
