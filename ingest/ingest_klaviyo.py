"""Load Klaviyo CSV/JSON exports into klaviyo schema."""

import os
import re
import json
import time
import logging
import hashlib
from datetime import datetime

import duckdb
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "klaviyo")
DB_PATH  = os.path.join(BASE_DIR, "knickgasm_dtc.duckdb")

# table_name -> (upsert_key, strategy)
TABLE_CONFIG = {
    "profiles":        ("profile_id",  "upsert"),
    "profile_growth":  ("id",          "upsert"),
    "campaigns":       ("campaign_id", "upsert"),
    "flows":           ("flow_id",     "upsert"),
    "sms_metrics":     ("id",          "upsert"),
    "lists":           ("list_id",     "upsert"),
    "segments":        ("segment_id",  "upsert"),
    "events":          ("event_id",    "append"),
    "deliverability":  ("id",          "upsert"),
}

JSON_COLUMNS = {"custom_properties", "event_properties", "subscriptions", "definition"}

logger = logging.getLogger(__name__)


def _clean_column_names(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [
        re.sub(r"[^a-z0-9_]", "", col.strip().lower().replace(" ", "_"))
        for col in df.columns
    ]
    return df


def _parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.columns:
        if col.endswith("_at") or col in ("timestamp", "created", "updated", "sent_at", "date", "birth_date"):
            if col in JSON_COLUMNS:
                continue
            try:
                df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
                df[col] = df[col].dt.tz_localize(None)
            except Exception:
                pass
    return df


def _coerce_json(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.columns:
        if col in JSON_COLUMNS:
            df[col] = df[col].apply(
                lambda v: json.dumps(v) if isinstance(v, (dict, list)) else str(v) if pd.notna(v) else None
            )
    return df


def _read_file(path: str) -> pd.DataFrame:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".json":
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return pd.DataFrame(data)
        if isinstance(data, dict) and "data" in data:
            return pd.DataFrame(data["data"])
        return pd.DataFrame([data])
    for enc in ("utf-8", "latin-1"):
        try:
            return pd.read_csv(path, low_memory=False, encoding=enc)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Cannot read {path}")


def _upsert(con: duckdb.DuckDBPyConnection, table: str, df: pd.DataFrame,
            key_col: str, strategy: str) -> int:
    if df.empty:
        return 0

    full_table = f"klaviyo.{table}"
    existing_cols = {
        row[0]
        for row in con.execute(
            f"SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema='klaviyo' AND table_name='{table}'"
        ).fetchall()
    }

    df["_loaded_at"] = datetime.utcnow()

    # Ensure key column exists
    if key_col not in df.columns:
        df[key_col] = [
            hashlib.md5(f"{table}|{i}".encode()).hexdigest() for i in range(len(df))
        ]

    df = df[[c for c in df.columns if c in existing_cols]]
    if df.empty:
        return 0

    if strategy == "upsert" and key_col in df.columns:
        ids = df[key_col].dropna().tolist()
        if ids:
            placeholders = ",".join(["?"] * len(ids))
            con.execute(f"DELETE FROM {full_table} WHERE {key_col} IN ({placeholders})", ids)
        con.execute(f"INSERT INTO {full_table} SELECT * FROM df")
    else:
        # append-only: skip rows whose primary key already exists
        con.execute(f"INSERT OR IGNORE INTO {full_table} SELECT * FROM df")
    return len(df)


def ingest() -> dict:
    summary = {}
    if not os.path.isdir(DATA_DIR):
        logger.warning("Data dir not found: %s", DATA_DIR)
        return summary

    con = duckdb.connect(DB_PATH)

    for fname in sorted(os.listdir(DATA_DIR)):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in (".csv", ".json"):
            continue
        table_name = os.path.splitext(fname)[0].lower()
        if table_name not in TABLE_CONFIG:
            logger.warning("Skipping unknown table file: %s", fname)
            continue

        key_col, strategy = TABLE_CONFIG[table_name]
        path = os.path.join(DATA_DIR, fname)
        t0 = time.time()
        try:
            df = _read_file(path)
            df = _clean_column_names(df)
            df = _parse_dates(df)
            df = _coerce_json(df)

            rows = _upsert(con, table_name, df, key_col, strategy)
            elapsed = round(time.time() - t0, 2)
            logger.info("klaviyo.%s — %d rows in %.2fs", table_name, rows, elapsed)
            summary[table_name] = rows
        except Exception as exc:
            logger.error("Error loading %s: %s", fname, exc)
            summary[table_name] = 0

    con.close()
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = ingest()
    print("Klaviyo ingest complete:", result)
