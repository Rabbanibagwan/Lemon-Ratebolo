"""Iteration 13 — GET /api/pattis?date=YYYY-MM-DD filter tests.

Verifies:
1. GET /api/pattis?date=YYYY-MM-DD returns ONLY pattis whose date matches exactly.
2. GET /api/pattis (no date) returns ALL pattis for shop.
3. GET /api/pattis?date=<past date> returns [] with HTTP 200.
4. Response schema unchanged: each patti has patti_no, patti_id, lot_id, lots[].lot_no.
5. Regression: /api/dashboard?date=... still works. /api/vendors CRUD with details still works.
   1-Patti-per-Lot rule: 2 lots for same farmer → 2 distinct pattis.
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
    """Fresh, isolated shop for iteration 13 tests."""
    username = f"iter13_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{base_url}/api/auth/signup",
        json={"shop_name": "TEST Iter13", "username": username, "password": "passI13x"},
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
    # Farmer
    r = requests.post(f"{base_url}/api/farmers",
                      json={"name": "TEST Farmer13"}, headers=H)
    assert r.status_code in (200, 201), r.text
    farmer = r.json()

    # Vendors
    r = requests.post(f"{base_url}/api/vendors",
                      json={"name": "TEST Vendor A13",
                            "details": "AA Traders \u2014 Indi"},
                      headers=H)
    assert r.status_code == 201, r.text
    v_a = r.json()

    r = requests.post(f"{base_url}/api/vendors",
                      json={"name": "TEST Vendor B13"}, headers=H)
    assert r.status_code == 201, r.text
    v_b = r.json()

    # Auction day (today)
    r = requests.get(f"{base_url}/api/auction-days/today", headers=H)
    assert r.status_code == 200, r.text
    day = r.json()

    # Driver
    r = requests.put(
        f"{base_url}/api/auction-days/{day['id']}",
        json={"date": _today(),
              "drivers": [{"name": "VITTAL", "place": "DGR",
                           "bhada_per_bag": 50,
                           "range_from": 1, "range_to": 500}]},
        headers=H,
    )
    assert r.status_code == 200, r.text

    # Two lots (same farmer) → creates 2 pattis today
    r = requests.post(
        f"{base_url}/api/lots",
        json={"auction_day_id": day["id"],
              "lot_serial_no": 1, "total_bags": 5,
              "farmer_id": farmer["id"],
              "sales": [{"vendor_id": v_a["id"],
                         "bags": 5, "rate_per_bag": 1000}]},
        headers=H,
    )
    assert r.status_code in (200, 201), r.text
    lot1 = r.json()

    r = requests.post(
        f"{base_url}/api/lots",
        json={"auction_day_id": day["id"],
              "lot_serial_no": 2, "total_bags": 3,
              "farmer_id": farmer["id"],
              "sales": [{"vendor_id": v_b["id"],
                         "bags": 3, "rate_per_bag": 800}]},
        headers=H,
    )
    assert r.status_code in (200, 201), r.text
    lot2 = r.json()

    return {"farmer": farmer, "day": day,
            "v_a": v_a, "v_b": v_b,
            "lot1": lot1, "lot2": lot2}


# --------------------------- 1. Date filter core ---------------------------

class TestPattisDateFilter:
    def test_get_pattis_today_returns_only_today(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": _today()}, headers=H)
        assert r.status_code == 200, r.text
        pattis = r.json()
        assert len(pattis) >= 2, f"Expected >=2 pattis for today, got {len(pattis)}"
        for p in pattis:
            assert p["date"] == _today(), \
                f"Patti {p.get('id')} has date {p['date']!r}, expected {_today()!r}"

    def test_get_pattis_no_date_returns_all(self, base_url, shop, seed):
        """No date param: returns ALL pattis for shop (default behaviour unchanged)."""
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/pattis", headers=H)
        assert r.status_code == 200, r.text
        all_pattis = r.json()
        # Fresh shop has only today's pattis (2), so both counts match.
        r_today = requests.get(f"{base_url}/api/pattis",
                               params={"date": _today()}, headers=H).json()
        assert len(all_pattis) >= len(r_today)
        assert len(all_pattis) >= 2

    def test_get_pattis_past_date_returns_empty(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": "2000-01-01"}, headers=H)
        assert r.status_code == 200, r.text
        assert r.json() == [], "Past date must return empty list"

    def test_get_pattis_future_date_returns_empty(self, base_url, shop, seed):
        H = shop["headers"]
        future = (dt.date.today() + dt.timedelta(days=30)).isoformat()
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": future}, headers=H)
        assert r.status_code == 200, r.text
        assert r.json() == [], "Future date must return empty list"

    def test_get_pattis_exact_string_match_only(self, base_url, shop, seed):
        """Ensure filter is exact-match, not substring/prefix. Now returns 422 for
        non-YYYY-MM-DD strings (iteration 14 strict validation)."""
        H = shop["headers"]
        today = _today()
        # e.g. today = "2026-01-15" → partial prefix "2026-01" should NOT match
        prefix = today[:7]
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": prefix}, headers=H)
        # Iteration 14: prefix "YYYY-MM" is no longer valid YYYY-MM-DD → 422.
        assert r.status_code == 422, r.text
        detail = r.json().get("detail", "")
        assert "Invalid date format" in detail, detail

    # --- Iteration 14: strict YYYY-MM-DD validation + default limit 500 ---
    def test_bad_date_returns_422(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": "BAD-DATE"}, headers=H)
        assert r.status_code == 422, r.text
        assert r.json()["detail"] == "Invalid date format. Expected YYYY-MM-DD."

    def test_various_bad_date_shapes_return_422(self, base_url, shop, seed):
        H = shop["headers"]
        # These are all shape-level invalid — server uses regex \d{4}-\d{2}-\d{2}.
        # Note: semantically-invalid dates like '2026-13-01' or '2026-02-30' still
        # pass the shape check → returns 200 [] (documented behaviour).
        for bad in ("nonsense", "2026/08/06", "6-8-2026", "2026-8-6",
                    "202-01-01", "2026-01-1", "abcd-ef-gh", "2026-01",
                    "2026-01-01T00:00:00", " 2026-01-01"):
            r = requests.get(f"{base_url}/api/pattis",
                             params={"date": bad}, headers=H)
            assert r.status_code == 422, f"{bad!r} → {r.status_code} {r.text}"
            assert r.json()["detail"] == \
                "Invalid date format. Expected YYYY-MM-DD."

    def test_empty_date_treated_as_absent(self, base_url, shop, seed):
        """?date= (empty string) must behave like the param is absent → all pattis."""
        H = shop["headers"]
        r_empty = requests.get(f"{base_url}/api/pattis?date=", headers=H)
        assert r_empty.status_code == 200, r_empty.text
        r_none = requests.get(f"{base_url}/api/pattis", headers=H)
        assert r_none.status_code == 200
        # Same shop, same moment → same set of pattis.
        assert {p["id"] for p in r_empty.json()} == \
               {p["id"] for p in r_none.json()}
        assert len(r_empty.json()) >= 2

    def test_specific_date_still_filters(self, base_url, shop, seed):
        """Iteration 14 regression: ?date=YYYY-MM-DD still returns only that date."""
        H = shop["headers"]
        today = _today()
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": today}, headers=H)
        assert r.status_code == 200, r.text
        pattis = r.json()
        assert len(pattis) >= 2
        for p in pattis:
            assert p["date"] == today

        # Explicitly test the exact date from the request payload example.
        r2 = requests.get(f"{base_url}/api/pattis",
                          params={"date": "2026-08-06"}, headers=H)
        assert r2.status_code == 200, r2.text
        # This shop only has today's pattis → 2026-08-06 must be empty
        # (unless today happens to be 2026-08-06).
        if today != "2026-08-06":
            assert r2.json() == []
        else:
            for p in r2.json():
                assert p["date"] == "2026-08-06"

    def test_default_limit_is_500(self, base_url, shop, seed):
        """No limit specified → server accepts up to 500. Explicit limit=500 also works."""
        H = shop["headers"]
        r_default = requests.get(f"{base_url}/api/pattis", headers=H)
        assert r_default.status_code == 200
        r_500 = requests.get(f"{base_url}/api/pattis",
                             params={"limit": 500}, headers=H)
        assert r_500.status_code == 200
        # With only 2 pattis seeded, both must return the same set.
        assert {p["id"] for p in r_default.json()} == \
               {p["id"] for p in r_500.json()}

    def test_response_schema_unchanged(self, base_url, shop, seed):
        """Every patti must include patti_no, id (patti_id), lot_id, lots[].lot_no, etc."""
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": _today()}, headers=H)
        assert r.status_code == 200, r.text
        pattis = r.json()
        assert pattis, "Need at least one patti to verify schema"
        for p in pattis:
            # Top-level required fields
            for key in ("id", "patti_no", "qr_token", "date", "auction_day_id",
                        "lot_id", "farmer_id", "farmer_name",
                        "lots", "total_bags", "gross_total", "farmer_gross",
                        "hamali_per_bag", "stationery_flat", "payment_factor",
                        "hamali_total", "stationery_total", "bhada_total",
                        "deductions_total", "net_payable",
                        "receiver_name", "status", "created_at"):
                assert key in p, f"Missing key {key!r} in patti response"
            assert isinstance(p["patti_no"], int)
            assert p["lot_id"], "lot_id must be non-null (1-Patti-per-Lot)"
            assert isinstance(p["lots"], list) and len(p["lots"]) == 1
            lot = p["lots"][0]
            for lkey in ("lot_serial_no", "total_bags", "lot_no",
                         "bhada_per_bag", "bhada_total",
                         "sales", "sold_bags", "gross", "farmer_amount"):
                assert lkey in lot, f"Missing key {lkey!r} in patti.lots[]"
            assert "/" in lot["lot_no"], f"lot_no should be 'N/M' style, got {lot['lot_no']!r}"


# --------------------------- 2. Regression: 1-Patti-per-Lot ---------------------------

class TestOnePattiPerLotRegression:
    def test_two_lots_same_farmer_two_distinct_pattis(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/pattis",
                         params={"date": _today()}, headers=H)
        pattis = r.json()
        # Filter to this seed's two lots
        seed_lot_ids = {seed["lot1"]["id"], seed["lot2"]["id"]}
        my_pattis = [p for p in pattis if p["lot_id"] in seed_lot_ids]
        assert len(my_pattis) == 2, \
            f"Two lots for same farmer must produce 2 pattis, got {len(my_pattis)}"
        patti_nos = [p["patti_no"] for p in my_pattis]
        lot_ids = [p["lot_id"] for p in my_pattis]
        assert len(set(patti_nos)) == 2, "patti_no must be unique per patti"
        assert len(set(lot_ids)) == 2, "lot_id must be unique per patti"


# --------------------------- 3. Regression: /api/dashboard?date=... ---------------------------

class TestDashboardDateRegression:
    def test_dashboard_today_reflects_seed(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/dashboard",
                         params={"date": _today()}, headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["today_lots"] == 2
        assert d["today_pattis"] == 2
        assert d["today_bags"] == 8  # 5 + 3
        assert d["today_gross"] == 5000.0 + 2400.0  # 5*1000 + 3*800

    def test_dashboard_past_date_zeros(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.get(f"{base_url}/api/dashboard",
                         params={"date": "2000-01-01"}, headers=H)
        assert r.status_code == 200
        d = r.json()
        assert d["today_pattis"] == 0
        assert d["today_lots"] == 0
        assert d["today_bags"] == 0

    def test_dashboard_no_date_defaults_to_today(self, base_url, shop, seed):
        H = shop["headers"]
        r_today = requests.get(f"{base_url}/api/dashboard",
                               params={"date": _today()}, headers=H).json()
        r_default = requests.get(f"{base_url}/api/dashboard", headers=H).json()
        assert r_today == r_default


# --------------------------- 4. Regression: /api/vendors CRUD with details ---------------------------

class TestVendorDetailsRegression:
    def test_create_read_update_vendor_details(self, base_url, shop):
        H = shop["headers"]
        # Create
        r = requests.post(f"{base_url}/api/vendors",
                          json={"name": "TEST Regress Vendor",
                                "details": "RR Traders \u2014 Indi",
                                "phone": "8888888888"},
                          headers=H)
        assert r.status_code == 201, r.text
        v = r.json()
        vid = v["id"]
        assert v["details"] == "RR Traders \u2014 Indi"

        # Read
        r = requests.get(f"{base_url}/api/vendors", headers=H)
        assert r.status_code == 200
        found = [x for x in r.json() if x["id"] == vid][0]
        assert found["details"] == "RR Traders \u2014 Indi"

        # Update
        r = requests.put(f"{base_url}/api/vendors/{vid}",
                         json={"name": "TEST Regress Vendor",
                               "details": "RR Traders \u2014 Solapur",
                               "phone": "8888888888"},
                         headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["details"] == "RR Traders \u2014 Solapur"

        # Delete
        r = requests.delete(f"{base_url}/api/vendors/{vid}", headers=H)
        assert r.status_code == 204
