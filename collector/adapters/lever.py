"""Lever job boards: GET https://api.lever.co/v0/postings/{site}?mode=json (public postings API)."""
from datetime import datetime, timezone

from .common import html_to_text, raw_posting


def collect(company, params, http, max_jobs, stats):
    site = params["site"]
    skip, posts, seen_ids = 0, [], set()
    while True:  # the API pages with skip/limit; read the whole list, then take the newest
        page = http.get(f"https://api.lever.co/v0/postings/{site}", params={"mode": "json", "skip": skip, "limit": 100}).json()
        page_ids = [posting.get("id") for posting in page]
        if any(not identity for identity in page_ids):
            stats["invalid_records"] = stats.get("invalid_records", 0) + 1
            raise ValueError("Lever page contains a posting without a stable ID")
        if len(set(page_ids)) != len(page_ids) or seen_ids.intersection(page_ids):
            stats["duplicates"] = stats.get("duplicates", 0) + 1
            raise ValueError("Repeated Lever posting ID; pagination needs review")
        seen_ids.update(page_ids)
        posts += page
        if len(page) < 100:
            break
        skip += len(page)
    stats["site_total"] = len(posts)
    posts.sort(key=lambda p: p.get("createdAt") or 0, reverse=True)
    for p in posts[:max_jobs]:
        cat = p.get("categories") or {}
        lists = "\n".join(f"<h3>{l.get('text', '')}</h3><ul>{l.get('content', '')}</ul>" for l in p.get("lists") or [])
        created = p.get("createdAt")
        pay = p.get("salaryRange") or {}
        yield raw_posting(
            company, p["id"], p.get("hostedUrl"), p.get("text"),
            description=html_to_text("\n".join(filter(None, [p.get("description"), lists, p.get("additional")]))),
            locations=cat.get("allLocations") or ([cat["location"]] if cat.get("location") else []),
            posted_date=datetime.fromtimestamp(created / 1000, tz=timezone.utc).date().isoformat() if created else None,
            employment_type=cat.get("commitment"),
            remote_hint=p.get("workplaceType"),
            pay_text=(f"{pay.get('min')} - {pay.get('max')} {pay.get('currency', '')} {pay.get('interval', '')}".strip()
                      if pay.get("min") or pay.get("max") else None),
            category=cat.get("team") or cat.get("department"),
        )
