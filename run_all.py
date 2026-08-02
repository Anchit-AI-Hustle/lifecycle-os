"""Master ingestion script — runs all 4 ingest scripts in sequence."""

import sys
import os
import time
import logging
import argparse
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGS_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

LOG_FILE = os.path.join(LOGS_DIR, f"ingest_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

# Configure root logger: file + stdout
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(open(sys.stdout.fileno(), mode="w", encoding="utf-8", closefd=False)),
    ],
)
logger = logging.getLogger(__name__)

# Add ingest/ to path
sys.path.insert(0, os.path.join(BASE_DIR, "ingest"))


SOURCES = {
    "matrixify":         ("ingest_matrixify",       "Loading Matrixify (Shopify raw) data..."),
    "shopify_analytics": ("ingest_shopify_analytics","Loading Shopify Analytics data..."),
    "klaviyo":           ("ingest_klaviyo",          "Loading Klaviyo email/SMS data..."),
    "webengage":         ("ingest_webengage",        "Loading WebEngage CDP data..."),
}


def run_source(name: str) -> dict:
    module_name, label = SOURCES[name]
    logger.info("─" * 60)
    logger.info(label)
    t0 = time.time()
    try:
        mod = __import__(module_name)
        result = mod.ingest()
        elapsed = round(time.time() - t0, 2)
        total_rows = sum(result.values())
        logger.info("✓ %s — %d rows in %.2fs", name, total_rows, elapsed)
        return {"schema": name, "rows": total_rows, "elapsed": elapsed, "status": "ok", "detail": result}
    except Exception as exc:
        elapsed = round(time.time() - t0, 2)
        logger.error("✗ %s failed after %.2fs: %s", name, elapsed, exc)
        return {"schema": name, "rows": 0, "elapsed": elapsed, "status": "error", "error": str(exc)}


def main() -> None:
    parser = argparse.ArgumentParser(description="KNICKGASM DTC ingestion runner")
    parser.add_argument(
        "--source",
        choices=list(SOURCES.keys()),
        help="Run just one source (default: all)",
    )
    args = parser.parse_args()

    sources_to_run = [args.source] if args.source else list(SOURCES.keys())

    logger.info("=" * 60)
    logger.info("KNICKGASM DTC Ingestion — %s", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    logger.info("Sources: %s", ", ".join(sources_to_run))
    logger.info("Log file: %s", LOG_FILE)
    logger.info("=" * 60)

    wall_start = time.time()
    results = []
    for source in sources_to_run:
        results.append(run_source(source))

    wall_elapsed = round(time.time() - wall_start, 2)

    logger.info("=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    total_rows = 0
    for r in results:
        status_icon = "✓" if r["status"] == "ok" else "✗"
        logger.info("%s  %-25s  %6d rows  %.2fs", status_icon, r["schema"], r["rows"], r["elapsed"])
        total_rows += r["rows"]
    logger.info("─" * 60)
    logger.info("Total: %d rows in %.2fs", total_rows, wall_elapsed)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
