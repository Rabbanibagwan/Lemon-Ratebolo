"""Shared fixtures for backend tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # fallback to frontend .env
    from pathlib import Path
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    assert BASE_URL, "Backend URL not configured"
    return BASE_URL


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _unique(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture
def unique():
    return _unique


@pytest.fixture(scope="session")
def shop_a(base_url):
    """Signup fresh shop A and return token + payload."""
    username = f"testa_{uuid.uuid4().hex[:8]}"
    payload = {"shop_name": "TEST Shop A", "username": username, "password": "passA1234"}
    r = requests.post(f"{base_url}/api/auth/signup", json=payload, timeout=30)
    assert r.status_code == 201, f"signup A failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["access_token"],
        "shop_id": data["shop_id"],
        "username": username,
        "password": "passA1234",
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


@pytest.fixture(scope="session")
def shop_b(base_url):
    """Signup fresh shop B (for isolation tests)."""
    username = f"testb_{uuid.uuid4().hex[:8]}"
    payload = {"shop_name": "TEST Shop B", "username": username, "password": "passB1234"}
    r = requests.post(f"{base_url}/api/auth/signup", json=payload, timeout=30)
    assert r.status_code == 201
    data = r.json()
    return {
        "token": data["access_token"],
        "shop_id": data["shop_id"],
        "username": username,
        "password": "passB1234",
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }
