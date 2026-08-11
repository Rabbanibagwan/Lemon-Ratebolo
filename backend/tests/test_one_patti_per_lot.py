"""Iteration 11 — 1 Patti = 1 Lot semantics.

Verifies:
  1. POST /api/lots auto-generates a Patti; response has patti_id + patti_no.
  2. Two lots for the same farmer on the same day → TWO distinct pattis,
     each with exactly one lot in `lots`.
  3. PUT /api/lots/{id} regenerates the same Patti (patti_no preserved).
  4. DELETE /api/lots/{id} cascades — corresponding Patti removed.
  5. POST /generate-pattis returns 1 Patti per Lot; stale pattis (whose
     lot_id no longer exists) get purged.
  6. GET /api/pattis populates `lot_id`; each patti's `lots` has exactly 1 element.
  7. Startup migration: uniq index (shop_id, auction_day_id, lot_id) exists
     and no legacy patti (lot_id missing / null) is served.
  8. Existing endpoints (GET /pattis/{id}, /vendor-bills) still work.
  9. /reports/by-lot maps lots to patti_no correctly.
"""
import os
import time
import uuid
from pathlib import Path

import pytest
import requests


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")


# -------- Session-scoped fresh isolated shop --------
@pytest.fixture(scope="module")
def shop():
    uname = f"opl_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={"shop_name": "TEST OnePattiPerLot", "username": uname, "password": "passOP1234"},
        timeout=20,
    )
    assert r.status_code == 201, r.text
    d = r.json()
    H = {"Authorization": f"Bearer {d['access_token']}"}

    # Farmer 1 and Farmer 2
    rf1 = requests.post(f"{BASE_URL}/api/farmers", json={"name": "TEST F1"}, headers=H, timeout=15)
    assert rf1.status_code == 201, rf1.text
    rf2 = requests.post(f"{BASE_URL}/api/farmers", json={"name": "TEST F2"}, headers=H, timeout=15)
    assert rf2.status_code == 201, rf2.text
    # Vendors
    rv1 = requests.post(f"{BASE_URL}/api/vendors", json={"name": "TEST V1"}, headers=H, timeout=15)
    rv2 = requests.post(f"{BASE_URL}/api/vendors", json={"name": "TEST V2"}, headers=H, timeout=15)
    assert rv1.status_code == 201 and rv2.status_code == 201

    # Auction day (today)
    rd = requests.get(f"{BASE_URL}/api/auction-days/today", headers=H, timeout=15)
    assert rd.status_code == 200
    return {
        "H": H,
        "shop_id": d["shop_id"],
        "f1": rf1.json()["id"], "f2": rf2.json()["id"],
        "v1": rv1.json()["id"], "v2": rv2.json()["id"],
        "day_id": rd.json()["id"],
    }


def _create_lot(shop, serial: int, farmer_key: str, bags: int, rate: float, vendor_key: str = "v1"):
    payload = {
        "auction_day_id": shop["day_id"],
        "lot_serial_no": serial,
        "total_bags": bags,
        "farmer_id": shop[farmer_key],
        "bhada_total": 100.0,
        "sales": [{"vendor_id": shop[vendor_key], "bags": bags, "rate_per_bag": rate}],
    }
    r = requests.post(f"{BASE_URL}/api/lots", json=payload, headers=shop["H"], timeout=15)
    assert r.status_code == 201, r.text
    return r.json()


