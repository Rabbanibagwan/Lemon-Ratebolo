"""Iteration 17 — Print Patti Range (frontend-only feature).
Confirm backend endpoints touched by the two screens still behave.

Endpoints:
  - GET  /api/pattis?date=YYYY-MM-DD    (Patti Details + Auction Book both call this)
  - POST /api/lots                       (auto-patti generation)
  - GET  /api/dashboard?date=YYYY-MM-DD  (dashboard stats)
  - GET  /api/auction-days/today         (Auction Book header)
"""
import datetime as dt
import pytest
import requests


# Helpers ----------------------------------------------------------------
def _today() -> str:
    return dt.date.today().isoformat()


def _create_farmer(base_url, headers, name="Iter17 Farmer"):
    r = requests.post(
        f"{base_url}/api/farmers",
        json={"name": name, "village": "V", "phone": "9999999999"},
        headers=headers,
        timeout=30,
    )
    assert r.status_code in (200, 201), f"farmer create failed: {r.status_code} {r.text}"
    return r.json()


def _create_vendor(base_url, headers, name="Iter17 Vendor"):
    r = requests.post(
        f"{base_url}/api/vendors",
        json={"name": name, "shop_name": name, "phone": "8888888888"},
        headers=headers,
        timeout=30,
    )
    assert r.status_code in (200, 201), f"vendor create failed: {r.status_code} {r.text}"
    return r.json()


def _today_auction_day_id(base_url, headers):
    r = requests.get(f"{base_url}/api/auction-days/today", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_lot(base_url, headers, farmer_id, vendor_id, lot_serial_no, bags=3, rate=750):
    payload = {
        "auction_day_id": _today_auction_day_id(base_url, headers),
        "farmer_id": farmer_id,
        "lot_serial_no": lot_serial_no,
        "total_bags": bags,
        "bag_weights_kg": [40.0] * bags,
        "sales": [{"vendor_id": vendor_id, "bags": bags, "rate_per_bag": rate}],
    }
    r = requests.post(
        f"{base_url}/api/lots",
        json=payload,
        headers=headers,
        timeout=30,
    )
    assert r.status_code in (200, 201), f"lot create failed: {r.status_code} {r.text}"
    return r.json()


# Tests ------------------------------------------------------------------
class TestPattiDateFilter:
    """GET /api/pattis?date=... (used by BOTH history and auction screens)"""

    def test_pattis_date_returns_list_for_today(self, base_url, shop_a):
        r = requests.get(
            f"{base_url}/api/pattis?date={_today()}",
            headers=shop_a["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_pattis_without_date_returns_all(self, base_url, shop_a):
        r = requests.get(f"{base_url}/api/pattis", headers=shop_a["headers"], timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_pattis_bad_date_returns_422(self, base_url, shop_a):
        r = requests.get(
            f"{base_url}/api/pattis?date=notadate",
            headers=shop_a["headers"],
            timeout=30,
        )
        assert r.status_code == 422

    def test_pattis_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/pattis?date={_today()}", timeout=30)
        assert r.status_code in (401, 403)


class TestAutoPattiGeneration:
    """POST /api/lots must still auto-create exactly 1 patti (Batch A rule)."""

    def test_lot_creates_one_patti(self, base_url, shop_a, unique):
        farmer = _create_farmer(base_url, shop_a["headers"], name=unique("TEST_F"))
        vendor = _create_vendor(base_url, shop_a["headers"], name=unique("TEST_V"))

        before = requests.get(
            f"{base_url}/api/pattis?date={_today()}",
            headers=shop_a["headers"],
            timeout=30,
        ).json()
        before_ids = {p["id"] for p in before}

        lot = _create_lot(
            base_url,
            shop_a["headers"],
            farmer["id"],
            vendor["id"],
            lot_serial_no=int(dt.datetime.now().strftime("%H%M%S")),  # unique-ish
        )
        assert "patti_id" in lot or "id" in lot  # payload shape check

        after = requests.get(
            f"{base_url}/api/pattis?date={_today()}",
            headers=shop_a["headers"],
            timeout=30,
        ).json()
        new_ids = [p for p in after if p["id"] not in before_ids]
        assert len(new_ids) == 1, f"expected 1 new patti, got {len(new_ids)}"
        assert new_ids[0]["farmer_id"] == farmer["id"]
        assert new_ids[0]["total_bags"] == 3


class TestDashboard:
    def test_dashboard_today(self, base_url, shop_a):
        r = requests.get(
            f"{base_url}/api/dashboard?date={_today()}",
            headers=shop_a["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # sanity-check dashboard shape (keys observed on server)
        assert "today_pattis" in data
        assert "today_bags" in data

    def test_dashboard_no_date_defaults_ok(self, base_url, shop_a):
        r = requests.get(
            f"{base_url}/api/dashboard",
            headers=shop_a["headers"],
            timeout=30,
        )
        assert r.status_code == 200


class TestAuctionDayToday:
    def test_auction_days_today(self, base_url, shop_a):
        r = requests.get(
            f"{base_url}/api/auction-days/today",
            headers=shop_a["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data and "date" in data
        assert data["date"] == _today()


class TestPattiShopScoping:
    """A shop must NOT see another shop's pattis."""

    def test_isolation(self, base_url, shop_a, shop_b, unique):
        farmer = _create_farmer(base_url, shop_a["headers"], name=unique("TEST_ISO_F"))
        vendor = _create_vendor(base_url, shop_a["headers"], name=unique("TEST_ISO_V"))
        _create_lot(
            base_url,
            shop_a["headers"],
            farmer["id"],
            vendor["id"],
            lot_serial_no=int(dt.datetime.now().strftime("%H%M%S")) + 1,
        )
        b_view = requests.get(
            f"{base_url}/api/pattis?date={_today()}",
            headers=shop_b["headers"],
            timeout=30,
        ).json()
        # None of shop_b's pattis should belong to shop_a's farmer
        assert all(p["farmer_id"] != farmer["id"] for p in b_view)
