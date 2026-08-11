"""Iteration 18 backend regression suite.

Change scope in iter18 is FRONTEND-ONLY (patti view header buttons, farmer
name font, DatePickerModal Android native path, KeyboardAwareScrollView on
4 screens). These backend tests confirm underlying contracts are unchanged:
  * POST /api/lots creates a lot AND auto-creates a Patti (one-patti-per-lot)
  * GET  /api/pattis?date=YYYY-MM-DD filters correctly
  * GET  /api/dashboard?date=YYYY-MM-DD returns expected shape
  * GET  /api/pattis/{id} exposes farmer_name / patti_no (no mongo _id leak)
  * Auth: /api/auth/me works for a freshly signed-up shop
"""
import datetime as dt
import os
import uuid

import pytest
import requests


def _resolve_base_url() -> str:
    for key in ("EXPO_PUBLIC_BACKEND_URL", "EXPO_BACKEND_URL"):
        v = os.environ.get(key)
        if v:
            return v.rstrip("/")
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("Backend URL env var missing")


BASE_URL = _resolve_base_url()
API = f"{BASE_URL}/api"


def _today() -> str:
    return dt.date.today().isoformat()


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def owner_headers():
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "shop_name": f"TEST Iter18 Shop {suffix}",
        "username": f"iter18_{suffix}",
        "password": "pass1234",
    }
    r = requests.post(f"{API}/auth/signup", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, body
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def farmer_id(owner_headers):
    r = requests.post(
        f"{API}/farmers",
        json={"name": "TEST Iter18 Farmer", "village": "TESTVIL", "phone": "9111111111"},
        headers=owner_headers, timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def vendor_id(owner_headers):
    r = requests.post(
        f"{API}/vendors",
        json={"name": "TEST Iter18 Vendor", "shop_name": "TEST Iter18 Vendor", "phone": "9000000001"},
        headers=owner_headers, timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def auction_day_id(owner_headers):
    r = requests.get(f"{API}/auction-days/today", headers=owner_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- 1. Auth ----------
def test_auth_me_ok(owner_headers):
    r = requests.get(f"{API}/auth/me", headers=owner_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("role") == "owner"
    assert body.get("username", "").startswith("iter18_")


# ---------- 2. One-Patti-per-Lot on POST /api/lots ----------
def test_post_lot_creates_patti_automatically(owner_headers, auction_day_id, farmer_id, vendor_id):
    payload = {
        "auction_day_id": auction_day_id,
        "farmer_id": farmer_id,
        "lot_serial_no": 1,
        "total_bags": 3,
        "bag_weights_kg": [40.0, 40.0, 40.0],
        "sales": [{"vendor_id": vendor_id, "bags": 3, "rate_per_bag": 750}],
    }
    r = requests.post(f"{API}/lots", json=payload, headers=owner_headers, timeout=30)
    assert r.status_code in (200, 201), r.text
    lot = r.json()
    assert lot.get("lot_no") or lot.get("lot_serial_no"), "lot number missing"

    # Verify a patti now exists for this farmer today.
    pattis = requests.get(f"{API}/pattis?date={_today()}", headers=owner_headers, timeout=30).json()
    assert any(p.get("farmer_name") == "TEST Iter18 Farmer" for p in pattis), \
        f"Auto-patti not found in {[p.get('farmer_name') for p in pattis]}"


# ---------- 3. /api/pattis?date filter ----------
def test_pattis_date_filter_today_ok(owner_headers):
    r = requests.get(f"{API}/pattis", params={"date": _today()}, headers=owner_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)


def test_pattis_date_filter_past_returns_empty(owner_headers):
    r = requests.get(f"{API}/pattis", params={"date": "1999-01-01"}, headers=owner_headers, timeout=15)
    assert r.status_code == 200
    assert r.json() == []


def test_pattis_bad_date_422(owner_headers):
    r = requests.get(f"{API}/pattis", params={"date": "notadate"}, headers=owner_headers, timeout=15)
    assert r.status_code == 422


# ---------- 4. /api/dashboard?date ----------
def test_dashboard_today_shape(owner_headers):
    r = requests.get(f"{API}/dashboard", params={"date": _today()}, headers=owner_headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    # After iter17, dashboard uses today_* keys — just assert basic shape and no crash.
    assert isinstance(d, dict) and d, "dashboard returned empty"
    assert d.get("today_pattis", 0) >= 1, "expected at least 1 patti today after seed"


# ---------- 5. Patti detail exposes farmer_name & no _id leak ----------
def test_patti_get_by_id_has_farmer_no_mongoid(owner_headers):
    pattis = requests.get(f"{API}/pattis?date={_today()}", headers=owner_headers, timeout=15).json()
    assert pattis, "no pattis for owner"
    pid = pattis[0]["id"]
    r = requests.get(f"{API}/pattis/{pid}", headers=owner_headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d.get("farmer_name"), "farmer_name missing on patti detail"
    assert d.get("patti_no") is not None, "patti_no missing"
    assert "_id" not in d, "mongo _id leaked in patti detail"


# ---------- 6. Auth required for protected endpoints ----------
def test_pattis_requires_auth():
    r = requests.get(f"{API}/pattis?date={_today()}", timeout=15)
    assert r.status_code in (401, 403)


def test_dashboard_requires_auth():
    r = requests.get(f"{API}/dashboard", timeout=15)
    assert r.status_code in (401, 403)
