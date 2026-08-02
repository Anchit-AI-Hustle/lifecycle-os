"""Load WebEngage CSV exports into webengage schema; auto-rebuild event_summary."""

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
DATA_DIR = os.path.join(BASE_DIR, "data", "webengage")
DB_PATH  = os.path.join(BASE_DIR, "knickgasm_dtc.duckdb")

TABLE_CONFIG = {
    "user_profiles":  ("user_id", "upsert"),
    "events":         ("id",      "append"),
    "revenue_mapping": ("id",     "upsert"),
}

JSON_COLUMNS = {"event_properties", "line_items", "custom_attributes"}

logger = logging.getLogger(__name__)


def _clean_column_names(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [
        re.sub(r"[^a-z0-9_]", "", col.strip().lower().replace(" ", "_"))
        for col in df.columns
    ]
    return df


def _parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    date_cols = {"event_time", "created_at", "updated_at", "first_seen",
                 "last_seen", "last_order_date", "birth_date", "matched_at", "event_time"}
    for col in df.columns:
        if col in date_cols or "_at" in col or "_date" in col:
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


def _load_table(con: duckdb.DuckDBPyConnection, table: str, df: pd.DataFrame,
                key_col: str, strategy: str) -> int:
    if df.empty:
        return 0

    full_table = f"webengage.{table}"
    existing_cols = {
        row[0]
        for row in con.execute(
            f"SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema='webengage' AND table_name='{table}'"
        ).fetchall()
    }

    df["_loaded_at"] = datetime.utcnow()

    if key_col not in df.columns:
        df[key_col] = [
            hashlib.md5(f"{table}|{i}|{datetime.utcnow().isoformat()}".encode()).hexdigest()
            for i in range(len(df))
        ]

    df = df[[c for c in df.columns if c in existing_cols]]
    if df.empty:
        return 0

    if strategy == "upsert":
        ids = df[key_col].dropna().tolist()
        if ids:
            placeholders = ",".join(["?"] * len(ids))
            con.execute(f"DELETE FROM {full_table} WHERE {key_col} IN ({placeholders})", ids)
        con.execute(f"INSERT INTO {full_table} SELECT * FROM df")
    else:
        # append-only: skip rows whose primary key already exists
        con.execute(f"INSERT OR IGNORE INTO {full_table} SELECT * FROM df")
    return len(df)


def _rebuild_event_summary(con: duckdb.DuckDBPyConnection) -> None:
    """Rebuild webengage.event_summary from webengage.events."""
    try:
        con.execute("DELETE FROM webengage.event_summary")
        con.execute("""
            INSERT INTO webengage.event_summary (id, summary_date, event_name, channel,
                                                  event_count, unique_users, total_revenue, _loaded_at)
            SELECT
                md5(CAST(summary_date AS VARCHAR) || '|' || event_name || '|' || COALESCE(channel,'')) AS id,
                summary_date,
                event_name,
                channel,
                COUNT(*)                                              AS event_count,
                COUNT(DISTINCT user_id)                               AS unique_users,
                COALESCE(SUM(revenue), 0)                             AS total_revenue,
                current_timestamp                                     AS _loaded_at
            FROM (
                SELECT
                    CAST(event_time AS DATE)                          AS summary_date,
                    event_name,
                    channel,
                    user_id,
                    revenue
                FROM webengage.events
                WHERE event_time IS NOT NULL
            ) t
            GROUP BY summary_date, event_name, channel
        """)
        rows = con.execute("SELECT COUNT(*) FROM webengage.event_summary").fetchone()[0]
        logger.info("Rebuilt webengage.event_summary — %d rows", rows)
    except Exception as exc:
        logger.error("Failed to rebuild event_summary: %s", exc)


def ingest() -> dict:
    summary = {}
    if not os.path.isdir(DATA_DIR):
        logger.warning("Data dir not found: %s", DATA_DIR)
        return summary

    con = duckdb.connect(DB_PATH)
    events_loaded = False

    for fname in sorted(os.listdir(DATA_DIR)):
        if not fname.endswith(".csv"):
            continue
        table_name = os.path.splitext(fname)[0].lower()
        if table_name not in TABLE_CONFIG:
            logger.warning("Skipping unknown table file: %s", fname)
            continue

        key_col, strategy = TABLE_CONFIG[table_name]
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
            df = _coerce_json(df)

            rows = _load_table(con, table_name, df, key_col, strategy)
            elapsed = round(time.time() - t0, 2)
            logger.info("webengage.%s — %d rows in %.2fs", table_name, rows, elapsed)
            summary[table_name] = rows

            if table_name == "events":
                events_loaded = True
        except Exception as exc:
            logger.error("Error loading %s: %s", fname, exc)
            summary[table_name] = 0

    if events_loaded:
        _rebuild_event_summary(con)

    con.close()
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = ingest()
    print("WebEngage ingest complete:", result)
