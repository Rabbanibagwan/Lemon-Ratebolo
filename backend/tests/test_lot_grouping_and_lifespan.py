"""Test Fix A (bulk POST /api/lots with multiple sales → single Lot) and Fix B (lifespan).

Also verifies /api/ root response and end-to-end that key routes are alive after
the on_event -> lifespan migration.
"""
import os
import re
import time
import base64
from pathlib import Path

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


# ---------- Fix B: server.py structure ----------
class TestServerFileStructure:
    """Static checks on server.py enforcing Fix B."""

    def test_no_on_event_decorators(self):
        src = Path("/app/backend/server.py").read_text()
        assert "@app.on_event" not in src, "Deprecated @app.on_event(...) still present"

    def test_lifespan_present(self):
        src = Path("/app/backend/server.py").read_text()
        assert "@asynccontextmanager" in src, "@asynccontextmanager import/usage missing"
        assert re.search(r"async def lifespan\(app: FastAPI\)", src), "lifespan function missing"
        assert "lifespan=lifespan" in src, "lifespan not wired into FastAPI(...)"

    def test_single_include_router(self):
        src = Path("/app/backend/server.py").read_text()
        occurrences = re.findall(r"app\.include_router\(api", src)
        assert len(occurrences) == 1, f"include_router should appear once, found {len(occurrences)}"


# ---------- Fix B end-to-end: existing routes still work ----------
class TestExistingRoutes:
    """End-to-end pre-existing routes still return 200 after lifespan migration."""

    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"service": "Lemon Mandi Billing", "ok": True, "version": 2}

    def test_login_ram1(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"username": "ram1", "password": "pass1234"}, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert "access_token" in b and b["role"] == "owner"

    def test_pattis_and_bills_and_settings(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"username": "ram1", "password": "pass1234"}, timeout=15)
        tok = r.json()["access_token"]
        H = {"Authorization": f"Bearer {tok}"}

        r1 = requests.get(f"{BASE_URL}/api/pattis", headers=H, timeout=15)
        assert r1.status_code == 200, r1.text
        assert isinstance(r1.json(), list)

        r2 = requests.get(f"{BASE_URL}/api/vendor-bills", headers=H, timeout=15)
        assert r2.status_code == 200, r2.text
        assert isinstance(r2.json(), list)

        r3 = requests.get(f"{BASE_URL}/api/settings", headers=H, timeout=15)
        assert r3.status_code == 200, r3.text
        s = r3.json()
        assert "stationery_flat" in s

    def test_ocr_diary_still_works(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"username": "ram1", "password": "pass1234"}, timeout=15)
        tok = r.json()["access_token"]
        H = {"Authorization": f"Bearer {tok}"}
        img_path = Path("/app/backend/tests/fixtures/diary_sample.jpg")
        assert img_path.exists(), "diary_sample.jpg missing"
        b64 = base64.b64encode(img_path.read_bytes()).decode()
        r = requests.post(
            f"{BASE_URL}/api/ocr/action-diary",
            json={"image_base64": b64},
            headers=H, timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body


# ---------- Fix A: bulk POST /api/lots with 2 sales in one lot ----------
class TestLotGrouping:
    def test_single_lot_two_vendors_two_sales(self):
        # Fresh shop for isolation
        uname = f"grp_{int(time.time())}"
        r = requests.post(f"{BASE_URL}/api/auth/signup",
                          json={"shop_name": "TEST Grouping Shop", "username": uname,
                                "password": "passG1234"}, timeout=15)
        assert r.status_code == 201, r.text
        tok = r.json()["access_token"]
        H = {"Authorization": f"Bearer {tok}"}

        # Farmer
        rf = requests.post(f"{BASE_URL}/api/farmers", json={"name": "TEST Ramanna"},
                           headers=H, timeout=15)
        assert rf.status_code == 201, rf.text
        farmer_id = rf.json()["id"]

        # Vendors
        rv1 = requests.post(f"{BASE_URL}/api/vendors", json={"name": "TEST Vendor A"},
                            headers=H, timeout=15)
        assert rv1.status_code == 201, rv1.text
        v1 = rv1.json()["id"]
        rv2 = requests.post(f"{BASE_URL}/api/vendors", json={"name": "TEST Vendor B"},
                            headers=H, timeout=15)
        assert rv2.status_code == 201, rv2.text
        v2 = rv2.json()["id"]

        # Auction day
        rd = requests.get(f"{BASE_URL}/api/auction-days/today", headers=H, timeout=15)
        assert rd.status_code == 200, rd.text
        day_id = rd.json()["id"]

        # POST a SINGLE lot with 2 sales (this is what OCR preview save now does)
        payload = {
            "auction_day_id": day_id,
            "lot_no": "1/10",
            "farmer_id": farmer_id,
            "bhada_per_bag": 0,
            "sales": [
                {"vendor_id": v1, "bags": 5, "rate_per_bag": 1500},
                {"vendor_id": v2, "bags": 5, "rate_per_bag": 1200},
            ],
        }
        rl = requests.post(f"{BASE_URL}/api/lots", json=payload, headers=H, timeout=15)
        assert rl.status_code == 201, rl.text
        lot = rl.json()
        assert lot["lot_no"] == "1/10"
        assert lot["farmer_id"] == farmer_id
        assert len(lot["sales"]) == 2, f"expected 2 sales in one lot, got {lot['sales']}"
        assert lot["total_bags"] == 10
        assert abs(lot["gross_total"] - (5 * 1500 + 5 * 1200)) < 0.01

        # Verify GET /lots shows exactly 1 lot for today
        rlots = requests.get(f"{BASE_URL}/api/lots", headers=H, timeout=15)
        assert rlots.status_code == 200
        todays = [x for x in rlots.json() if x["auction_day_id"] == day_id]
        assert len(todays) == 1

        # Generate pattis → single patti for the farmer
        rgen = requests.post(f"{BASE_URL}/api/auction-days/{day_id}/generate-pattis",
                             headers=H, timeout=20)
        assert rgen.status_code == 200, rgen.text
        pattis = rgen.json()
        assert len(pattis) == 1, f"expected 1 patti, got {len(pattis)}"
        p = pattis[0]
        assert p["total_bags"] == 10
        # farmer_gross = (5*1500 + 5*1200) * 0.9 = 12150
        assert abs(p["farmer_gross"] - 12150.0) < 0.01, p["farmer_gross"]
        assert abs(p["stationery_total"] - 5.0) < 0.01, p["stationery_total"]
        # deductions = hamali (10*10=100) + stationery (5) + bhada (0) = 105
        assert abs(p["deductions_total"] - 105.0) < 0.01, p["deductions_total"]
        # single lot in patti with 2 sales
        assert len(p["lots"]) == 1
        assert len(p["lots"][0]["sales"]) == 2
