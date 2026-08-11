# Iter 16 — Auction Book rework: verifies backend regression for auto-patti-on-lot
# and GET /api/pattis?date=<today> (the new Auction Book data source).

import os
import uuid
from datetime import date

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    from pathlib import Path
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")


def _today_iso() -> str:
    return date.today().isoformat()


@pytest.fixture(scope="module")
def shop():
    """Create an isolated shop for this iteration."""
    uname = f"iter16_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={"shop_name": "TEST Iter16 Shop", "username": uname, "password": "passI16x"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    return {"h": {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, "uname": uname}


@pytest.fixture(scope="module")
def farmer(shop):
    r = requests.post(
        f"{BASE_URL}/api/farmers",
        headers=shop["h"],
        json={"name": "TEST Farmer16", "village": "TVillage"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture(scope="module")
def vendor(shop):
    r = requests.post(
        f"{BASE_URL}/api/vendors",
        headers=shop["h"],
        json={"name": "TEST Vendor16", "place": "TPlace"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture(scope="module")
def auction_day(shop):
    r = requests.get(f"{BASE_URL}/api/auction-days/today", headers=shop["h"], timeout=30)
    assert r.status_code == 200, r.text
    day = r.json()
    # Set up 1 driver covering serials 1..500 so lots auto-fill driver+bhada
    upd = requests.put(
        f"{BASE_URL}/api/auction-days/{day['id']}",
        headers=shop["h"],
        json={
            "date": day["date"],
            "drivers": [{"range_from": 1, "range_to": 500, "name": "VITTAL", "place": "Indi", "bhada_per_bag": 50}],
        },
        timeout=30,
    )
    assert upd.status_code == 200, upd.text
    return upd.json()


class TestAuctionBookBackendRegression:
    """Backend regression for Auction Book UX rework."""

    def test_post_lots_auto_generates_patti(self, shop, farmer, vendor, auction_day):
        """POST /api/lots should auto-generate a Patti (Batch A rule)."""
        lot_payload = {
            "auction_day_id": auction_day["id"],
            "lot_serial_no": 42,
            "total_bags": 5,
            "farmer_id": farmer["id"],
            "sales": [
                {"vendor_id": vendor["id"], "bags": 5, "rate_per_bag": 1000}
            ],
        }
        r = requests.post(f"{BASE_URL}/api/lots", headers=shop["h"], json=lot_payload, timeout=30)
        assert r.status_code == 201, r.text
        lot = r.json()
        # Auto-generated patti must be linked
        assert lot.get("patti_id"), "Lot missing patti_id — auto-patti-on-lot broken"
        assert lot.get("patti_no"), "Lot missing patti_no — auto-patti-on-lot broken"

        # Confirm the patti exists and matches farmer
        p = requests.get(f"{BASE_URL}/api/pattis/{lot['patti_id']}", headers=shop["h"], timeout=30)
        assert p.status_code == 200, p.text
        patti = p.json()
        assert patti["farmer_id"] == farmer["id"]
        assert patti["patti_no"] == lot["patti_no"]

    def test_get_pattis_today_returns_new_patti(self, shop, farmer):
        """GET /api/pattis?date=<today> — the Auction Book data source."""
        r = requests.get(f"{BASE_URL}/api/pattis?date={_today_iso()}", headers=shop["h"], timeout=30)
        assert r.status_code == 200, r.text
        pattis = r.json()
        assert isinstance(pattis, list) and len(pattis) >= 1
        # Ensure our new patti (from previous test) is in the list
        assert any(p["farmer_id"] == farmer["id"] for p in pattis), "Newly created patti not in today's list"
        # Response schema smoke check
        p0 = pattis[0]
        for k in ("id", "patti_no", "farmer_id", "farmer_name", "total_bags", "net_payable", "lots", "status"):
            assert k in p0, f"Missing field '{k}' in patti response"

    def test_get_pattis_today_is_isolated_by_shop(self, shop):
        """Sanity: shop scoping is enforced — anonymous request should 401."""
        r = requests.get(f"{BASE_URL}/api/pattis?date={_today_iso()}", timeout=30)
        assert r.status_code in (401, 403), f"Expected auth failure, got {r.status_code}: {r.text}"

    def test_get_pattis_bad_date_returns_422(self, shop):
        r = requests.get(f"{BASE_URL}/api/pattis?date=NOT-A-DATE", headers=shop["h"], timeout=30)
        assert r.status_code == 422, r.text

    def test_second_lot_same_farmer_creates_new_patti(self, shop, farmer, vendor, auction_day):
        """One-patti-per-lot rule (iter 10-14): 2nd lot for same farmer = new patti."""
        payload = {
            "auction_day_id": auction_day["id"],
            "lot_serial_no": 43,
            "total_bags": 3,
            "farmer_id": farmer["id"],
            "sales": [
                {"vendor_id": vendor["id"], "bags": 3, "rate_per_bag": 900}
            ],
        }
        r = requests.post(f"{BASE_URL}/api/lots", headers=shop["h"], json=payload, timeout=30)
        assert r.status_code == 201, r.text
        lot2 = r.json()
        assert lot2.get("patti_id"), "Second lot missing patti_id"

        r2 = requests.get(f"{BASE_URL}/api/pattis?date={_today_iso()}", headers=shop["h"], timeout=30)
        assert r2.status_code == 200
        pattis_for_farmer = [p for p in r2.json() if p["farmer_id"] == farmer["id"]]
        # Business rule: 1 patti per lot (per iter 10-14 tests). So farmer has >=2 pattis today.
        assert len(pattis_for_farmer) >= 2, f"Expected >=2 pattis for farmer, got {len(pattis_for_farmer)}"
        # Confirm lot2's patti exists in the list
        assert any(p["id"] == lot2["patti_id"] for p in pattis_for_farmer)
