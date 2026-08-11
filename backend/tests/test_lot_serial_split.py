"""Tests for the Lot Serial No + Total Bags refactor.

Covers:
- POST /api/lots new format (lot_serial_no + total_bags + sales)
- POST /api/lots bags-mismatch → 422 code=bags_mismatch
- POST /api/lots legacy format ("503/8" only) → parsed
- Duplicate lot_serial_no on same day → 409 code=duplicate_lot
- GET /api/lots returns both lot_serial_no + total_bags + derived lot_no
- Generate pattis → PattiLot has lot_serial_no + total_bags + sold_bags
- PUT /api/pattis/{id} new-format edit + mismatch (422)
- OCR /api/ocr/action-diary returns rows with lot_serial_no + total_bags
- Regression: vendors / farmers still work
"""
import os
import io
import uuid
import time
from pathlib import Path

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "")
if not BASE_URL:
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = BASE_URL.rstrip("/")


# ---------- Fixtures: fresh shop + farmer + 2 vendors + today auction day ----------
@pytest.fixture(scope="module")
def ctx():
    """Provision a fresh shop, one farmer, two vendors, and grab the today auction day."""
    assert BASE_URL, "Backend URL not configured"
    username = f"testls_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{BASE_URL}/api/auth/signup", json={
        "shop_name": "TEST LotSplit Shop", "username": username, "password": "passLS1234",
    }, timeout=30)
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    f = requests.post(f"{BASE_URL}/api/farmers", json={"name": "TEST_Farmer_LS"}, headers=h).json()
    v1 = requests.post(f"{BASE_URL}/api/vendors", json={"name": "TEST_V1_LS"}, headers=h).json()
    v2 = requests.post(f"{BASE_URL}/api/vendors", json={"name": "TEST_V2_LS"}, headers=h).json()
    day = requests.get(f"{BASE_URL}/api/auction-days/today", headers=h).json()
    return {"headers": h, "farmer": f, "v1": v1, "v2": v2, "day": day}


