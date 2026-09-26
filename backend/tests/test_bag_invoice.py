"""Bag Balance invoice + GST/HSN settings tests."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class FakeCursor:
    def __init__(self, rows: List[dict]):
        self._rows = rows

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
    def __init__(self, rows: Optional[List[dict]] = None):
        self.rows = list(rows or [])

    async def create_index(self, *a, **k):
        return None

    async def find_one(self, query: dict, *a, **k):
        for r in self.rows:
            if all(r.get(k) == v for k, v in query.items()):
                return dict(r)
        return None

    def find(self, query: dict, *a, **k):
        out = []
        for r in self.rows:
            if all(r.get(k) == v for k, v in query.items()):
                out.append(dict(r))
        return FakeCursor(out)

    async def insert_one(self, doc: dict):
        self.rows.append(dict(doc))
        return None

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        for i, r in enumerate(self.rows):
            if all(r.get(k) == v for k, v in query.items()):
                if "$set" in update:
                    self.rows[i] = {**r, **update["$set"]}
                if "$setOnInsert" in update:
                    pass
                return type("R", (), {"modified_count": 1})()
        if upsert and "$setOnInsert" in update:
            self.rows.append(dict(update["$setOnInsert"]))
            return type("R", (), {"modified_count": 1})()
        if upsert and "$set" in update:
            doc = {"id": query.get("id"), **update["$set"]}
            self.rows.append(doc)
            return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    async def find_one_and_update(self, query, update, return_document=True, projection=None):
        for i, r in enumerate(self.rows):
            if all(r.get(k) == v for k, v in query.items()):
                if "$set" in update:
                    self.rows[i] = {**r, **update["$set"]}
                return dict(self.rows[i])
        return None

    def aggregate(self, pipeline):
        # Minimal stub for wallet views unused in invoice test
        return FakeCursor([])


class FakeDB:
    def __init__(self):
        self.platform_billing_settings = FakeColl()
        self.merchant_bag_wallets = FakeColl()
        self.bag_purchases = FakeColl()
        self.bag_usage = FakeColl()
        self.shops = FakeColl()
        self.pattis = FakeColl()


def test_bag_invoice_from_real_purchase():
    import billing as billing_mod
    from fastapi import APIRouter

    db = FakeDB()
    shop_id = "shop-1"
    purchase_id = "pur-1"
    now = datetime.now(timezone.utc)
    db.shops.rows.append(
        {
            "id": shop_id,
            "shop_name": "Test Mandi",
            "username": "merchant1",
            "owner_name": "Ravi",
            "mobile": "9999999999",
            "address": "Main Road",
            "village": "V1",
            "district": "D1",
            "state": "KA",
            "gst_number": "29AAAAA0000A1Z5",
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
    db.bag_purchases.rows.append(
        {
            "id": purchase_id,
            "shop_id": shop_id,
            "bags": 1000,
            "price_per_bag": 0.25,
            "base_amount": 250.0,
            "gst_percent": 18.0,
            "gst_amount": 45.0,
            "total_amount": 295.0,
            "status": "PAID",
            "created_at": now,
            "paid_at": now,
            "payment_ref": "TEST-pur-1",
            "invoice_number": None,
        }
    )
    db.merchant_bag_wallets.rows.append(
        {
            "shop_id": shop_id,
            "free_allocated": 1000,
            "free_used": 0,
            "purchased_total": 1000,
            "purchased_used": 0,
            "version": 1,
        }
    )

    api = APIRouter()

    async def current_user():
        return {"id": shop_id, "shop_id": shop_id, "role": "owner"}

    async def owner_only():
        return await current_user()

    billing_mod.attach_billing(api, db=db, current_user=current_user, owner_only=owner_only)

    # Find invoice route handler
    route = next(r for r in api.routes if getattr(r, "path", "") == "/billing/purchases/{purchase_id}/invoice")
    result = asyncio.run(route.endpoint(purchase_id, user={"id": shop_id, "shop_id": shop_id, "role": "owner"}))
    data = result.model_dump() if hasattr(result, "model_dump") else dict(result)

    assert data["bags"] == 1000
    assert data["price_per_bag"] == 0.25
    assert data["base_amount"] == 250.0
    assert data["gst_percent"] == 18.0
    assert data["gst_amount"] == 45.0
    assert data["total_amount"] == 295.0
    assert data["service_hsn_code"] == "998399"
    assert data["billing_to"]["shop_name"] == "Test Mandi"
    assert data["billing_to"]["username"] == "merchant1"
    assert data["invoice_number"].startswith("INV-")
    assert "fake" not in data["line_description"].lower()
    # Supplier identity — brand + legal entity (not tagline / not merchant address)
    assert data["seller"]["brand"] == "LEMON MANDI"
    assert data["seller"]["legal_name"] == "Rbolo Info Services Private Limited"
    assert data["seller"]["gstin"] == "29AAMCR3486L1ZI"
    assert "MUJAWAR MOHALLA" in " ".join(data["seller"]["address_lines"])
    assert "586101" in " ".join(data["seller"]["address_lines"])
    assert data["seller"].get("description") in (None, "")
    assert "Prepaid bag balance platform" not in str(data["seller"])
    assert data["billing_to"]["address"] != " ".join(data["seller"]["address_lines"])
    # Karnataka buyer GSTIN → CGST + SGST
    assert data["gst_supply_type"] == "INTRA"
    assert data["cgst_percent"] == 9.0
    assert data["sgst_percent"] == 9.0
    assert data["cgst_amount"] == 22.5
    assert data["sgst_amount"] == 22.5
    assert data["igst_amount"] == 0.0
    # Persisted on purchase
    stored = next(p for p in db.bag_purchases.rows if p["id"] == purchase_id)
    assert stored.get("invoice_number") == data["invoice_number"]


def test_bag_invoice_igst_for_other_state_buyer():
    import billing as billing_mod

    parts = billing_mod.split_bag_gst(
        gst_percent=18.0,
        gst_amount=1800.0,
        buyer_gstin="27AAAAA0000A1Z5",
        buyer_state="MH",
    )
    assert parts["gst_supply_type"] == "INTER"
    assert parts["igst_percent"] == 18.0
    assert parts["igst_amount"] == 1800.0
    assert parts["cgst_amount"] == 0.0
    assert parts["sgst_amount"] == 0.0


def test_default_gst_is_eighteen():
    import billing as billing_mod

    assert billing_mod._DEFAULT_GST == 18.0
    assert billing_mod._DEFAULT_SERVICE_HSN == "998399"
    seller = billing_mod.bag_invoice_seller()
    assert seller["gstin"] == "29AAMCR3486L1ZI"
    assert seller["legal_name"] == "Rbolo Info Services Private Limited"