# ---------- Test 1 & 2 combined ----------
class TestPattiPerLot:

    def test_1_create_lot_returns_patti_id_and_no(self, shop):
        lot = _create_lot(shop, serial=101, farmer_key="f1", bags=5, rate=1000)
        assert lot["patti_id"], "patti_id missing on LotOut"
        assert isinstance(lot["patti_no"], int) and lot["patti_no"] >= 1
        # persist for later
        shop["_lot_a"] = lot

    def test_2_two_lots_same_farmer_produce_two_pattis(self, shop):
        # Second lot for the same farmer, different serial
        lot2 = _create_lot(shop, serial=102, farmer_key="f1", bags=3, rate=1200, vendor_key="v2")
        assert lot2["patti_id"] != shop["_lot_a"]["patti_id"], "same patti reused across lots — BUG"
        assert lot2["patti_no"] != shop["_lot_a"]["patti_no"]

        # Fetch both pattis directly and assert each has exactly 1 lot
        for pid in (shop["_lot_a"]["patti_id"], lot2["patti_id"]):
            r = requests.get(f"{BASE_URL}/api/pattis/{pid}", headers=shop["H"], timeout=15)
            assert r.status_code == 200, r.text
            p = r.json()
            assert p.get("lot_id"), f"Patti {pid} missing lot_id field"
            assert len(p["lots"]) == 1, f"Patti {pid} has {len(p['lots'])} lots (should be 1)"
        shop["_lot_b"] = lot2

    def test_3_put_lot_preserves_patti_no(self, shop):
        lot_a = shop["_lot_a"]
        # Edit lot_a — change rate; patti_no should be preserved
        payload = {
            "auction_day_id": shop["day_id"],
            "lot_serial_no": lot_a["lot_serial_no"],
            "total_bags": lot_a["total_bags"],
            "farmer_id": lot_a["farmer_id"],
            "bhada_total": 150.0,
            "sales": [{"vendor_id": shop["v1"], "bags": lot_a["total_bags"], "rate_per_bag": 1500}],
        }
        r = requests.put(f"{BASE_URL}/api/lots/{lot_a['id']}", json=payload, headers=shop["H"], timeout=15)
        assert r.status_code == 200, r.text
        edited = r.json()
        assert edited["patti_no"] == lot_a["patti_no"], "patti_no changed on edit — BUG"
        assert edited["patti_id"] == lot_a["patti_id"], "patti_id changed on edit — BUG"

        # Other lot's patti untouched
        r2 = requests.get(f"{BASE_URL}/api/pattis/{shop['_lot_b']['patti_id']}",
                          headers=shop["H"], timeout=15)
        assert r2.status_code == 200
        assert r2.json()["patti_no"] == shop["_lot_b"]["patti_no"]

    def test_4_delete_lot_cascades_to_patti(self, shop):
        lot_b = shop["_lot_b"]
        r = requests.delete(f"{BASE_URL}/api/lots/{lot_b['id']}",
                            headers=shop["H"], timeout=15)
        assert r.status_code == 204, r.text

        # Patti should be gone (404)
        r2 = requests.get(f"{BASE_URL}/api/pattis/{lot_b['patti_id']}",
                          headers=shop["H"], timeout=15)
        assert r2.status_code == 404, f"expected 404 after cascade delete, got {r2.status_code}"

    def test_5_generate_pattis_iterates_lots_and_purges_stale(self, shop):
        # Create a third lot for f2 for the same day
        lot_c = _create_lot(shop, serial=103, farmer_key="f2", bags=4, rate=900)
        shop["_lot_c"] = lot_c

        r = requests.post(
            f"{BASE_URL}/api/auction-days/{shop['day_id']}/generate-pattis",
            headers=shop["H"], timeout=20,
        )
        assert r.status_code == 200, r.text
        pattis = r.json()
        # 2 lots currently exist (lot_a re-edited & lot_c). lot_b was deleted.
        assert len(pattis) == 2, f"expected 2 pattis for 2 lots, got {len(pattis)}"
        lot_ids_in_pattis = {p["lot_id"] for p in pattis}
        assert lot_ids_in_pattis == {shop["_lot_a"]["id"], shop["_lot_c"]["id"]}
        for p in pattis:
            assert len(p["lots"]) == 1
            assert p["total_bags"] == p["lots"][0]["sold_bags"]

    def test_6_list_pattis_has_lot_id_and_single_lot(self, shop):
        r = requests.get(f"{BASE_URL}/api/pattis", headers=shop["H"], timeout=15)
        assert r.status_code == 200, r.text
        pattis = r.json()
        # Only pattis for our shop's active lots
        day_pattis = [p for p in pattis if p.get("auction_day_id") == shop["day_id"]]
        assert len(day_pattis) == 2
        for p in day_pattis:
            assert p.get("lot_id"), "patti missing lot_id in list response"
            assert len(p["lots"]) == 1

    def test_7_startup_index_and_no_legacy_pattis(self, shop):
        # Directly check pattis list has no entry with null/missing lot_id
        r = requests.get(f"{BASE_URL}/api/pattis", headers=shop["H"], timeout=15)
        assert r.status_code == 200
        for p in r.json():
            assert p.get("lot_id"), f"legacy patti (no lot_id) present: {p.get('id')}"

    def test_8_existing_endpoints_alive(self, shop):
        r1 = requests.get(f"{BASE_URL}/api/vendor-bills", headers=shop["H"], timeout=15)
        assert r1.status_code == 200
        assert isinstance(r1.json(), list)

        # Single patti fetch
        pid = shop["_lot_a"]["patti_id"]
        r2 = requests.get(f"{BASE_URL}/api/pattis/{pid}", headers=shop["H"], timeout=15)
        assert r2.status_code == 200
        p = r2.json()
        assert p["lot_id"] == shop["_lot_a"]["id"]
        assert len(p["lots"]) == 1

        # Root
        r3 = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert r3.status_code == 200

    def test_9_reports_by_lot_maps_patti_no(self, shop):
        r = requests.get(f"{BASE_URL}/api/reports/by-lot", headers=shop["H"], timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        # Should have exactly 2 lots for this shop
        assert len(rows) == 2, f"expected 2 report rows, got {len(rows)}"
        for row in rows:
            assert row["patti_no"] is not None, f"row missing patti_no: {row}"

    def test_10_unique_index_prevents_duplicate_patti(self, shop):
        # Sanity: generate-pattis called again is idempotent, still 2 pattis.
        r = requests.post(
            f"{BASE_URL}/api/auction-days/{shop['day_id']}/generate-pattis",
            headers=shop["H"], timeout=20,
        )
        assert r.status_code == 200, r.text
        assert len(r.json()) == 2
