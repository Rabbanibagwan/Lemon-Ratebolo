"""Admin panel unit tests: dates, dashboard metrics parity, auth dual-mode."""
from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from admin_panel.dates import ist_day_utc_window, ist_today_str, resolve_date_range
from admin_panel.queries import build_dashboard, sum_patti_bags_and_count, sum_purchased_bags, count_vendor_bills
from admin_panel.auth import make_admin_token, pwd, ROLE_PLATFORM_ADMIN, uid, utc_now
from admin_panel import register_platform_admin


# ---------- Fake Mongo ----------
class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = rows

    def sort(self, *a, **k):
        return self

    def skip(self, n: int):
        self._rows = self._rows[n:]
        return self

    def limit(self, n: int):
        self._rows = self._rows[:n]
        return self

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._i >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._i]
        self._i += 1
        return row


class _AggCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, n: int):
        return self._rows[:n]


class _Coll:
    def __init__(self, store: Dict[str, List[dict]], name: str):
        self._store = store
        self._name = name
        self._store.setdefault(name, [])

    def _match(self, d: dict, query: dict) -> bool:
        for k, v in query.items():
            if k == "$or":
                if not any(self._match(d, clause) for clause in v):
                    return False
                continue
            if isinstance(v, dict):
                actual = d.get(k)
                if "$ne" in v and actual == v["$ne"]:
                    return False
                if "$gte" in v or "$lte" in v or "$lt" in v:
                    if actual is None:
                        return False
                    if "$gte" in v and actual < v["$gte"]:
                        return False
                    if "$lte" in v and actual > v["$lte"]:
                        return False
                    if "$lt" in v and not (actual < v["$lt"]):
                        return False
                if "$in" in v and actual not in v["$in"]:
                    return False
                if "$regex" in v:
                    import re
                    if not re.search(v["$regex"], str(actual or ""), re.I if v.get("$options") == "i" else 0):
                        return False
            else:
                if d.get(k) != v:
                    return False
        return True

    async def find_one(self, query: dict, projection: Optional[dict] = None):
        for d in self._store[self._name]:
            if self._match(d, query):
                out = copy.deepcopy(d)
                if projection:
                    if projection.get("_id") == 0:
                        out.pop("_id", None)
                    if projection.get("password_hash") == 0:
                        out.pop("password_hash", None)
                return out
        return None

    def find(self, query: dict, projection: Optional[dict] = None):
        rows = []
        for d in self._store[self._name]:
            if self._match(d, query):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                if projection and projection.get("password_hash") == 0:
                    out.pop("password_hash", None)
                rows.append(out)
        return _Cursor(rows)

    async def count_documents(self, query: dict):
        return sum(1 for d in self._store[self._name] if self._match(d, query))

    async def distinct(self, field: str, query: dict):
        vals = set()
        for d in self._store[self._name]:
            if self._match(d, query) and field in d:
                vals.add(d[field])
        return list(vals)

    async def insert_one(self, doc: dict):
        self._store[self._name].append(copy.deepcopy(doc))

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        for i, d in enumerate(self._store[self._name]):
            if self._match(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                return
        if upsert and "$set" in update:
            self._store[self._name].append({**query, **update["$set"]})

    async def create_index(self, *a, **k):
        return "ok"

    def aggregate(self, pipeline: List[dict]):
        rows = [copy.deepcopy(d) for d in self._store[self._name]]
        for stage in pipeline:
            if "$match" in stage:
                rows = [d for d in rows if self._match(d, stage["$match"])]
            elif "$addFields" in stage:
                for d in rows:
                    for k, expr in stage["$addFields"].items():
                        if isinstance(expr, dict) and "$ifNull" in expr:
                            a, b = expr["$ifNull"]
                            # a/b are field refs like "$paid_at"
                            fa = a[1:] if isinstance(a, str) and a.startswith("$") else a
                            fb = b[1:] if isinstance(b, str) and b.startswith("$") else b
                            d[k] = d.get(fa) if d.get(fa) is not None else d.get(fb)
            elif "$group" in stage:
                g = stage["$group"]
                gid = g.get("_id")
                buckets: Dict[Any, dict] = {}
                for d in rows:
                    key = None if gid is None else d.get(gid[1:] if isinstance(gid, str) and gid.startswith("$") else gid)
                    if isinstance(gid, str) and gid.startswith("$"):
                        key = d.get(gid[1:])
                    b = buckets.setdefault(key, {"_id": key})
                    for field, acc in g.items():
                        if field == "_id":
                            continue
                        if "$sum" in acc:
                            val = acc["$sum"]
                            if val == 1:
                                b[field] = b.get(field, 0) + 1
                            elif isinstance(val, dict) and "$ifNull" in val:
                                f = val["$ifNull"][0]
                                fname = f[1:] if isinstance(f, str) and f.startswith("$") else f
                                b[field] = b.get(field, 0) + int(d.get(fname) or 0)
                            elif isinstance(val, str) and val.startswith("$"):
                                b[field] = b.get(field, 0) + int(d.get(val[1:]) or 0)
                        elif "$addToSet" in acc:
                            f = acc["$addToSet"]
                            fname = f[1:] if isinstance(f, str) and f.startswith("$") else f
                            s = b.setdefault(field, [])
                            v = d.get(fname)
                            if v not in s:
                                s.append(v)
                rows = list(buckets.values())
            elif "$sort" in stage:
                pass
            elif "$facet" in stage:
                # minimal: items = rows with skip/limit from facet stages
                facets = {}
                for name, stages in stage["$facet"].items():
                    sub = list(rows)
                    for st in stages:
                        if "$skip" in st:
                            sub = sub[st["$skip"] :]
                        elif "$limit" in st:
                            sub = sub[: st["$limit"]]
                        elif "$count" in st:
                            sub = [{st["$count"]: len(sub)}]
                    facets[name] = sub
                rows = [facets]
            elif "$skip" in stage:
                rows = rows[stage["$skip"] :]
            elif "$limit" in stage:
                rows = rows[: stage["$limit"]]
        return _AggCursor(rows)


class FakeDB:
    def __init__(self):
        self._store: Dict[str, List[dict]] = {}
        self._colls: Dict[str, _Coll] = {}

    def _coll(self, name: str) -> _Coll:
        if name not in self._colls:
            self._colls[name] = _Coll(self._store, name)
        return self._colls[name]

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._coll(name)

    def __getitem__(self, name: str):
        return self._coll(name)


def _run(coro):
    return asyncio.run(coro)


# ---------- Date helpers ----------
class TestAdminDates:
    def test_ist_today_str_format(self):
        s = ist_today_str()
        assert len(s) == 10 and s[4] == "-" and s[7] == "-"

    def test_resolve_single_date(self):
        a, b = resolve_date_range(date="2026-09-18")
        assert a == b == "2026-09-18"

    def test_resolve_range_order(self):
        with pytest.raises(HTTPException):
            resolve_date_range(date_from="2026-09-19", date_to="2026-09-18")

    def test_ist_day_window_boundaries(self):
        """IST midnight 2026-09-18 == 2026-09-17 18:30 UTC."""
        start, end = ist_day_utc_window("2026-09-18")
        assert start == datetime(2026, 9, 17, 18, 30, tzinfo=timezone.utc)
        assert end == datetime(2026, 9, 18, 18, 30, tzinfo=timezone.utc)
        # Just before IST midnight should be previous day window end exclusive
        assert start < datetime(2026, 9, 17, 18, 30, 1, tzinfo=timezone.utc)


# ---------- Metric parity with mobile dashboard logic ----------
class TestDashboardMetricsParity:
    def test_farmer_bags_and_patti_match_mobile_rules(self):
        db = FakeDB()
        sid = "shopA"
        # Active pattis on day
        db._store["pattis"] = [
            {"id": "p1", "shop_id": sid, "date": "2026-09-18", "total_bags": 10, "farmer_id": "f1", "deleted": False},
            {"id": "p2", "shop_id": sid, "date": "2026-09-18", "total_bags": 5, "farmer_id": "f2", "deleted": False},
            # deleted must not count
            {"id": "p3", "shop_id": sid, "date": "2026-09-18", "total_bags": 100, "farmer_id": "f3", "deleted": True},
            # other day
            {"id": "p4", "shop_id": sid, "date": "2026-09-17", "total_bags": 7, "farmer_id": "f1", "deleted": False},
            # other shop
            {"id": "p5", "shop_id": "shopB", "date": "2026-09-18", "total_bags": 3, "farmer_id": "f9", "deleted": False},
        ]
        # Mirror mobile dashboard aggregation for shopA day
        mobile_like = _run(sum_patti_bags_and_count(db, date_from="2026-09-18", date_to="2026-09-18", shop_id=sid))
        assert mobile_like["farmer_pattis"] == 2
        assert mobile_like["farmer_bags"] == 15
        assert mobile_like["farmers_with_patti"] == 2

        # Cross-shop day totals
        all_day = _run(sum_patti_bags_and_count(db, date_from="2026-09-18", date_to="2026-09-18"))
        assert all_day["farmer_pattis"] == 3
        assert all_day["farmer_bags"] == 18

    def test_vendor_bills_no_double_count_deleted(self):
        db = FakeDB()
        db._store["vendor_bills"] = [
            {"id": "b1", "shop_id": "s1", "date": "2026-09-18", "deleted": False},
            {"id": "b2", "shop_id": "s1", "date": "2026-09-18", "deleted": True},
            {"id": "b3", "shop_id": "s1", "date": "2026-09-18", "deleted": False},
        ]
        assert _run(count_vendor_bills(db, date_from="2026-09-18", date_to="2026-09-18", shop_id="s1")) == 2

    def test_purchased_bags_paid_at_preferred_and_ist_window(self):
        db = FakeDB()
        # IST day 2026-09-18 window: [2026-09-17 18:30Z, 2026-09-18 18:30Z)
        inside = datetime(2026, 9, 18, 0, 0, tzinfo=timezone.utc)  # 05:30 IST
        outside_before = datetime(2026, 9, 17, 18, 29, tzinfo=timezone.utc)
        outside_after = datetime(2026, 9, 18, 18, 30, tzinfo=timezone.utc)
        db._store["bag_purchases"] = [
            {"id": "1", "shop_id": "s1", "status": "PAID", "bags": 10, "paid_at": inside, "created_at": outside_before},
            # paid_at null → fallback created_at inside
            {"id": "2", "shop_id": "s1", "status": "PAID", "bags": 5, "paid_at": None, "created_at": inside},
            # PENDING ignored
            {"id": "3", "shop_id": "s1", "status": "PENDING", "bags": 50, "paid_at": inside, "created_at": inside},
            # outside window
            {"id": "4", "shop_id": "s1", "status": "PAID", "bags": 7, "paid_at": outside_before, "created_at": outside_before},
            {"id": "5", "shop_id": "s1", "status": "PAID", "bags": 8, "paid_at": outside_after, "created_at": outside_after},
        ]
        n = _run(sum_purchased_bags(db, date_from="2026-09-18", date_to="2026-09-18", shop_id="s1"))
        assert n == 15  # 10 + 5, not double-counting paid_at and created_at

    def test_build_dashboard_directory_vs_active_labels(self):
        db = FakeDB()
        db._store["shops"] = [{"id": "s1", "active": True}, {"id": "s2", "active": False}]
        db._store["farmers"] = [{"id": "f1", "shop_id": "s1"}, {"id": "f2", "shop_id": "s1"}]
        db._store["vendors"] = [{"id": "v1", "shop_id": "s1"}]
        db._store["pattis"] = [
            {"id": "p1", "shop_id": "s1", "date": "2026-09-18", "total_bags": 4, "farmer_id": "f1", "deleted": False},
        ]
        db._store["vendor_bills"] = [
            {"id": "b1", "shop_id": "s1", "date": "2026-09-18", "vendor_id": "v1", "deleted": False},
        ]
        db._store["bag_purchases"] = []
        dash = _run(build_dashboard(db, date_from="2026-09-18", date_to="2026-09-18", shop_id="s1"))
        assert dash["farmers_directory"] == 2
        assert dash["farmers_with_patti"] == 1
        assert dash["farmer_bags"] == 4
        assert dash["farmer_pattis"] == 1
        assert dash["vendors_directory"] == 1
        assert dash["vendors_with_bills"] == 1
        assert dash["vendor_bills"] == 1
        assert "farmers_directory" in dash["definitions"]


# ---------- Auth / routes ----------
def _seed_admin(db: FakeDB):
    admin = {
        "id": uid(),
        "username": "admin1",
        "password_hash": pwd.hash("adminpass1"),
        "display_name": "Admin One",
        "role": ROLE_PLATFORM_ADMIN,
        "active": True,
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    db._store["platform_admins"] = [admin]
    db._store["platform_admin_audit_log"] = []
    return admin


def _app(db: FakeDB) -> TestClient:
    from fastapi import APIRouter

    api = APIRouter(prefix="/api")
    register_platform_admin(api, db)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app)


class TestAdminAuthRoutes:
    def test_login_and_me(self):
        db = FakeDB()
        admin = _seed_admin(db)
        client = _app(db)
        r = client.post("/api/admin/auth/login", json={"username": "admin1", "password": "adminpass1"})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        me = client.get("/api/admin/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["username"] == "admin1"
        assert me.json()["id"] == admin["id"]

    def test_merchant_style_rejection_without_token(self):
        db = FakeDB()
        _seed_admin(db)
        client = _app(db)
        r = client.get("/api/admin/dashboard?date=2026-09-18")
        assert r.status_code == 401

    def test_legacy_x_admin_key_works(self):
        db = FakeDB()
        _seed_admin(db)
        db._store["shops"] = []
        db._store["farmers"] = []
        db._store["vendors"] = []
        db._store["pattis"] = []
        db._store["vendor_bills"] = []
        db._store["bag_purchases"] = []
        client = _app(db)
        r = client.get(
            "/api/admin/dashboard?date=2026-09-18",
            headers={"X-Admin-Key": "lemon-admin-dev"},
        )
        assert r.status_code == 200, r.text

    def test_dashboard_with_jwt(self):
        db = FakeDB()
        admin = _seed_admin(db)
        db._store["shops"] = [{"id": "s1", "active": True, "shop_name": "A"}]
        db._store["farmers"] = []
        db._store["vendors"] = []
        db._store["pattis"] = [
            {"id": "p1", "shop_id": "s1", "date": "2026-09-18", "total_bags": 2, "farmer_id": "f1", "deleted": False}
        ]
        db._store["vendor_bills"] = []
        db._store["bag_purchases"] = []
        token = make_admin_token(admin)
        client = _app(db)
        r = client.get(
            "/api/admin/dashboard?date=2026-09-18",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["farmer_pattis"] == 1
        assert body["farmer_bags"] == 2
