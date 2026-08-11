"""Tests for the OCR Action Diary endpoint (POST /api/ocr/action-diary).

Uses real Gemini vision via emergentintegrations (EMERGENT_LLM_KEY).
Vision extraction is stochastic; we treat "rows >= 3" as pass bar for the
sample fixture, per review request.
"""
import base64
import io
import os
import uuid

import pytest
import requests
from PIL import Image

FIXTURE = "/app/backend/tests/fixtures/diary_sample.jpg"


# ---------- helpers ----------
def _b64_of(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def _blank_jpeg_b64() -> str:
    """A plain 100x100 white JPEG (still real JPEG, but no content)."""
    im = Image.new("RGB", (100, 100), (255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def shop_token(base_url):
    """Create a fresh shop for OCR tests and return auth headers."""
    username = f"ocr_{uuid.uuid4().hex[:8]}"
    payload = {"shop_name": "TEST OCR Shop", "username": username, "password": "passOcr1234"}
    r = requests.post(f"{base_url}/api/auth/signup", json=payload, timeout=30)
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


# ---------- test 1: happy path ----------
class TestOcrHappyPath:
    def test_extracts_rows_from_diary_sample(self, base_url, shop_token):
        assert os.path.exists(FIXTURE), f"fixture missing: {FIXTURE}"
        img_b64 = _b64_of(FIXTURE)
        body = {"image_base64": img_b64, "mime_type": "image/jpeg"}
        # Retry once because vision is stochastic
        last = None
        for attempt in range(2):
            r = requests.post(
                f"{base_url}/api/ocr/action-diary",
                json=body, headers=shop_token, timeout=90,
            )
            last = r
            if r.status_code == 200 and len(r.json().get("rows", [])) >= 3:
                break
        assert last.status_code == 200, f"OCR status {last.status_code}: {last.text[:400]}"
        data = last.json()
        assert data.get("model") == "gemini-3.1-pro-preview", f"model={data.get('model')}"
        rows = data.get("rows", [])
        assert isinstance(rows, list)
        assert len(rows) >= 3, f"expected >=3 rows, got {len(rows)}: {rows}"
        # Each row must be a dict with expected keys (values may be null but keys present)
        expected_keys = {"lot_no", "farmer_name", "vendor_name", "bags",
                         "rate_per_bag", "bhada_per_bag"}
        for row in rows:
            assert isinstance(row, dict)
            assert expected_keys.issubset(row.keys()), f"missing keys in row: {row}"
            # bags must be int-or-null, rate/bhada must be float-or-null
            if row["bags"] is not None:
                assert isinstance(row["bags"], int), f"bags not int: {row}"
            if row["rate_per_bag"] is not None:
                assert isinstance(row["rate_per_bag"], (int, float))
            if row["bhada_per_bag"] is not None:
                assert isinstance(row["bhada_per_bag"], (int, float))

        # Soft check: at least one row should have a non-null farmer & vendor & bags & rate
        parseable = [
            r for r in rows
            if r.get("farmer_name") and r.get("vendor_name")
            and r.get("bags") is not None and r.get("rate_per_bag") is not None
        ]
        assert len(parseable) >= 2, (
            f"expected >=2 fully-parsed rows; got {len(parseable)}. rows={rows}"
        )


# ---------- test 2: auth required ----------
class TestOcrAuth:
    def test_missing_token_returns_401_or_403(self, base_url):
        body = {"image_base64": _blank_jpeg_b64(), "mime_type": "image/jpeg"}
        r = requests.post(f"{base_url}/api/ocr/action-diary", json=body, timeout=30)
        # FastAPI HTTPBearer typically returns 403 when Authorization header
        # missing entirely; 401 when token invalid. Either signals unauthorised.
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text[:200]}"


# ---------- test 3: blank image graceful ----------
class TestOcrBlankImage:
    def test_blank_image_returns_empty_rows_not_500(self, base_url, shop_token):
        body = {"image_base64": _blank_jpeg_b64(), "mime_type": "image/jpeg"}
        r = requests.post(
            f"{base_url}/api/ocr/action-diary",
            json=body, headers=shop_token, timeout=90,
        )
        # must NOT crash
        assert r.status_code == 200, f"blank image caused {r.status_code}: {r.text[:400]}"
        data = r.json()
        assert data["model"] == "gemini-3.1-pro-preview"
        rows = data.get("rows", [])
        assert isinstance(rows, list)
        # Model should either return no rows, or if it hallucinates rows we
        # only require the warning-or-empty invariant per spec.
        if len(rows) == 0:
            # empty rows are acceptable; warning should be populated
            assert data.get("warning"), "blank image with empty rows must include a warning"
        else:
            # If model hallucinated rows we tolerate it (stochastic) but flag
            print(f"[blank image test] model hallucinated {len(rows)} rows: {rows}")


# ---------- test 4: data URL prefix stripped ----------
class TestOcrDataUrlPrefix:
    def test_data_url_prefix_is_stripped(self, base_url, shop_token):
        img_b64 = _b64_of(FIXTURE)
        prefixed = f"data:image/jpeg;base64,{img_b64}"
        body = {"image_base64": prefixed, "mime_type": "image/jpeg"}
        r = requests.post(
            f"{base_url}/api/ocr/action-diary",
            json=body, headers=shop_token, timeout=90,
        )
        assert r.status_code == 200, (
            f"data URL prefix broke request: {r.status_code} {r.text[:400]}"
        )
        data = r.json()
        assert data["model"] == "gemini-3.1-pro-preview"
        assert isinstance(data.get("rows", []), list)
