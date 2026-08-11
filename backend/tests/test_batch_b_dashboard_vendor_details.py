"""Batch B backend tests — Iteration 12.

Covers:
1. GET /api/dashboard?date=YYYY-MM-DD filters by that date (default = today).
2. POST /api/vendors accepts `details`; PUT updates it.
3. POST /api/vendor-bills snapshots vendor.details on the bill.
4. PUT /api/vendor-bills/{id} refreshes vendor_details snapshot.
5. GET /api/vendor-bills falls back to current vendor.details when snapshot is null (legacy).
6. Regression: 1-Patti-per-Lot rule still holds.
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
import requests


def _today() -> str:
    return dt.date.today().isoformat()


@pytest.fixture(scope="module")
def shop(base_url):
    """Fresh, isolated shop for Batch B tests."""
    username = f"batchb_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{base_url}/api/auth/signup",
        json={"shop_name": "TEST BatchB", "username": username, "password": "passBB1234"},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    return {
        "token": data["access_token"],
        "shop_id": data["shop_id"],
        "username": username,
        "headers": {
            "Authorization": f"Bearer {data['access_token']}",
            "Content-Type": "application/json",
        },
    }


@pytest.fixture(scope="module")
def seed(base_url, shop):
    H = shop["headers"]
    r = requests.post(f"{base_url}/api/farmers", json={"name": "TEST Farmer1"}, headers=H)
    assert r.status_code in (200, 201), r.text
    farmer = r.json()

    r = requests.get(f"{base_url}/api/auction-days/today", headers=H)
    assert r.status_code == 200, r.text
    day = r.json()

    r = requests.put(
        f"{base_url}/api/auction-days/{day['id']}",
        json={"date": _today(),
              "drivers": [{"name": "VITTAL", "place": "DGR",
                           "bhada_per_bag": 50,
                           "range_from": 1, "range_to": 500}]},
        headers=H,
    )
    assert r.status_code == 200, r.text
    return {"farmer": farmer, "day": day}


# --------------------------- 1. Vendor details CRUD ---------------------------

class TestVendorDetails:
    def test_create_vendor_with_details(self, base_url, shop):
        H = shop["headers"]
        r = requests.post(
            f"{base_url}/api/vendors",
            json={"name": "TEST Vendor With Details",
                  "details": "MM Traders \u2014 Indi",
                  "phone": "9999999999"},
            headers=H,
        )
        assert r.status_code == 201, r.text
        v = r.json()
        assert v["name"] == "TEST Vendor With Details"
        assert v["details"] == "MM Traders \u2014 Indi"
        assert v["phone"] == "9999999999"
        assert v["id"]
        pytest.vendor_with_details_id = v["id"]

    def test_create_vendor_without_details_returns_none(self, base_url, shop):
        H = shop["headers"]
        r = requests.post(
            f"{base_url}/api/vendors",
            json={"name": "TEST Vendor No Details"},
            headers=H,
        )
        assert r.status_code == 201, r.text
        v = r.json()
        # details omitted → None
        assert v.get("details") is None
        pytest.vendor_no_details_id = v["id"]

    def test_list_vendors_returns_details(self, base_url, shop):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/vendors", headers=H)
        assert r.status_code == 200, r.text
        vlist = r.json()
        wv = [v for v in vlist if v["id"] == pytest.vendor_with_details_id][0]
        assert wv["details"] == "MM Traders \u2014 Indi"

    def test_update_vendor_details(self, base_url, shop):
        H = shop["headers"]
        r = requests.put(
            f"{base_url}/api/vendors/{pytest.vendor_with_details_id}",
            json={"name": "TEST Vendor With Details",
                  "details": "MM Traders \u2014 Bijapur",
                  "phone": "9999999999"},
            headers=H,
        )
        assert r.status_code == 200, r.text
        v = r.json()
        assert v["details"] == "MM Traders \u2014 Bijapur"
        # GET verify persistence
        r = requests.get(f"{base_url}/api/vendors", headers=H)
        wv = [v for v in r.json() if v["id"] == pytest.vendor_with_details_id][0]
        assert wv["details"] == "MM Traders \u2014 Bijapur"


# --------------------------- 2. Vendor Bill vendor_details snapshot ---------------------------

class TestVendorBillDetailsSnapshot:
    def test_create_bill_snapshots_vendor_details(self, base_url, shop, seed):
        H = shop["headers"]
        body = {
            "vendor_id": pytest.vendor_with_details_id,
            "date": _today(),
            "margin_per_bag": 30,
            "commission_per_bag": 10,
            "hamali": 0,
            "cess": 0,
            "lines": [{"lot_no": "1/5", "farmer_name": "Ramanna",
                       "bags": 5, "auction_rate": 1000}],
        }
        r = requests.post(f"{base_url}/api/vendor-bills", json=body, headers=H)
        assert r.status_code == 201, r.text
        b = r.json()
        assert b["vendor_details"] == "MM Traders \u2014 Bijapur", \
            f"Expected snapshot 'MM Traders — Bijapur', got {b.get('vendor_details')!r}"
        pytest.bill_id_snapshot = b["id"]

    def test_get_bill_returns_snapshot(self, base_url, shop):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/vendor-bills/{pytest.bill_id_snapshot}", headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["vendor_details"] == "MM Traders \u2014 Bijapur"

    def test_snapshot_persists_after_vendor_details_change(self, base_url, shop):
        """Snapshot should NOT change until PUT vendor-bill is invoked."""
        H = shop["headers"]
        # Change vendor.details
        r = requests.put(
            f"{base_url}/api/vendors/{pytest.vendor_with_details_id}",
            json={"name": "TEST Vendor With Details",
                  "details": "MM Traders \u2014 Solapur",
                  "phone": "9999999999"},
            headers=H,
        )
        assert r.status_code == 200, r.text
        # GET bill should still reflect the ORIGINAL snapshot
        r = requests.get(f"{base_url}/api/vendor-bills/{pytest.bill_id_snapshot}", headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["vendor_details"] == "MM Traders \u2014 Bijapur", \
            "Snapshot must remain stable until PUT refreshes it"

    def test_put_bill_refreshes_snapshot(self, base_url, shop):
        H = shop["headers"]
        body = {
            "vendor_id": pytest.vendor_with_details_id,
            "date": _today(),
            "margin_per_bag": 30,
            "commission_per_bag": 10,
            "hamali": 100,  # small change to trigger update
            "cess": 0,
            "lines": [{"lot_no": "1/5", "farmer_name": "Ramanna",
                       "bags": 5, "auction_rate": 1000}],
        }
        r = requests.put(f"{base_url}/api/vendor-bills/{pytest.bill_id_snapshot}",
                         json=body, headers=H)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["vendor_details"] == "MM Traders \u2014 Solapur", \
            "PUT should refresh vendor_details from current vendor doc"
        assert b["hamali"] == 100.0

    def test_list_bills_include_vendor_details(self, base_url, shop):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/vendor-bills", headers=H)
        assert r.status_code == 200, r.text
        b = [x for x in r.json() if x["id"] == pytest.bill_id_snapshot][0]
        assert b["vendor_details"] == "MM Traders \u2014 Solapur"


# --------------------------- 3. Legacy fallback: null snapshot resolves to current vendor.details ---------------------------

class TestVendorBillLegacyFallback:
    """When vendor.details is None at bill create time, snapshot is None.
    Later, if we set vendor.details, GET should fall back to current value."""

    def test_create_bill_with_null_details_vendor(self, base_url, shop):
        H = shop["headers"]
        body = {
            "vendor_id": pytest.vendor_no_details_id,
            "date": _today(),
            "margin_per_bag": 30,
            "commission_per_bag": 10,
            "hamali": 0,
            "cess": 0,
            "lines": [{"lot_no": "2/3", "farmer_name": "Somanna",
                       "bags": 3, "auction_rate": 900}],
        }
        r = requests.post(f"{base_url}/api/vendor-bills", json=body, headers=H)
        assert r.status_code == 201, r.text
        b = r.json()
        # Snapshot should be None because vendor.details was None
        assert b["vendor_details"] is None
        pytest.legacy_bill_id = b["id"]

    def test_get_bill_falls_back_when_snapshot_null(self, base_url, shop):
        """Now set vendor.details; GET should return the CURRENT value via fallback."""
        H = shop["headers"]
        r = requests.put(
            f"{base_url}/api/vendors/{pytest.vendor_no_details_id}",
            json={"name": "TEST Vendor No Details",
                  "details": "Late Added Details"},
            headers=H,
        )
        assert r.status_code == 200, r.text
        # GET bill: snapshot is null in DB → fallback returns current details
        r = requests.get(f"{base_url}/api/vendor-bills/{pytest.legacy_bill_id}", headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["vendor_details"] == "Late Added Details", \
            "Legacy bills (null snapshot) must fall back to current vendor.details"


# --------------------------- 4. Dashboard ?date=YYYY-MM-DD ---------------------------

class TestDashboardDateFilter:
    def test_dashboard_past_date_returns_zeros(self, base_url, shop):
        """Fresh shop: dashboard for year 2000 should return all zeros for date-scoped counters."""
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/dashboard",
                         params={"date": "2000-01-01"}, headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["today_pattis"] == 0
        assert d["today_bags"] == 0
        assert d["today_lots"] == 0
        assert d["today_gross"] == 0
        assert d["today_farmer_payout"] == 0
        assert d["today_pending"] == 0
        # But global counters remain global
        assert d["total_farmers"] >= 1
        assert d["total_vendors"] >= 2

    def test_dashboard_today_reflects_created_lot(self, base_url, shop, seed):
        """Create a lot for today, then dashboard?date=today should count 1 lot, 1 patti."""
        H = shop["headers"]
        r = requests.post(
            f"{base_url}/api/lots",
            json={
                "auction_day_id": seed["day"]["id"],
                "lot_serial_no": 1, "total_bags": 4,
                "farmer_id": seed["farmer"]["id"],
                "sales": [{"vendor_id": pytest.vendor_with_details_id,
                           "bags": 4, "rate_per_bag": 1000}],
            }, headers=H,
        )
        assert r.status_code in (200, 201), r.text
        pytest.batch_b_lot_id = r.json()["id"]

        r = requests.get(f"{base_url}/api/dashboard",
                         params={"date": _today()}, headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["today_lots"] == 1
        assert d["today_pattis"] == 1
        assert d["today_bags"] == 4
        assert d["today_gross"] == 4000.0

    def test_dashboard_no_date_defaults_to_today(self, base_url, shop):
        H = shop["headers"]
        r_today = requests.get(f"{base_url}/api/dashboard",
                               params={"date": _today()}, headers=H).json()
        r_default = requests.get(f"{base_url}/api/dashboard", headers=H).json()
        assert r_today == r_default, \
            "Dashboard without ?date must default to today's date"

    def test_dashboard_past_date_still_zero_after_lot_created(self, base_url, shop):
        """Even after today's lot exists, past date must return 0 for today_lots/pattis."""
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/dashboard",
                         params={"date": "2000-01-01"}, headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["today_lots"] == 0
        assert d["today_pattis"] == 0
        assert d["today_bags"] == 0

    def test_dashboard_future_date_returns_zeros(self, base_url, shop):
        H = shop["headers"]
        future = (dt.date.today() + dt.timedelta(days=30)).isoformat()
        r = requests.get(f"{base_url}/api/dashboard",
                         params={"date": future}, headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["today_pattis"] == 0
        assert d["today_lots"] == 0


# --------------------------- 5. Regression: 1-Patti-per-Lot ---------------------------

class TestOnePattiPerLotRegression:
    def test_two_lots_same_farmer_create_two_pattis(self, base_url, shop, seed):
        H = shop["headers"]
        # First lot already created (serial=1). Add a second for same farmer.
        r = requests.post(
            f"{base_url}/api/lots",
            json={
                "auction_day_id": seed["day"]["id"],
                "lot_serial_no": 2, "total_bags": 3,
                "farmer_id": seed["farmer"]["id"],
                "sales": [{"vendor_id": pytest.vendor_no_details_id,
                           "bags": 3, "rate_per_bag": 800}],
            }, headers=H,
        )
        assert r.status_code in (200, 201), r.text
        lot2 = r.json()
        # Response contains patti_id + patti_no
        assert lot2.get("patti_id"), "LotOut should include patti_id"
        assert lot2.get("patti_no"), "LotOut should include patti_no"

        # List pattis for today: expect >=2 for this shop, each with exactly 1 lot
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": _today()}, headers=H)
        assert r.status_code == 200, r.text
        pattis = r.json()
        assert len(pattis) >= 2, f"Expected >=2 pattis, got {len(pattis)}"
        for p in pattis:
            assert len(p["lots"]) == 1, f"Each patti must have exactly 1 lot, got {len(p['lots'])}"
            assert p["lot_id"], "Each patti must have non-null lot_id"

        # Assert distinct patti_nos and distinct lot_ids
        patti_nos = [p["patti_no"] for p in pattis]
        lot_ids = [p["lot_id"] for p in pattis]
        assert len(set(patti_nos)) == len(patti_nos), "patti_no must be unique per patti"
        assert len(set(lot_ids)) == len(lot_ids), "lot_id must be unique per patti"

    def test_delete_lot_cascade_deletes_patti(self, base_url, shop):
        H = shop["headers"]
        # Get the patti_id linked to batch_b_lot_id (serial=1)
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": _today()}, headers=H)
        target = [p for p in r.json() if p["lot_id"] == pytest.batch_b_lot_id]
        assert len(target) == 1
        patti_id = target[0]["id"]

        r = requests.delete(f"{base_url}/api/lots/{pytest.batch_b_lot_id}", headers=H)
        assert r.status_code == 204, r.text
        # Now the Patti should also be gone
        r = requests.get(f"{base_url}/api/pattis/{patti_id}", headers=H)
        assert r.status_code == 404, \
            f"Patti should cascade-delete with its lot; got {r.status_code}"
