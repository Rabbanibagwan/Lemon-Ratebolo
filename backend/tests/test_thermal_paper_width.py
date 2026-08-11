"""Tests for configurable thermal_paper_width_mm in Settings."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://lemon-auction-hub.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

USERNAME = "ram1"
PASSWORD = "pass1234"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": USERNAME, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- baseline settings snapshot for restore ---
@pytest.fixture(scope="module")
def baseline_settings(headers):
    r = requests.get(f"{API}/settings", headers=headers, timeout=15)
    assert r.status_code == 200
    return r.json()


def _put_settings(headers, **overrides):
    """Send a PUT /settings with sensible defaults + overrides."""
    body = {
        "payment_factor": 0.9,
        "hamali_per_bag": 10,
        "stationery_flat": 5,
        "default_bhada_per_bag": 0,
        "detailed_print_format": False,
        "thermal_paper_width_mm": 80,
        "vendor_margin_per_bag": 30,
        "commission_per_bag": 10,
        "vendor_hamali_default": 0,
        "patti_prefix": "FP",
        "vendor_bill_prefix": "VB",
    }
    body.update(overrides)
    return requests.put(f"{API}/settings", headers=headers, json=body, timeout=15)


# ---------- Tests ----------

class TestSettingsThermalPaperWidth:
    def test_get_settings_includes_thermal_field(self, headers):
        r = requests.get(f"{API}/settings", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "thermal_paper_width_mm" in data
        # Field must be an int within 40..120
        val = data["thermal_paper_width_mm"]
        assert isinstance(val, int)
        assert 40 <= val <= 120

    def test_put_settings_width_100_persists(self, headers):
        r = _put_settings(headers, thermal_paper_width_mm=100)
        assert r.status_code == 200, r.text
        assert r.json()["thermal_paper_width_mm"] == 100
        # Verify via GET
        g = requests.get(f"{API}/settings", headers=headers, timeout=15)
        assert g.json()["thermal_paper_width_mm"] == 100

    def test_put_settings_width_58_persists(self, headers):
        r = _put_settings(headers, thermal_paper_width_mm=58)
        assert r.status_code == 200, r.text
        assert r.json()["thermal_paper_width_mm"] == 58
        g = requests.get(f"{API}/settings", headers=headers, timeout=15)
        assert g.json()["thermal_paper_width_mm"] == 58

    def test_put_settings_width_80_persists(self, headers):
        r = _put_settings(headers, thermal_paper_width_mm=80)
        assert r.status_code == 200, r.text
        assert r.json()["thermal_paper_width_mm"] == 80

    def test_put_settings_width_above_max_rejected(self, headers):
        r = _put_settings(headers, thermal_paper_width_mm=200)
        assert r.status_code == 422, f"expected 422 got {r.status_code} {r.text}"

    def test_put_settings_width_below_min_rejected(self, headers):
        r = _put_settings(headers, thermal_paper_width_mm=30)
        assert r.status_code == 422, f"expected 422 got {r.status_code} {r.text}"

    def test_regression_stationery_and_detailed_print(self, headers):
        r = _put_settings(headers, stationery_flat=7, detailed_print_format=True, thermal_paper_width_mm=80)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["stationery_flat"] == 7
        assert body["detailed_print_format"] is True
        assert body["thermal_paper_width_mm"] == 80
        # Persistence via GET
        g = requests.get(f"{API}/settings", headers=headers, timeout=15).json()
        assert g["stationery_flat"] == 7
        assert g["detailed_print_format"] is True

    def test_cleanup_restore_baseline(self, headers, baseline_settings):
        # Restore to baseline (with sensible fallback for missing fields)
        payload = dict(baseline_settings)
        payload.setdefault("thermal_paper_width_mm", 80)
        r = requests.put(f"{API}/settings", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200
