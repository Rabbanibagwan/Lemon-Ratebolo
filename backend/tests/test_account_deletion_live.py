"""Optional live-API account deletion checks (requires deployed backend with the endpoint).

Skipped automatically when POST /api/auth/delete-account is not available (e.g. pre-deploy).
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
import requests


def _base_url() -> str:
    for key in ("EXPO_PUBLIC_BACKEND_URL", "EXPO_BACKEND_URL"):
        v = os.environ.get(key)
        if v:
            return v.rstrip("/")
    for env_path in (Path("/workspace/frontend/.env"), Path("/app/frontend/.env")):
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    return ""


BASE = _base_url()
API = f"{BASE}/api" if BASE else ""


def _endpoint_available() -> bool:
    if not BASE:
        return False
    # OPTIONS/POST without auth should not be 404 if route exists
    r = requests.post(f"{API}/auth/delete-account", json={"confirm": "DELETE"}, timeout=30)
    return r.status_code != 404


pytestmark = pytest.mark.skipif(
    not BASE or not _endpoint_available(),
    reason="delete-account endpoint not deployed on configured backend",
)


def _signup():
    u = f"del_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/auth/signup",
        json={"shop_name": f"TEST Del {u}", "username": u, "password": "pass1234"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    d = r.json()
    return {
        "username": u,
        "password": "pass1234",
        "token": d["access_token"],
        "shop_id": d["shop_id"],
        "headers": {"Authorization": f"Bearer {d['access_token']}"},
    }


def test_live_owner_deletes_own_account():
    shop = _signup()
    r = requests.post(
        f"{API}/auth/delete-account",
        headers=shop["headers"],
        json={"confirm": "DELETE"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deleted"] is True
    assert body["drive_backups_deleted"] is False
    # Login must fail afterwards
    login = requests.post(
        f"{API}/auth/login",
        json={"username": shop["username"], "password": shop["password"]},
        timeout=30,
    )
    assert login.status_code == 401


def test_live_staff_cannot_delete():
    shop = _signup()
    uname = f"st_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/staff",
        headers=shop["headers"],
        json={"name": "TEST Counter", "username": uname, "password": "staff1234"},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    login = requests.post(
        f"{API}/auth/login",
        json={"username": uname, "password": "staff1234"},
        timeout=30,
    )
    assert login.status_code == 200, login.text
    counter_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    r = requests.post(
        f"{API}/auth/delete-account",
        headers=counter_headers,
        json={"confirm": "DELETE"},
        timeout=30,
    )
    assert r.status_code == 403
    # Owner still exists
    me = requests.get(f"{API}/auth/me", headers=shop["headers"], timeout=30)
    assert me.status_code == 200


def test_live_unauthenticated_rejected():
    r = requests.post(f"{API}/auth/delete-account", json={"confirm": "DELETE"}, timeout=30)
    assert r.status_code in (401, 403)


def test_live_auth_signup_still_works():
    shop = _signup()
    me = requests.get(f"{API}/auth/me", headers=shop["headers"], timeout=30)
    assert me.status_code == 200
    assert me.json()["role"] == "owner"
