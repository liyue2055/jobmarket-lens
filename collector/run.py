"""Collect postings from each company's official career site.

    python -m collector.run                     # all companies
    python -m collector.run --only NVDA,AMZN    # a subset
    python -m collector.run --max 200           # cap per company
    python -m collector.run --workers 24        # companies in parallel (default 24)
    python -m collector.run --full              # refresh known postings' detail content

Writes data/raw/<run_date>/<TICKER>.jsonl and data/raw/<run_date>/run_log.json, then
updates data/lens.db so every posting carries first_seen / last_seen across runs.
"""
import argparse
import json
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

from collector.adapters import ADAPTERS
from collector.http import BlockedError, Http
from collector import store
from collector.quality import collection_completeness

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated tickers")
    ap.add_argument("--max", type=int, help="max postings per company; 0 means uncapped (overrides config)")
    ap.add_argument("--date", default=date.today().isoformat(), help="run date label")
    ap.add_argument("--workers", type=int, default=24, help="companies collected in parallel")
    ap.add_argument("--full", action="store_true", help="re-read detail pages for known postings")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config/companies.json").read_text())
    col = cfg["collection"]
    limit = args.max if args.max is not None else col["max_postings_per_company"]
    if limit < 0:
        ap.error("--max must be nonnegative (0 means no cap)")
    max_jobs = limit or sys.maxsize
    try:
        date.fromisoformat(args.date)
    except ValueError:
        ap.error("--date must be an ISO date (YYYY-MM-DD)")
    if args.workers < 1:
        ap.error("--workers must be positive")
    only = {t.strip().upper() for t in args.only.split(",")} if args.only else None
    if only:
        unknown = only - {c["ticker"] for c in cfg["companies"]}
        if unknown:
            ap.error("unknown tickers: " + ", ".join(sorted(unknown)))
    out = ROOT / "data/raw" / args.date
    out.mkdir(parents=True, exist_ok=True)
    log_path = out / "run_log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {}

    lock = threading.Lock()
    known, last_collected = store.known_postings(ROOT)
    if args.full:
        known = {}

    def one(c):
        # One Http client (own delay and robots cache) per company, so per-site politeness is unchanged
        # when companies run in parallel.
        t = c["ticker"]
        entry = {"ticker": t, "name": c["name"], "adapter": c["adapter"], "career_site": c["career_site"],
                 "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        fn = ADAPTERS.get(c["adapter"])
        if fn is None:
            entry.update(status="not_applicable", detail=c.get("known_issue"), collected=0)
            with lock:
                log[t] = entry
            return
        delay = col.get("request_delay_by_adapter", {}).get(c["adapter"], col["request_delay_seconds"])
        http = Http(col["user_agent"], delay, col["respect_robots_txt"])
        http.known = dict(known.get(t, {}))
        http.known_urls = {}
        for sid, url in http.known.items():
            if url:
                # An ambiguous URL cannot establish a cached posting's identity.
                http.known_urls[url] = sid if url not in http.known_urls else None
        stats, n, fetched, t0 = {}, 0, 0, time.time()
        seen_ids = set()
        try:
            with open(out / f"{t}.jsonl", "w") as f:
                for rec in fn(t, c["params"], http, max_jobs, stats):
                    sid = rec.get("source_id")
                    cached = rec.get("seen_only") is True
                    if not sid or sid == "None" or (not cached and not rec.get("title")):
                        stats["invalid_records"] = stats.get("invalid_records", 0) + 1
                        raise ValueError("Posting missing a stable ID or title; source needs review")
                    if cached and sid not in http.known:
                        stats["invalid_records"] = stats.get("invalid_records", 0) + 1
                        raise ValueError("Cached sighting is not backed by known history")
                    if sid in seen_ids:
                        stats["duplicates"] = stats.get("duplicates", 0) + 1
                        raise ValueError("Repeated posting ID; pagination or source identity needs review")
                    seen_ids.add(sid)
                    rec["collected_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    n += 1
                    if not cached:
                        fetched += 1
                        http.known.setdefault(sid, rec.get("url"))
                        url = rec.get("url")
                        if url:
                            previous = http.known_urls.get(url, sid)
                            http.known_urls[url] = sid if previous == sid else None
            entry["status"] = "ok" if n else "empty"
            entry["completeness"] = collection_completeness(n, max_jobs, stats)
        except BlockedError as e:
            entry.update(status="blocked", detail=str(e))
        except Exception as e:
            entry.update(status="error", detail=f"{type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
        entry.setdefault("completeness", "partial" if n else "unknown")
        entry.update(collected=n, fetched=fetched, limit=limit, seconds=round(time.time() - t0), **stats)
        with lock:
            log[t] = entry
            log_path.write_text(json.dumps(log, indent=2))
        print(f"[{t}] {entry['status']}: {n} postings {entry.get('detail', '')}", flush=True)

    def last_cost(company):
        delay = col.get("request_delay_by_adapter", {}).get(company["adapter"], col["request_delay_seconds"])
        return last_collected.get(company["ticker"], max_jobs) * delay

    todo = sorted((c for c in cfg["companies"] if not only or c["ticker"] in only),
                  key=last_cost, reverse=True)
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(one, todo))

    log_path.write_text(json.dumps(log, indent=2))
    store.ingest_run(ROOT, args.date)
    print("run log:", log_path)


if __name__ == "__main__":
    main()
