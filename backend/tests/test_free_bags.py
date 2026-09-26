"""Unit tests for free bag allocation → claim (no live Mongo required)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class FakeCursor:
    def __init__(self, rows: List[dict]):
        self._rows = list(rows)

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def skip(self, n):
        self._rows = self._rows[n:]
        return self

    async def to_list(self, n):
        return self._rows[:n]

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._i >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._i]
        self._i += 1
        return row


class FakeColl:
    def __init__(self, rows: Optional[List[dict]] = None, *, unique_keys: Optional[List[tuple]] = None):
        self.rows = list(rows or [])
        self.unique_keys = unique_keys or []

    async def create_index(self, *a, **k):
        return None

    def _match(self, row: dict, query: dict) -> bool:
        for k, v in query.items():
            if k == "$or":
                if not any(self._match(row, clause) for clause in v):
                    return False
                continue
            if isinstance(v, dict):
                if "$ne" in v and row.get(k) == v["$ne"]:
                    return False
                if "$in" in v and row.get(k) not in v["$in"]:
                    return False
                if "$regex" in v:
                    import re

                    if not re.search(v["$regex"], str(row.get(k) or ""), re.I if "i" in (v.get("$options") or "") else 0):
                        return False
                continue
            if row.get(k) != v:
                return False
        return True

    async def find_one(self, query: dict, *a, **k):
        for r in self.rows:
            if self._match(r, query):
                return dict(r)
        return None

    def find(self, query: dict, *a, **k):
        out = [dict(r) for r in self.rows if self._match(r, query)]
        return FakeCursor(out)

    async def count_documents(self, query: dict):
        return sum(1 for r in self.rows if self._match(r, query))

    async def insert_one(self, doc: dict):
        for keys in self.unique_keys:
            vals = tuple(doc.get(k) for k in keys)
            for r in self.rows:
                if tuple(r.get(k) for k in keys) == vals and all(v is not None for v in vals):
                    raise Exception("duplicate key")
        self.rows.append(dict(doc))
        return None

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        for i, r in enumerate(self.rows):
            if self._match(r, query):
                row = dict(r)
                if "$set" in update:
                    row.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        row[k] = int(row.get(k) or 0) + int(v)
                self.rows[i] = row
                return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    async def update_many(self, query: dict, update: dict):
        n = 0
        for i, r in enumerate(self.rows):
            if self._match(r, query):
                row = dict(r)
                if "$set" in update:
                    row.update(update["$set"])
                self.rows[i] = row
                n += 1
        return type("R", (), {"modified_count": n})()

    async def find_one_and_update(self, query, update, return_document=True, projection=None):
        for i, r in enumerate(self.rows):
            if self._match(r, query):
                row = dict(r)
                if "$set" in update:
                    row.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        row[k] = int(row.get(k) or 0) + int(v)
                self.rows[i] = row
                return dict(row)
        return None

    def aggregate(self, pipeline):
        return FakeCursor([])


class FakeDB:
    def __init__(self):
        self.platform_billing_settings = FakeColl()
        self.merchant_bag_wallets = FakeColl()
        self.bag_purchases = FakeColl()
        self.bag_usage = FakeColl(unique_keys=[("shop_id", "allocation_id", "kind")])
        self.bag_free_allocations = FakeColl(unique_keys=[("client_request_id",)])
        self.bag_free_bulk_requests = FakeColl(unique_keys=[("client_request_id",)])
        self.merchant_notifications = FakeColl()
        self.shops = FakeColl()
        self.pattis = FakeColl()
        self.platform_admin_audit_log = FakeColl()


def _setup():
    import billing as billing_mod
    from fastapi import APIRouter

    db = FakeDB()
    shop_id = "shop-free-1"
    now = datetime.now(timezone.utc)
    db.shops.rows.append(
        {
            "id": shop_id,
            "shop_name": "Free Bags Mandi",
            "username": "free_merchant",
            "owner_name": "Owner A",
            "mobile": "9000000001",
            "active": True,
        }
    )
    db.platform_billing_settings.rows.append(
        {
            "id": "default",
            "price_per_bag": 0.25,
            "new_merchant_free_bags": 1000,
            "gst_percent": 18.0,
            "service_hsn_code": "998399",
            "allow_test_payments": True,
            "billing_active": True,
        }
    )
    db.merchant_bag_wallets.rows.append(
        {
            "id": "w1",
            "shop_id": shop_id,
            "free_allocated": 1000,
            "free_used": 0,
            "purchased_total": 0,
            "purchased_used": 0,
            "version": 1,
            "created_at": now,
            "updated_at": now,
        }
    )

    api = APIRouter()

    async def current_user():
        return {"id": "user-1", "shop_id": shop_id, "role": "owner"}

    async def owner_only():
        return await current_user()

    billing_mod.attach_billing(api, db=db, current_user=current_user, owner_only=owner_only)

    def route(path: str, method: str = "GET"):
        for r in api.routes:
            if getattr(r, "path", None) == path and method in (getattr(r, "methods", set()) or set()):
                return r
        raise AssertionError(f"route not found {method} {path}")

    return db, shop_id, api, route, billing_mod


def test_admin_allocate_does_not_increase_wallet():
    db, shop_id, api, route, _ = _setup()
    admin = {"id": "adm-1", "username": "superadmin"}
    create = route("/admin/billing/free-allocations", "POST")
    result = asyncio.run(
        create.endpoint(
            __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn(
                shop_id=shop_id, bags=100, year=2026, month=9, reason="Promo"
            ),
            admin=admin,
        )
    )
    data = result.model_dump()
    assert data["status"] == "PENDING"
    assert data["bags"] == 100
    assert data["period_label"] == "September 2026"
    assert len(db.bag_free_allocations.rows) == 1
    assert len(db.merchant_notifications.rows) == 1
    notif = db.merchant_notifications.rows[0]
    assert notif["kind"] == "FREE_BAGS"
    assert notif["action"] == "CLAIM_FREE_BAGS"
    assert "100" in notif["body"]
    assert "Claim them now" in notif["body"]
    assert notif["read"] is False
    # Wallet unchanged until claim
    w = db.merchant_bag_wallets.rows[0]
    assert w["free_allocated"] == 1000


def test_claim_increases_balance_once_and_is_idempotent():
    db, shop_id, api, route, _ = _setup()
    admin = {"id": "adm-1", "username": "superadmin"}
    create = route("/admin/billing/free-allocations", "POST")
    FreeAllocationCreateIn = __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn
    alloc = asyncio.run(
        create.endpoint(
            FreeAllocationCreateIn(shop_id=shop_id, bags=200, year=2026, month=1),
            admin=admin,
        )
    )
    alloc_id = alloc.id
    claim = route("/billing/free-allocations/{allocation_id}/claim", "POST")
    user = {"id": "user-1", "shop_id": shop_id, "role": "owner"}

    first = asyncio.run(claim.endpoint(alloc_id, user=user))
    assert first.status == "CLAIMED"
    assert first.claim_ref
    assert db.merchant_bag_wallets.rows[0]["free_allocated"] == 1200
    assert sum(1 for u in db.bag_usage.rows if u.get("kind") == "FREE_CLAIM") == 1

    # Duplicate claim — no second credit
    second = asyncio.run(claim.endpoint(alloc_id, user=user))
    assert second.status == "CLAIMED"
    assert db.merchant_bag_wallets.rows[0]["free_allocated"] == 1200
    assert sum(1 for u in db.bag_usage.rows if u.get("kind") == "FREE_CLAIM") == 1

    # Notification marked read
    assert all(n["read"] for n in db.merchant_notifications.rows if n.get("allocation_id") == alloc_id)


def test_unauthorized_shop_cannot_claim_others_allocation():
    db, shop_id, api, route, _ = _setup()
    admin = {"id": "adm-1", "username": "superadmin"}
    create = route("/admin/billing/free-allocations", "POST")
    FreeAllocationCreateIn = __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn
    alloc = asyncio.run(
        create.endpoint(
            FreeAllocationCreateIn(shop_id=shop_id, bags=50, year=2026, month=3),
            admin=admin,
        )
    )
    claim = route("/billing/free-allocations/{allocation_id}/claim", "POST")
    other = {"id": "user-2", "shop_id": "other-shop", "role": "owner"}
    try:
        asyncio.run(claim.endpoint(alloc.id, user=other))
        raise AssertionError("expected 404")
    except Exception as e:
        assert getattr(e, "status_code", None) == 404
    assert db.merchant_bag_wallets.rows[0]["free_allocated"] == 1000


def test_multiple_months_independent():
    db, shop_id, api, route, _ = _setup()
    admin = {"id": "adm-1", "username": "superadmin"}
    create = route("/admin/billing/free-allocations", "POST")
    FreeAllocationCreateIn = __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn
    a1 = asyncio.run(create.endpoint(FreeAllocationCreateIn(shop_id=shop_id, bags=200, year=2026, month=1), admin=admin))
    a2 = asyncio.run(create.endpoint(FreeAllocationCreateIn(shop_id=shop_id, bags=100, year=2026, month=2), admin=admin))
    claim = route("/billing/free-allocations/{allocation_id}/claim", "POST")
    user = {"id": "user-1", "shop_id": shop_id, "role": "owner"}
    asyncio.run(claim.endpoint(a2.id, user=user))
    assert db.merchant_bag_wallets.rows[0]["free_allocated"] == 1100
    # Jan still PENDING
    jan = next(r for r in db.bag_free_allocations.rows if r["id"] == a1.id)
    feb = next(r for r in db.bag_free_allocations.rows if r["id"] == a2.id)
    assert jan["status"] == "PENDING"
    assert feb["status"] == "CLAIMED"

    summary = route("/billing/free-summary", "GET")
    s = asyncio.run(summary.endpoint(user=user))
    assert s.allocated == 300
    assert s.claimed == 100
    assert s.available_to_claim == 200


def test_wallet_exposes_available_to_claim_without_increasing_total():
    db, shop_id, api, route, _ = _setup()
    admin = {"id": "adm-1", "username": "superadmin"}
    create = route("/admin/billing/free-allocations", "POST")
    FreeAllocationCreateIn = __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn
    asyncio.run(create.endpoint(FreeAllocationCreateIn(shop_id=shop_id, bags=75, year=2026, month=4), admin=admin))
    wallet_route = route("/billing/wallet", "GET")
    user = {"id": "user-1", "shop_id": shop_id, "role": "owner"}
    w = asyncio.run(wallet_route.endpoint(user=user))
    assert w.free_available_to_claim == 75
    assert w.free_allocated == 1000
    assert w.total_available == 1000


def test_admin_free_summary_and_list_filters():
    db, shop_id, api, route, _ = _setup()
    admin = {"id": "adm-1", "username": "superadmin"}
    create = route("/admin/billing/free-allocations", "POST")
    FreeAllocationCreateIn = __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn
    asyncio.run(create.endpoint(FreeAllocationCreateIn(shop_id=shop_id, bags=100, year=2026, month=5), admin=admin))
    lst = route("/admin/billing/free-allocations", "GET")
    rows = asyncio.run(lst.endpoint(admin=admin, shop_id=shop_id, status="PENDING", year=2026, month=5, q=None, limit=50))
    assert len(rows) == 1
    assert rows[0].status == "PENDING"
    summary = route("/admin/billing/merchants/{shop_id}/free-summary", "GET")
    s = asyncio.run(summary.endpoint(shop_id, admin=admin))
    assert s.available_to_claim == 100
    assert s.unclaimed == 100
    assert s.claimed == 0


def test_bulk_allocate_each_merchant_and_idempotent_request():
    db, shop_id, api, route, _ = _setup()
    shop2 = "shop-free-2"
    db.shops.rows.append(
        {
            "id": shop2,
            "shop_name": "Second Mandi",
            "username": "second",
            "mobile": "9000000002",
            "active": True,
        }
    )
    db.merchant_bag_wallets.rows.append(
        {
            "id": "w2",
            "shop_id": shop2,
            "free_allocated": 0,
            "free_used": 0,
            "purchased_total": 0,
            "purchased_used": 0,
            "version": 1,
        }
    )
    admin = {"id": "adm-1", "username": "superadmin"}
    FreeAllocationBulkIn = __import__("free_bags", fromlist=["FreeAllocationBulkIn"]).FreeAllocationBulkIn
    bulk = route("/admin/billing/free-allocations/bulk", "POST")
    payload = FreeAllocationBulkIn(
        shop_ids=[shop_id, shop2, shop_id],  # duplicate id ignored
        bags=100,
        year=2026,
        month=9,
        reason="Multi gift",
        client_request_id="bulk-req-1",
    )
    first = asyncio.run(bulk.endpoint(payload, admin=admin))
    assert first.count == 2
    assert first.bags_each == 100
    assert len(db.bag_free_allocations.rows) == 2
    assert all(r["status"] == "PENDING" for r in db.bag_free_allocations.rows)
    assert len(db.merchant_notifications.rows) == 2
    # Wallet unchanged for both
    assert db.merchant_bag_wallets.rows[0]["free_allocated"] == 1000
    assert db.merchant_bag_wallets.rows[1]["free_allocated"] == 0

    # Idempotent bulk retry
    second = asyncio.run(bulk.endpoint(payload, admin=admin))
    assert second.count == 2
    assert len(db.bag_free_allocations.rows) == 2
    assert len(db.merchant_notifications.rows) == 2


def test_allocate_client_request_id_prevents_double_click():
    db, shop_id, api, route, _ = _setup()
    admin = {"id": "adm-1", "username": "superadmin"}
    create = route("/admin/billing/free-allocations", "POST")
    FreeAllocationCreateIn = __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn
    payload = FreeAllocationCreateIn(
        shop_id=shop_id, bags=200, year=2026, month=9, client_request_id="single-req-1"
    )
    a1 = asyncio.run(create.endpoint(payload, admin=admin))
    a2 = asyncio.run(create.endpoint(payload, admin=admin))
    assert a1.id == a2.id
    assert len(db.bag_free_allocations.rows) == 1


def test_period_label_helper():
    from free_bags import period_label

    assert period_label(2026, 1) == "January 2026"
    assert period_label(2026, 9) == "September 2026"
