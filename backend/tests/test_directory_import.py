"""Admin Directory Import — Farmers / Vendors Excel preview + confirm."""
from __future__ import annotations

import io
from typing import Dict

import pandas as pd
from fastapi.testclient import TestClient

from admin_panel.auth import make_admin_token, utc_now
from admin_panel.directory_import import (
    build_template_xlsx,
    parse_farmer_rows,
    parse_vendor_rows,
)
from tests.test_admin_panel import FakeDB, _app, _seed_admin


def _xlsx_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Directory")
    return buf.getvalue()


def _auth_header(db: FakeDB) -> Dict[str, str]:
    admin = db._store["platform_admins"][0]
    token = make_admin_token(admin)
    return {"Authorization": f"Bearer {token}"}


def _client_with_shop() -> tuple[FakeDB, TestClient, Dict[str, str]]:
    db = FakeDB()
    _seed_admin(db)
    now = utc_now()
    db._store["shops"] = [
        {"id": "shop1", "shop_name": "Demo Shop", "username": "demo", "active": True, "created_at": now}
    ]
    db._store["farmers"] = []
    db._store["vendors"] = []
    return db, _app(db), _auth_header(db)


class TestDirectoryImportParse:
    def test_farmer_template_and_parse(self):
        raw = build_template_xlsx("farmers")
        assert raw[:2] == b"PK"  # zip/xlsx
        rows = parse_farmer_rows(
            _xlsx_bytes(
                pd.DataFrame(
                    {
                        "Farmer Name": ["Ramu", "", "  Seetha  ", None, "Ramu"],
                    }
                )
            )
        )
        assert rows[0].status == "ready" and rows[0].name == "Ramu"
        assert rows[1].status == "blank"
        assert rows[2].status == "ready" and rows[2].name == "Seetha"
        assert rows[3].status == "blank"

    def test_vendor_requires_details(self):
        rows = parse_vendor_rows(
            _xlsx_bytes(
                pd.DataFrame(
                    {
                        "Vendor Name": ["V1", "V2", ""],
                        "Vendor Details": ["Shop A", "", "Only details"],
                    }
                )
            )
        )
        assert rows[0].status == "ready"
        assert rows[1].status == "invalid"
        assert rows[2].status == "invalid"


class TestDirectoryImportApi:
    def test_farmer_preview_and_confirm_skips_duplicates(self):
        db, client, headers = _client_with_shop()

        # existing farmer
        db._store["farmers"] = [
            {
                "id": "f0",
                "shop_id": "shop1",
                "name": "Existing",
                "phone": None,
                "village": None,
                "created_at": utc_now(),
            }
        ]

        content = _xlsx_bytes(
            pd.DataFrame(
                {
                    "Farmer Name": ["Existing", "New One", "", "new one", "Another"],
                }
            )
        )
        prev = client.post(
            "/api/admin/directory/import/preview",
            headers=headers,
            data={"shop_id": "shop1", "kind": "farmers"},
            files={
                "file": (
                    "farmers.xlsx",
                    content,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert prev.status_code == 200, prev.text
        body = prev.json()
        assert body["summary"]["ready"] == 2  # New One, Another (case duplicate of New One skipped in-file)
        assert body["summary"]["duplicate"] >= 1
        assert body["summary"]["blank"] >= 1

        ready = [r for r in body["rows"] if r["status"] == "ready"]
        conf = client.post(
            "/api/admin/directory/import/confirm",
            headers=headers,
            json={"shop_id": "shop1", "kind": "farmers", "rows": [{"name": r["name"]} for r in ready]},
        )
        assert conf.status_code == 200, conf.text
        out = conf.json()
        assert out["imported"] == 2
        names = {f["name"].casefold() for f in db._store["farmers"]}
        assert "new one" in names
        assert "another" in names
        assert len([f for f in db._store["farmers"] if f["name"].casefold() == "existing"]) == 1

    def test_vendor_import_name_details(self):
        db, client, headers = _client_with_shop()
        content = _xlsx_bytes(
            pd.DataFrame(
                {
                    "Vendor Name": ["Vendor A", "Vendor A", "Vendor B"],
                    "Vendor Details": ["Yard 1", "Yard 1", "Yard 2"],
                }
            )
        )
        prev = client.post(
            "/api/admin/directory/import/preview",
            headers=headers,
            data={"shop_id": "shop1", "kind": "vendors"},
            files={
                "file": (
                    "vendors.xlsx",
                    content,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert prev.status_code == 200, prev.text
        assert prev.json()["summary"]["ready"] == 2
        assert prev.json()["summary"]["duplicate"] == 1

        ready = [r for r in prev.json()["rows"] if r["status"] == "ready"]
        conf = client.post(
            "/api/admin/directory/import/confirm",
            headers=headers,
            json={
                "shop_id": "shop1",
                "kind": "vendors",
                "rows": [{"name": r["name"], "details": r.get("details")} for r in ready],
            },
        )
        assert conf.status_code == 200, conf.text
        assert conf.json()["imported"] == 2
        assert len(db._store["vendors"]) == 2

    def test_template_download(self):
        _db, client, headers = _client_with_shop()
        r = client.get("/api/admin/directory/import/template?kind=vendors", headers=headers)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        assert r.content[:2] == b"PK"

    def test_missing_shop(self):
        _db, client, headers = _client_with_shop()
        content = _xlsx_bytes(pd.DataFrame({"Farmer Name": ["A"]}))
        r = client.post(
            "/api/admin/directory/import/preview",
            headers=headers,
            data={"shop_id": "nope", "kind": "farmers"},
            files={
                "file": (
                    "f.xlsx",
                    content,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert r.status_code == 404
