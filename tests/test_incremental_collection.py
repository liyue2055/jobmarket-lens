"""Offline incremental-history regressions; every database and run is synthetic."""
import contextlib
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from collector import run, store
from collector.adapters.common import seen_before


class OfflineHttp:
    def __init__(self, *args, **kwargs):
        self.known, self.known_urls = {}, {}

    def get(self, *args, **kwargs):
        raise AssertionError("Synthetic collection must never request HTTP")

    request = get
    post = get


class IncrementalCollectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "config").mkdir()
        (self.root / "config/companies.json").write_text(json.dumps({
            "collection": {"max_postings_per_company": 10,
                           "request_delay_seconds": 0,
                           "user_agent": "offline-synthetic-test",
                           "respect_robots_txt": True},
            "companies": [{"ticker": "TEST", "name": "Synthetic employer",
                           "adapter": "synthetic", "career_site": "https://example.invalid",
                           "params": {}}],
        }))

    def full_record(self, title="Synthetic role"):
        return {"company": "TEST", "source_id": "1", "title": title,
                "url": "https://example.invalid/jobs/1", "description": "Synthetic evidence"}

    def sighting(self, sid="1"):
        return {"company": "TEST", "source_id": sid, "seen_only": True}

    def ingest(self, day, records, completeness="partial"):
        directory = self.root / "data/raw" / day
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "run_log.json").write_text(json.dumps({"TEST": {
            "status": "ok" if records else "empty", "collected": len(records),
            "completeness": completeness}}))
        (directory / "TEST.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records))
        store.ingest_run(self.root, day)

    def rows(self, sql, values=()):
        # This path is exclusively under this test's TemporaryDirectory.
        with sqlite3.connect(self.root / "data/lens.db") as db:
            return db.execute(sql, values).fetchall()

    def invoke(self, adapter, day, *flags):
        with patch.object(run, "ROOT", self.root), \
             patch.object(run, "ADAPTERS", {"synthetic": adapter}), \
             patch.object(run, "Http", OfflineHttp), \
             patch("sys.argv", ["synthetic-collector", "--workers", "1", "--date", day, *flags]), \
             contextlib.redirect_stdout(io.StringIO()), \
             contextlib.redirect_stderr(io.StringIO()):
            run.main()
        return json.loads((self.root / "data/raw" / day / "run_log.json").read_text())["TEST"]

    def test_seen_preserves_full_content_and_versions_but_records_visibility(self):
        self.ingest("2026-10-01", [self.full_record()])
        before = self.rows("SELECT raw,first_seen FROM postings")
        versions = self.rows("SELECT * FROM posting_versions")
        self.ingest("2026-10-02", [self.sighting()])
        self.assertEqual(self.rows("SELECT raw,first_seen FROM postings"), before)
        self.assertEqual(self.rows("SELECT * FROM posting_versions"), versions)
        self.assertEqual(self.rows("SELECT last_seen FROM postings"), [("2026-10-02",)])
        self.assertEqual(self.rows("SELECT run_date FROM observations ORDER BY run_date"),
                         [("2026-10-01",), ("2026-10-02",)])
        self.assertEqual(store.load_postings(self.root)[0][0]["posting_status"], "Open")

    def test_backdated_seen_never_regresses_dates_or_content(self):
        self.ingest("2026-10-03", [self.full_record()])
        before = self.rows("SELECT * FROM postings")
        versions = self.rows("SELECT * FROM posting_versions")
        self.ingest("2026-10-02", [self.sighting()])
        self.assertEqual(self.rows("SELECT * FROM postings"), before)
        self.assertEqual(self.rows("SELECT * FROM posting_versions"), versions)
        self.assertEqual(self.rows("SELECT run_date FROM observations ORDER BY run_date"),
                         [("2026-10-02",), ("2026-10-03",)])

    def test_dangling_seen_rolls_back_snapshot_and_earlier_updates(self):
        self.ingest("2026-10-01", [self.full_record()])
        before = self.rows("SELECT * FROM postings")
        with self.assertRaisesRegex(ValueError, "no stored full record"):
            self.ingest("2026-10-02", [self.sighting(), self.sighting("missing")], "complete")
        self.assertEqual(self.rows("SELECT * FROM postings"), before)
        self.assertEqual(self.rows("SELECT * FROM snapshots WHERE run_date='2026-10-02'"), [])
        self.assertEqual(self.rows("SELECT * FROM observations WHERE run_date='2026-10-02'"), [])

    def test_same_day_rerun_replaces_seen_observation(self):
        self.ingest("2026-10-01", [self.full_record()])
        self.ingest("2026-10-02", [self.sighting()])
        self.assertEqual(store.load_postings(self.root)[0][0]["posting_status"], "Open")
        self.ingest("2026-10-02", [])
        self.assertEqual(self.rows("SELECT * FROM observations WHERE run_date='2026-10-02'"), [])
        self.assertEqual(store.load_postings(self.root)[0][0]["posting_status"], "Unverified")

    def test_full_runner_discovers_changed_content_after_cached_run(self):
        self.ingest("2026-10-01", [self.full_record()])

        def adapter(company, params, http, limit, stats):
            cached = seen_before(company, http, source_id="1")
            yield cached if cached else self.full_record("Changed synthetic role")

        incremental = self.invoke(adapter, "2026-10-02")
        self.assertEqual((incremental["collected"], incremental["fetched"]), (1, 0))
        refreshed = self.invoke(adapter, "2026-10-03", "--full")
        self.assertEqual((refreshed["collected"], refreshed["fetched"]), (1, 1))
        self.assertEqual(len(self.rows("SELECT * FROM posting_versions")), 2)
        record = json.loads(self.rows("SELECT raw FROM postings")[0][0])
        self.assertEqual(record["title"], "Changed synthetic role")
        self.assertEqual(self.rows("SELECT first_seen,last_seen FROM postings"),
                         [("2026-10-01", "2026-10-03")])

    def test_runner_accepts_minimal_seen_and_keeps_duplicate_guard(self):
        self.ingest("2026-10-01", [self.full_record()])

        def adapter(company, params, http, limit, stats):
            self.assertIn("1", http.known)
            yield self.sighting()
            yield self.full_record("Synthetic new role") | {"source_id": "2"}

        entry = self.invoke(adapter, "2026-10-02")
        self.assertEqual(entry["status"], "ok")
        self.assertEqual((entry["collected"], entry["fetched"]), (2, 1))

        def duplicate(company, params, http, limit, stats):
            yield self.sighting()
            yield self.sighting()

        entry = self.invoke(duplicate, "2026-10-03")
        self.assertEqual(entry["status"], "error")
        self.assertEqual(entry["completeness"], "partial")
        self.assertEqual(entry["duplicates"], 1)
        self.assertEqual((entry["collected"], entry["fetched"]), (1, 0))

    def test_runner_rejects_unbacked_cached_identity(self):
        self.ingest("2026-10-01", [self.full_record()])

        def adapter(company, params, http, limit, stats):
            yield self.sighting("missing")

        entry = self.invoke(adapter, "2026-10-02")
        self.assertEqual(entry["status"], "error")
        self.assertEqual(entry["completeness"], "unknown")
        self.assertEqual(entry["invalid_records"], 1)
        self.assertEqual((entry["collected"], entry["fetched"]), (0, 0))
        self.assertEqual(self.rows("SELECT * FROM observations WHERE run_date='2026-10-02'"), [])
        self.assertEqual(self.rows("SELECT last_seen FROM postings"), [("2026-10-01",)])

    def test_known_missing_database_does_not_create_it(self):
        self.assertEqual(store.known_postings(self.root), ({}, {}))
        self.assertFalse((self.root / "data").exists())

    def test_known_legacy_database_is_read_only_without_schema_migration(self):
        path = self.root / "data/lens.db"
        path.parent.mkdir()
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE postings (company,source_id,first_seen,last_seen,raw)")
            db.execute("CREATE TABLE snapshots (run_date,company,status,collected,site_total,detail)")
            db.execute("INSERT INTO postings VALUES (?,?,?,?,?)", (
                "TEST", "1", "2026-10-01", "2026-10-01", json.dumps(self.full_record())))
            db.execute("INSERT INTO snapshots VALUES ('2026-10-01','TEST','ok',1,1,NULL)")
        before = path.read_bytes()
        self.assertEqual(store.known_postings(self.root),
                         ({"TEST": {"1": "https://example.invalid/jobs/1"}}, {"TEST": 1}))
        self.assertEqual(path.read_bytes(), before)
        self.assertNotIn("metadata", [r[1] for r in self.rows("PRAGMA table_info(snapshots)")])
        self.assertEqual(self.rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
                         [("postings",), ("snapshots",)])


if __name__ == "__main__":
    unittest.main()
