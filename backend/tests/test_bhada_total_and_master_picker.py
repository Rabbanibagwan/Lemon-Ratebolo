"""Backend tests for Change 1 (bhada_total semantics) and Change 2 (OCR endpoint).

Covers:
  - POST /api/lots with bhada_total
  - POST /api/lots auto-fills from driver range when neither bhada_total nor bhada_per_bag
  - POST /api/lots backward-compat with legacy bhada_per_bag
  - Generate-pattis includes bhada_total per lot and aggregate
  - Edit-patti (PUT) with PattiEditLotIn.bhada_total
  - OCR /api/ocr/action-diary accepts image and returns 200 with bhada_total field
"""
import os
import io
import uuid
import time
from pathlib import Path

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

FIXTURE_IMG = Path("/app/backend/tests/fixtures/diary_sample.jpg")


# -------- helpers --------

def _signup():
    """Create fresh shop; return headers + shop_id."""
    username = f"TEST_bh_{uuid.uuid4().hex[:8]}"
    payload = {"shop_name": "TEST Bhada Shop", "username": username, "password": "passX1234"}
    r = requests.post(f"{BASE_URL}/api/auth/signup", json=payload, timeout=30)
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _make_farmer(headers, name="TEST_Farmer"):
    r = requests.post(f"{BASE_URL}/api/farmers", headers=headers,
                      json={"name": f"{name}_{uuid.uuid4().hex[:4]}"}, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _make_vendor(headers, name="TEST_Vendor"):
    r = requests.post(f"{BASE_URL}/api/vendors", headers=headers,
                      json={"name": f"{name}_{uuid.uuid4().hex[:4]}"}, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _get_today_day(headers):
    r = requests.get(f"{BASE_URL}/api/auction-days/today", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _set_drivers(headers, day_id, day_date, drivers):
    r = requests.put(f"{BASE_URL}/api/auction-days/{day_id}", headers=headers,
                     json={"date": day_date, "drivers": drivers}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# -------- fixtures --------

@pytest.fixture(scope="module")
def env():
    assert BASE_URL, "Backend URL not set"
    headers = _signup()
    day = _get_today_day(headers)
    farmer = _make_farmer(headers, "TEST_F_main")
    vendor = _make_vendor(headers, "TEST_V1")
    return {
        "headers": headers,
        "day": day,
        "farmer": farmer,
        "vendor": vendor,
    }


# ================== Bhada total semantics ==================

class TestBhadaTotalSemantics:
    def test_1_explicit_bhada_total(self, env):
        """POST /api/lots with explicit bhada_total → per_bag derived, driver not consulted."""
        # Set a driver that would auto-suggest a different amount (to prove it is NOT used).
        _set_drivers(env["headers"], env["day"]["id"], env["day"]["date"], [
            {"range_from": 800, "range_to": 900, "name": "DrvA", "place": "P1", "bhada_per_bag": 999}
        ])
        body = {
            "auction_day_id": env["day"]["id"],
            "lot_serial_no": 810,
            "total_bags": 5,
            "farmer_id": env["farmer"]["id"],
            "bhada_total": 250,
            "sales": [{"vendor_id": env["vendor"]["id"], "bags": 5, "rate_per_bag": 1000}],
        }
        r = requests.post(f"{BASE_URL}/api/lots", headers=env["headers"], json=body, timeout=15)
        assert r.status_code == 201, r.text
        j = r.json()
        assert j["bhada_total"] == 250, j
        assert j["bhada_per_bag"] == 50.0, j
        assert j["total_bags"] == 5
        assert j["gross_total"] == 5000

    def test_2_driver_autofill_no_bhada_input(self, env):
        """POST /api/lots without bhada_total & bhada_per_bag → driver.bhada_per_bag used."""
        _set_drivers(env["headers"], env["day"]["id"], env["day"]["date"], [
            {"range_from": 800, "range_to": 900, "name": "DrvA", "place": "P1", "bhada_per_bag": 40}
        ])
        body = {
            "auction_day_id": env["day"]["id"],
            "lot_serial_no": 811,
            "total_bags": 4,
            "farmer_id": env["farmer"]["id"],
            "sales": [{"vendor_id": env["vendor"]["id"], "bags": 4, "rate_per_bag": 100}],
        }
        r = requests.post(f"{BASE_URL}/api/lots", headers=env["headers"], json=body, timeout=15)
        assert r.status_code == 201, r.text
        j = r.json()
        assert j["bhada_per_bag"] == 40.0, j
        assert j["bhada_total"] == 160.0, j

    def test_3_legacy_bhada_per_bag(self, env):
        """POST /api/lots with legacy bhada_per_bag (no bhada_total) → total = per_bag × total_bags."""
        body = {
            "auction_day_id": env["day"]["id"],
            "lot_serial_no": 812,
            "total_bags": 4,
            "farmer_id": env["farmer"]["id"],
            "bhada_per_bag": 40,
            "sales": [{"vendor_id": env["vendor"]["id"], "bags": 4, "rate_per_bag": 100}],
        }
        r = requests.post(f"{BASE_URL}/api/lots", headers=env["headers"], json=body, timeout=15)
        assert r.status_code == 201, r.text
        j = r.json()
        assert j["bhada_per_bag"] == 40.0, j
        assert j["bhada_total"] == 160.0, j


# ================== Patti generation & edit ==================

class TestPattiBhadaTotal:
    def test_4_generate_pattis_includes_bhada_total(self, env):
        """POST /api/auction-days/{id}/generate-pattis returns lots[].bhada_total and top-level bhada_total sum."""
        r = requests.post(f"{BASE_URL}/api/auction-days/{env['day']['id']}/generate-pattis",
                          headers=env["headers"], timeout=30)
        assert r.status_code == 200, r.text
        pattis = r.json()
        assert isinstance(pattis, list) and len(pattis) >= 1
        # our farmer has 3 lots (810, 811, 812) → 250+160+160 = 570
        target = next((p for p in pattis if p["farmer_id"] == env["farmer"]["id"]), None)
        assert target is not None, "patti for our test farmer not found"
        lot_totals = [lot["bhada_total"] for lot in target["lots"]]
        for lt in lot_totals:
            assert lt is not None and lt > 0
        assert round(sum(lot_totals), 2) == round(target["bhada_total"], 2), target
        # Verify specific values present
        got = sorted(lot_totals)
        assert got == [160.0, 160.0, 250.0], got
        env["patti_id"] = target["id"]
        env["patti"] = target

    def test_5_edit_patti_with_bhada_total(self, env):
        """PUT /api/pattis/{id} with PattiEditLotIn.bhada_total → recomputed sum reflects."""
        assert "patti_id" in env, "requires test_4 to run first"
        patti = env["patti"]
        # Build lots payload: change 250 → 300 for that lot, keep others
        new_lots = []
        expected_sum = 0.0
        for lot in patti["lots"]:
            bhada_total = 300.0 if lot["bhada_total"] == 250.0 else lot["bhada_total"]
            expected_sum += bhada_total
            new_lots.append({
                "lot_serial_no": lot["lot_serial_no"],
                "total_bags": lot["total_bags"],
                "bhada_total": bhada_total,
                "sales": [
                    {"vendor_id": s["vendor_id"], "bags": s["bags"], "rate_per_bag": s["rate_per_bag"]}
                    for s in lot["sales"]
                ],
            })
        body = {
            "farmer_id": env["farmer"]["id"],
            "lots": new_lots,
            "hamali_per_bag": patti.get("hamali_per_bag", 10),
            "stationery_flat": patti.get("stationery_flat", 5),
            "payment_factor": patti.get("payment_factor", 0.9),
        }
        r = requests.put(f"{BASE_URL}/api/pattis/{env['patti_id']}", headers=env["headers"], json=body, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert round(j["bhada_total"], 2) == round(expected_sum, 2), (j["bhada_total"], expected_sum)
        # Verify per-lot: the 250 was raised to 300
        lot_totals = sorted([lot["bhada_total"] for lot in j["lots"]])
        assert lot_totals == [160.0, 160.0, 300.0], lot_totals


# ================== OCR endpoint ==================

class TestOcrEndpoint:
    def test_6_ocr_action_diary_returns_200(self, env):
        """POST /api/ocr/action-diary with fixture image → 200; rows can have bhada_total (nullable). No crash."""
        assert FIXTURE_IMG.exists(), f"fixture missing: {FIXTURE_IMG}"
        import base64 as _b64
        b64 = _b64.b64encode(FIXTURE_IMG.read_bytes()).decode()
        r = requests.post(
            f"{BASE_URL}/api/ocr/action-diary",
            headers={**env["headers"], "Content-Type": "application/json"},
            json={"image_base64": b64},
            timeout=120,
        )
        assert r.status_code == 200, f"OCR failed: {r.status_code} {r.text[:400]}"
        j = r.json()
        assert "rows" in j
        assert isinstance(j["rows"], list)
        # Field presence: bhada_total must be a permitted key (may be None). Just check no crash.
        for row in j["rows"]:
            # bhada_total may be missing/null; if present it must be numeric or None.
            bt = row.get("bhada_total", None)
            assert bt is None or isinstance(bt, (int, float)), row