# ---------- 2. POST /api/lots new format ----------
class TestCreateLotNewFormat:
    def test_new_format_201_with_all_fields(self, ctx):
        h, f, v1, v2, day = ctx["headers"], ctx["farmer"], ctx["v1"], ctx["v2"], ctx["day"]
        payload = {
            "auction_day_id": day["id"],
            "lot_serial_no": 501, "total_bags": 5,
            "farmer_id": f["id"], "bhada_per_bag": 20,
            "sales": [
                {"vendor_id": v1["id"], "bags": 3, "rate_per_bag": 1000},
                {"vendor_id": v2["id"], "bags": 2, "rate_per_bag": 900},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/lots", json=payload, headers=h)
        assert r.status_code == 201, f"expected 201, got {r.status_code} {r.text}"
        data = r.json()
        assert data["lot_serial_no"] == 501
        assert data["total_bags"] == 5
        assert data["sold_bags"] == 5
        assert data["lot_no"] == "501/5"


# ---------- 3. Bags mismatch → 422 code=bags_mismatch ----------
class TestBagsMismatch:
    def test_mismatch_returns_422_with_code(self, ctx):
        h, f, v1, v2, day = ctx["headers"], ctx["farmer"], ctx["v1"], ctx["v2"], ctx["day"]
        payload = {
            "auction_day_id": day["id"],
            "lot_serial_no": 502, "total_bags": 10,
            "farmer_id": f["id"],
            "sales": [
                {"vendor_id": v1["id"], "bags": 3, "rate_per_bag": 100},
                {"vendor_id": v2["id"], "bags": 2, "rate_per_bag": 100},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/lots", json=payload, headers=h)
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"
        detail = r.json().get("detail")
        assert isinstance(detail, dict), f"detail should be dict, got {type(detail)}"
        assert detail.get("code") == "bags_mismatch", f"expected code=bags_mismatch, got {detail}"


# ---------- 4. Legacy format: lot_no="503/8" only ----------
class TestLegacyFormat:
    def test_legacy_lot_no_parsed(self, ctx):
        h, f, v1, v2, day = ctx["headers"], ctx["farmer"], ctx["v1"], ctx["v2"], ctx["day"]
        payload = {
            "auction_day_id": day["id"],
            "lot_no": "503/8",
            "farmer_id": f["id"], "bhada_per_bag": 10,
            "sales": [
                {"vendor_id": v1["id"], "bags": 5, "rate_per_bag": 800},
                {"vendor_id": v2["id"], "bags": 3, "rate_per_bag": 750},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/lots", json=payload, headers=h)
        assert r.status_code == 201, f"expected 201, got {r.status_code} {r.text}"
        data = r.json()
        assert data["lot_serial_no"] == 503
        assert data["total_bags"] == 8
        assert data["sold_bags"] == 8
        assert data["lot_no"] == "503/8"


# ---------- 5. Duplicate serial → 409 code=duplicate_lot ----------
class TestDuplicateSerial:
    def test_duplicate_serial_returns_409(self, ctx):
        h, f, v1, day = ctx["headers"], ctx["farmer"], ctx["v1"], ctx["day"]
        payload = {
            "auction_day_id": day["id"],
            "lot_serial_no": 777, "total_bags": 3,
            "farmer_id": f["id"],
            "sales": [{"vendor_id": v1["id"], "bags": 3, "rate_per_bag": 100}],
        }
        r1 = requests.post(f"{BASE_URL}/api/lots", json=payload, headers=h)
        assert r1.status_code == 201, f"first create failed: {r1.status_code} {r1.text}"

        r2 = requests.post(f"{BASE_URL}/api/lots", json=payload, headers=h)
        assert r2.status_code == 409, f"expected 409, got {r2.status_code} {r2.text}"
        detail = r2.json().get("detail")
        assert isinstance(detail, dict)
        assert detail.get("code") == "duplicate_lot"
        assert "serial" in (detail.get("message") or "").lower(), f"message must mention 'serial', got {detail}"


# ---------- 6. GET /api/lots returns split fields + derived lot_no ----------
class TestListLots:
    def test_list_lots_has_new_fields(self, ctx):
        h, day = ctx["headers"], ctx["day"]
        r = requests.get(f"{BASE_URL}/api/lots?auction_day_id={day['id']}", headers=h)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 1
        for it in items:
            assert isinstance(it.get("lot_serial_no"), int), f"lot_serial_no must be int, got {it}"
            assert isinstance(it.get("total_bags"), int), f"total_bags must be int, got {it}"
            assert isinstance(it.get("lot_no"), str) and "/" in it["lot_no"]
            expected = f"{it['lot_serial_no']}/{it['total_bags']}"
            assert it["lot_no"] == expected, f"lot_no derivation mismatch: {it}"


# ---------- 7. Generate pattis → PattiLot has new fields ----------
class TestGeneratePattis:
    def test_pattis_have_new_lot_fields(self, ctx):
        h, day = ctx["headers"], ctx["day"]
        r = requests.post(f"{BASE_URL}/api/auction-days/{day['id']}/generate-pattis", headers=h)
        assert r.status_code == 200, f"generate-pattis failed: {r.status_code} {r.text}"
        pattis = r.json()
        assert isinstance(pattis, list) and len(pattis) >= 1
        p = pattis[0]
        # sum(sold_bags) across lots must == patti.total_bags
        sold_sum = sum(int(L["sold_bags"]) for L in p["lots"])
        assert p["total_bags"] == sold_sum, f"top-level total_bags {p['total_bags']} != sum sold {sold_sum}"
        for L in p["lots"]:
            assert isinstance(L.get("lot_serial_no"), int)
            assert isinstance(L.get("total_bags"), int)
            assert isinstance(L.get("sold_bags"), int)
            assert isinstance(L.get("lot_no"), str)
        # stash first patti for edit test
        ctx["patti_id"] = p["id"]


# ---------- 8. PUT /api/pattis/{id} new-format + mismatch ----------
class TestEditPatti:
    def test_edit_patti_new_format_success(self, ctx):
        assert ctx.get("patti_id"), "requires generate-pattis first"
        h, f, v1, v2 = ctx["headers"], ctx["farmer"], ctx["v1"], ctx["v2"]
        pid = ctx["patti_id"]
        # fetch current patti to grab its farmer id + date
        pr = requests.get(f"{BASE_URL}/api/pattis/{pid}", headers=h).json()
        payload = {
            "farmer_id": pr["farmer_id"], "date": pr["date"],
            "hamali_per_bag": pr["hamali_per_bag"],
            "stationery_flat": pr["stationery_flat"],
            "payment_factor": pr["payment_factor"],
            "lots": [{
                "lot_serial_no": 801, "total_bags": 4,
                "farmer_id": pr["farmer_id"],
                "bhada_per_bag": 15,
                "sales": [
                    {"vendor_id": v1["id"], "bags": 2, "rate_per_bag": 500},
                    {"vendor_id": v2["id"], "bags": 2, "rate_per_bag": 400},
                ],
            }],
        }
        r = requests.put(f"{BASE_URL}/api/pattis/{pid}", json=payload, headers=h)
        assert r.status_code == 200, f"edit failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["lots"][0]["lot_serial_no"] == 801
        assert data["lots"][0]["total_bags"] == 4
        assert data["lots"][0]["sold_bags"] == 4

    def test_edit_patti_mismatch_returns_422(self, ctx):
        assert ctx.get("patti_id")
        h, v1 = ctx["headers"], ctx["v1"]
        pid = ctx["patti_id"]
        pr = requests.get(f"{BASE_URL}/api/pattis/{pid}", headers=h).json()
        payload = {
            "farmer_id": pr["farmer_id"], "date": pr["date"],
            "hamali_per_bag": pr["hamali_per_bag"],
            "stationery_flat": pr["stationery_flat"],
            "payment_factor": pr["payment_factor"],
            "lots": [{
                "lot_serial_no": 802, "total_bags": 10,
                "farmer_id": pr["farmer_id"],
                "bhada_per_bag": 10,
                "sales": [{"vendor_id": v1["id"], "bags": 2, "rate_per_bag": 100}],
            }],
        }
        r = requests.put(f"{BASE_URL}/api/pattis/{pid}", json=payload, headers=h)
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"
        detail = r.json().get("detail")
        assert isinstance(detail, dict) and detail.get("code") == "bags_mismatch"


# ---------- 9. OCR endpoint ----------
class TestOcrRowsSplit:
    def test_ocr_returns_split_fields(self, ctx):
        import base64
        h = ctx["headers"]
        fixture = Path("/app/backend/tests/fixtures/diary_sample.jpg")
        assert fixture.exists(), "diary_sample.jpg fixture missing"
        img_b64 = base64.b64encode(fixture.read_bytes()).decode("ascii")
        r = requests.post(
            f"{BASE_URL}/api/ocr/action-diary",
            json={"image_base64": img_b64}, headers=h, timeout=120,
        )
        assert r.status_code == 200, f"ocr failed: {r.status_code} {r.text}"
        body = r.json()
        assert "rows" in body and isinstance(body["rows"], list)
        rows = body["rows"]
        # At least 2 rows must have BOTH lot_serial_no + total_bags populated as ints
        both_filled = [r for r in rows
                       if isinstance(r.get("lot_serial_no"), int) and isinstance(r.get("total_bags"), int)]
        assert len(both_filled) >= 2, (
            f"expected >=2 rows with both lot_serial_no + total_bags, got {len(both_filled)} of {len(rows)}: {rows}"
        )
        # lot_no MAY be null — that's expected (split happened server-side)


# ---------- 10. Regression: farmers / vendors / vendor-bill endpoints still respond ----------
class TestRegressionEndpoints:
    def test_farmers_get(self, ctx):
        r = requests.get(f"{BASE_URL}/api/farmers", headers=ctx["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) >= 1

    def test_vendors_get(self, ctx):
        r = requests.get(f"{BASE_URL}/api/vendors", headers=ctx["headers"])
        assert r.status_code == 200
        assert len(r.json()) >= 2

    def test_pattis_list(self, ctx):
        r = requests.get(f"{BASE_URL}/api/pattis", headers=ctx["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list)
