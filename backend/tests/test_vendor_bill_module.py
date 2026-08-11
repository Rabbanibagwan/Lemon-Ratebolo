"""Backend tests for Vendor Bill Module + Farmer Patti stationery_flat rule.

Covers:
- Farmer Patti generation with FLAT stationery (not per-bag) and immutability from vendor ops.
- Settings default stationery_flat=5.0 and PUT update propagates on next patti generation.
- Vendor Bill CRUD (compute vendor_rate, commission_total, grand_total, bill_code, status).
- Vendor Payments + FIFO-like allocation, vendor dashboard, list.
- Unbilled-lines auto-draft endpoint.
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
import requests


# --------------------------- helpers ---------------------------

def _today() -> str:
    return dt.date.today().isoformat()


@pytest.fixture(scope="module")
def shop(base_url):
    """Fresh shop signup + token for vendor-bill test module."""
    username = f"vb_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{base_url}/api/auth/signup",
        json={"shop_name": "TEST VB Shop", "username": username, "password": "passVB1234"},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    return {
        "token": data["access_token"],
        "shop_id": data["shop_id"],
        "username": username,
        "headers": {"Authorization": f"Bearer {data['access_token']}",
                    "Content-Type": "application/json"},
    }


@pytest.fixture(scope="module")
def seed(base_url, shop):
    """Create farmer + 2 vendors + auction day and return their ids."""
    H = shop["headers"]

    r = requests.post(f"{base_url}/api/farmers",
                      json={"name": "TEST Ramanna", "village": "DGR"}, headers=H)
    assert r.status_code in (200, 201), r.text
    farmer = r.json()

    r = requests.post(f"{base_url}/api/vendors",
                      json={"name": "TEST V1", "details": "V1 Traders, Test"}, headers=H)
    assert r.status_code in (200, 201), r.text
    v1 = r.json()

    r = requests.post(f"{base_url}/api/vendors",
                      json={"name": "TEST V2", "details": "V2 Traders, Test"}, headers=H)
    assert r.status_code in (200, 201), r.text
    v2 = r.json()

    r = requests.get(f"{base_url}/api/auction-days/today", headers=H)
    assert r.status_code == 200, r.text
    day = r.json()

    return {"farmer": farmer, "v1": v1, "v2": v2, "day": day}


# --------------------------- 1. Patti stationery_flat ---------------------------

class TestPattiStationeryFlat:
    """Critical bug fix — stationery must be FLAT per Patti, not per-bag."""

    def test_generate_patti_flat_stationery(self, base_url, shop, seed):
        H = shop["headers"]
        day_id = seed["day"]["id"]
        # NOTE: schema requires date, range_from, range_to on drivers
        r = requests.put(
            f"{base_url}/api/auction-days/{day_id}",
            json={
                "date": _today(),
                "drivers": [{"name": "VITTAL", "place": "DGR",
                             "bhada_per_bag": 60, "range_from": 1, "range_to": 100}],
            }, headers=H,
        )
        assert r.status_code == 200, r.text

        # Lot 3/10 -> falls in 1-100 -> driver VITTAL bhada=60/bag
        r = requests.post(
            f"{base_url}/api/lots",
            json={
                "auction_day_id": day_id,
                "lot_no": "3/10",
                "farmer_id": seed["farmer"]["id"],
                "sales": [
                    {"vendor_id": seed["v1"]["id"], "bags": 5, "rate_per_bag": 1500},
                    {"vendor_id": seed["v2"]["id"], "bags": 5, "rate_per_bag": 1200},
                ],
            }, headers=H,
        )
        assert r.status_code in (200, 201), r.text
        lot = r.json()
        # Save for later cleanup / reuse across tests
        pytest.lot_id = lot["id"]

        r = requests.post(f"{base_url}/api/auction-days/{day_id}/generate-pattis", headers=H)
        assert r.status_code in (200, 201), r.text
        pattis = r.json()
        assert len(pattis) == 1
        p = pattis[0]

        # Snapshot expected values
        assert p["total_bags"] == 10
        # gross = 5*1500 + 5*1200 = 7500+6000 = 13500
        assert p["gross_total"] == 13500.0
        # farmer_gross = 13500 * 0.9 = 12150
        assert p["farmer_gross"] == 12150.0
        # hamali = 10 * 10 = 100
        assert p["hamali_total"] == 100.0
        # ★ stationery FLAT = 5.0 (NOT 50)
        assert p["stationery_total"] == 5.0, (
            f"stationery_total should be FLAT=5, got {p['stationery_total']}"
        )
        assert p["stationery_flat"] == 5.0
        # bhada = 10 bags * 60 = 600
        assert p["bhada_total"] == 600.0
        # deductions = 100 + 5 + 600 = 705
        assert p["deductions_total"] == 705.0
        # net = 12150 - 705 = 11445
        assert p["net_payable"] == 11445.0

        pytest.patti_id = p["id"]
        pytest.patti_snapshot = {k: p[k] for k in
                                 ("farmer_gross", "hamali_total", "stationery_total",
                                  "bhada_total", "deductions_total", "net_payable",
                                  "total_bags")}


# --------------------------- 2. Settings.stationery_flat ---------------------------

class TestSettingsStationery:
    def test_default_stationery_flat_is_5(self, base_url, shop):
        r = requests.get(f"{base_url}/api/settings", headers=shop["headers"])
        assert r.status_code == 200, r.text
        s = r.json()
        assert s.get("stationery_flat") == 5.0

    def test_update_stationery_flat_then_regenerate(self, base_url, shop, seed):
        H = shop["headers"]
        cur = requests.get(f"{base_url}/api/settings", headers=H).json()
        # PUT with existing settings but stationery_flat=7
        payload = {**cur, "stationery_flat": 7.0}
        # strip readonly-ish fields to be safe
        for k in ("shop_id", "updated_at", "_id"):
            payload.pop(k, None)
        r = requests.put(f"{base_url}/api/settings", json=payload, headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["stationery_flat"] == 7.0

        # Re-generate pattis (idempotent -> recomputes numbers on existing patti)
        r = requests.post(
            f"{base_url}/api/auction-days/{seed['day']['id']}/generate-pattis",
            headers=H,
        )
        assert r.status_code in (200, 201)
        p = r.json()[0]
        assert p["stationery_total"] == 7.0, (
            f"After PUT stationery_flat=7, stationery_total should be 7 flat, got {p['stationery_total']}"
        )
        assert p["stationery_flat"] == 7.0

        # Refresh snapshot for immutability test with new stationery
        pytest.patti_id = p["id"]
        pytest.patti_snapshot = {k: p[k] for k in
                                 ("farmer_gross", "hamali_total", "stationery_total",
                                  "bhada_total", "deductions_total", "net_payable",
                                  "total_bags")}


# --------------------------- 3. Vendor Bill CRUD ---------------------------

class TestVendorBillCRUD:
    def test_create_vendor_bill(self, base_url, shop, seed):
        H = shop["headers"]
        body = {
            "vendor_id": seed["v1"]["id"],
            "date": _today(),
            "vendor_factor": 1.0,  # margin-only path for this test
            "margin_per_bag": 30,
            "commission_per_bag": 10,
            "hamali": 0,
            "cess": 0,
            "lines": [{"lot_no": "3/10", "farmer_name": "Ramanna",
                       "bags": 5, "auction_rate": 1500}],
        }
        r = requests.post(f"{base_url}/api/vendor-bills", json=body, headers=H)
        assert r.status_code == 201, r.text
        b = r.json()
        assert b["lines"][0]["vendor_rate"] == 1530.0  # 1500 × 1.0 + 30
        assert b["lines"][0]["amount"] == 7650.0  # 5 × 1530
        assert b["commission_total"] == 50.0  # 5 bags × 10
        assert b["goods_total"] == 7650.0
        assert b["grand_total"] == 7700.0  # 7650 + 50 + 0 + 0
        assert b["paid"] == 0
        assert b["balance"] == 7700.0
        assert b["status"] == "unpaid"
        assert b["bill_code"] == "VB-0001"
        assert b["total_bags"] == 5
        assert b["vendor_factor"] == 1.0
        assert b["vendor_details"] == "V1 Traders, Test"
        pytest.bill_id = b["id"]

    def test_create_vendor_bill_with_factor(self, base_url, shop, seed):
        """vendor_rate = auction × vendor_factor + margin (defaults 1.06 / 30)."""
        H = shop["headers"]
        body = {
            "vendor_id": seed["v2"]["id"],
            "date": _today(),
            "vendor_factor": 1.06,
            "margin_per_bag": 30,
            "commission_per_bag": 10,
            "hamali": 0,
            "cess": 0,
            "lines": [{"lot_no": "3/10", "farmer_name": "Ramanna",
                       "bags": 2, "auction_rate": 1000}],
        }
        r = requests.post(f"{base_url}/api/vendor-bills", json=body, headers=H)
        assert r.status_code == 201, r.text
        b = r.json()
        # 1000 × 1.06 + 30 = 1090
        assert b["lines"][0]["vendor_rate"] == 1090.0
        assert b["lines"][0]["amount"] == 2180.0
        assert b["commission_total"] == 20.0
        assert b["grand_total"] == 2200.0
        assert b["vendor_factor"] == 1.06
        # Soft-delete so it doesn't interfere with later tests
        requests.delete(f"{base_url}/api/vendor-bills/{b['id']}",
                        json={"reason": "cleanup"}, headers=H)

    def test_list_bills_by_vendor(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/vendor-bills",
                         params={"vendor_id": seed["v1"]["id"]}, headers=H)
        assert r.status_code == 200, r.text
        lst = r.json()
        assert any(b["id"] == pytest.bill_id for b in lst)

    def test_get_bill_detail(self, base_url, shop):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/vendor-bills/{pytest.bill_id}", headers=H)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["id"] == pytest.bill_id
        assert b["grand_total"] == 7700.0

    def test_update_bill_hamali(self, base_url, shop, seed):
        H = shop["headers"]
        body = {
            "vendor_id": seed["v1"]["id"],
            "date": _today(),
            "vendor_factor": 1.0,
            "margin_per_bag": 30,
            "commission_per_bag": 10,
            "hamali": 200,
            "cess": 0,
            "lines": [{"lot_no": "3/10", "farmer_name": "Ramanna",
                       "bags": 5, "auction_rate": 1500}],
        }
        r = requests.put(f"{base_url}/api/vendor-bills/{pytest.bill_id}",
                         json=body, headers=H)
        assert r.status_code == 200, r.text
        b = r.json()
        # 7650 + 50 + 200 = 7900
        assert b["grand_total"] == 7900.0
        assert b["hamali"] == 200.0
        # GET to verify persistence
        got = requests.get(f"{base_url}/api/vendor-bills/{pytest.bill_id}", headers=H).json()
        assert got["grand_total"] == 7900.0

    def test_soft_delete_bill(self, base_url, shop):
        H = shop["headers"]
        r = requests.delete(f"{base_url}/api/vendor-bills/{pytest.bill_id}",
                            json={"reason": "TEST — test cleanup"}, headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "deleted"

        # Not in default list
        r = requests.get(f"{base_url}/api/vendor-bills",
                         headers=H).json()
        assert not any(b["id"] == pytest.bill_id for b in r), \
            "Deleted bill should not appear in default list"

        # Visible with include_deleted
        r = requests.get(f"{base_url}/api/vendor-bills",
                         params={"include_deleted": "true"}, headers=H).json()
        assert any(b["id"] == pytest.bill_id and b["status"] == "deleted" for b in r)


# --------------------------- 4. Vendor Payments & FIFO ---------------------------

class TestVendorPayments:
    def test_create_fresh_bill_for_payment(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.post(
            f"{base_url}/api/vendor-bills",
            json={
                "vendor_id": seed["v1"]["id"], "date": _today(),
                "vendor_factor": 1.0,
                "margin_per_bag": 30, "commission_per_bag": 10, "hamali": 0, "cess": 0,
                "lines": [{"lot_no": "3/10", "farmer_name": "Ramanna",
                           "bags": 5, "auction_rate": 1500}],
            }, headers=H,
        )
        assert r.status_code == 201, r.text
        b = r.json()
        assert b["grand_total"] == 7700.0
        pytest.fresh_bill_id = b["id"]

    def test_receive_partial_payment_and_status(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.post(
            f"{base_url}/api/vendor-payments",
            json={
                "vendor_id": seed["v1"]["id"],
                "amount": 3000, "mode": "cash",
                "allocations": [{"bill_id": pytest.fresh_bill_id, "amount": 3000}],
            }, headers=H,
        )
        assert r.status_code == 201, r.text
        pay = r.json()
        assert pay["amount"] == 3000
        assert pay["allocations"][0]["amount"] == 3000

        got = requests.get(f"{base_url}/api/vendor-bills/{pytest.fresh_bill_id}", headers=H).json()
        assert got["paid"] == 3000.0
        assert got["status"] == "partial"
        assert got["balance"] == 4700.0

    def test_vendor_dashboard_reflects_outstanding(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/vendors/{seed['v1']['id']}/dashboard", headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["outstanding"] == 4700.0
        assert d["total_paid"] == 3000.0
        assert d["total_purchase"] == 7700.0

    def test_list_payments(self, base_url, shop, seed):
        r = requests.get(f"{base_url}/api/vendor-payments",
                         params={"vendor_id": seed["v1"]["id"]}, headers=shop["headers"])
        assert r.status_code == 200, r.text
        lst = r.json()
        assert len(lst) >= 1
        assert lst[0]["amount"] == 3000.0
        assert lst[0]["allocations"][0]["bill_id"] == pytest.fresh_bill_id


# --------------------------- 5. Patti IMMUTABILITY vs vendor ops ---------------------------

class TestPattiImmutabilityAfterVendorOps:
    """Critical rule: vendor bill create/edit/delete/payment must NEVER recompute the Patti."""

    def test_patti_numbers_unchanged(self, base_url, shop):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/pattis/{pytest.patti_id}", headers=H)
        assert r.status_code == 200, r.text
        p = r.json()
        snap = pytest.patti_snapshot
        for k, v in snap.items():
            assert p[k] == v, (
                f"Patti.{k} MUTATED after vendor ops: was {v}, now {p[k]}"
            )


# --------------------------- 6. Auto-draft (unbilled-lines) ---------------------------

class TestUnbilledLines:
    def test_unbilled_lines_shape(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(
            f"{base_url}/api/vendors/{seed['v1']['id']}/unbilled-lines",
            params={"date": _today()}, headers=H,
        )
        assert r.status_code == 200, r.text
        lines = r.json()
        assert len(lines) >= 1
        # Confirm the line for V1 matches our sale (5 bags @ 1500 for lot 3/10)
        match = [l for l in lines if l["lot_no"] == "3/10"]
        assert match, "expected line for lot 3/10"
        L = match[0]
        assert set(L.keys()) >= {"lot_id", "lot_no", "farmer_name", "bags", "auction_rate"}
        assert L["bags"] == 5
        assert L["auction_rate"] == 1500.0
        assert L["farmer_name"]  # non-empty

    def test_unbilled_lines_v2(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(
            f"{base_url}/api/vendors/{seed['v2']['id']}/unbilled-lines",
            params={"date": _today()}, headers=H,
        )
        assert r.status_code == 200, r.text
        lines = r.json()
        match = [l for l in lines if l["lot_no"] == "3/10"]
        assert match
        assert match[0]["bags"] == 5
        assert match[0]["auction_rate"] == 1200.0


# --------------------------- 7. PattiOut backward-compat ---------------------------

class TestPattiBackwardCompat:
    """Legacy pattis with stationery_per_bag are returned with stationery_flat populated."""

    def test_list_pattis_all_have_stationery_flat(self, base_url, shop):
        r = requests.get(f"{base_url}/api/pattis", headers=shop["headers"])
        assert r.status_code == 200, r.text
        for p in r.json():
            assert "stationery_flat" in p
            assert isinstance(p["stationery_flat"], (int, float))
