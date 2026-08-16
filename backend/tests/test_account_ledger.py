"""Account Ledger: farmer is manual-only; vendor bills/payments auto-post once."""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
import requests


def _today() -> str:
    return dt.date.today().isoformat()


def _yday() -> str:
    return (dt.date.today() - dt.timedelta(days=1)).isoformat()


@pytest.fixture(scope="module")
def shop(base_url):
    username = f"led_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{base_url}/api/auth/signup",
        json={"shop_name": "TEST Ledger Shop", "username": username, "password": "passLED1234"},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    return {
        "headers": {"Authorization": f"Bearer {data['access_token']}", "Content-Type": "application/json"},
    }


@pytest.fixture(scope="module")
def seed(base_url, shop):
    H = shop["headers"]
    farmer = requests.post(f"{base_url}/api/farmers", json={"name": "ABDG", "village": "DGR"}, headers=H).json()
    vendor = requests.post(f"{base_url}/api/vendors", json={"name": "AC", "details": "AC Traders"}, headers=H).json()
    day = requests.get(f"{base_url}/api/auction-days/today", headers=H).json()
    return {"farmer": farmer, "vendor": vendor, "day": day}


class TestFarmerLedgerSeparateFromPatti:
    def test_patti_does_not_create_farmer_ledger(self, base_url, shop, seed):
        H = shop["headers"]
        day_id = seed["day"]["id"]
        requests.put(
            f"{base_url}/api/auction-days/{day_id}",
            json={"date": _today(), "drivers": [
                {"name": "D1", "place": "X", "bhada_per_bag": 10, "range_from": 1, "range_to": 100}
            ]},
            headers=H,
        )
        r = requests.post(
            f"{base_url}/api/lots",
            json={
                "auction_day_id": day_id,
                "lot_serial_no": 1,
                "total_bags": 2,
                "farmer_id": seed["farmer"]["id"],
                "sales": [{"vendor_id": seed["vendor"]["id"], "bags": 2, "rate_per_bag": 1000}],
            },
            headers=H,
        )
        assert r.status_code in (200, 201), r.text
        requests.post(f"{base_url}/api/auction-days/{day_id}/generate-pattis", headers=H)

        d = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "FARMER", "party_id": seed["farmer"]["id"], "date": _today()},
            headers=H,
        )
        assert d.status_code == 200, d.text
        body = d.json()
        assert body["rows"] == []
        assert body["total_credit"] == 0
        assert not any(r.get("source_type") == "FARMER_PATTI" for r in body["rows"])

    def test_manual_credit_and_debit(self, base_url, shop, seed):
        H = shop["headers"]
        r = requests.post(
            f"{base_url}/api/account-ledger",
            json={
                "account_type": "FARMER",
                "farmer_id": seed["farmer"]["id"],
                "date": _today(),
                "transaction_type": "CREDIT",
                "amount": 5000,
                "description": "Previous balance adjustment",
            },
            headers=H,
        )
        assert r.status_code == 201, r.text
        r = requests.post(
            f"{base_url}/api/account-ledger",
            json={
                "account_type": "FARMER",
                "farmer_id": seed["farmer"]["id"],
                "date": _today(),
                "transaction_type": "DEBIT",
                "amount": 2000,
                "description": "Payment adjustment",
            },
            headers=H,
        )
        assert r.status_code == 201, r.text
        d = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "FARMER", "party_id": seed["farmer"]["id"], "date": _today()},
            headers=H,
        ).json()
        assert d["total_credit"] == 5000
        assert d["total_debit"] == 2000
        assert d["balance"] == 3000
        assert all(row["source_type"] == "MANUAL" for row in d["rows"])

    def test_date_filter(self, base_url, shop, seed):
        H = shop["headers"]
        other = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "FARMER", "party_id": seed["farmer"]["id"], "date": _yday()},
            headers=H,
        ).json()
        assert other["rows"] == []
        today = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "FARMER", "party_id": seed["farmer"]["id"], "date": _today()},
            headers=H,
        ).json()
        assert len(today["rows"]) == 2


class TestVendorLedgerPostedAndPayments:
    def test_posted_bill_then_payments_no_dupes(self, base_url, shop, seed):
        H = shop["headers"]
        vid = seed["vendor"]["id"]
        empty = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "VENDOR", "party_id": vid, "date": _today()},
            headers=H,
        ).json()
        assert empty["rows"] == []

        bill = requests.post(
            f"{base_url}/api/vendor-bills",
            json={
                "vendor_id": vid, "date": _today(),
                "vendor_factor": 1.0, "margin_per_bag": 0, "commission_per_bag": 0,
                "hamali": 0, "cess": 0,
                "lines": [{"lot_no": "1/1", "farmer_name": "ABDG", "bags": 1, "auction_rate": 5000}],
            },
            headers=H,
        )
        assert bill.status_code == 201, bill.text
        b = bill.json()
        grand = b["grand_total"]
        bid = b["id"]

        d1 = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "VENDOR", "party_id": vid, "date": _today()},
            headers=H,
        ).json()
        bill_rows = [r for r in d1["rows"] if r["source_type"] == "VENDOR_BILL"]
        assert len(bill_rows) == 1
        assert bill_rows[0]["source_id"] == bid
        assert bill_rows[0]["credit"] == grand

        # Refresh must not duplicate
        d2 = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "VENDOR", "party_id": vid, "date": _today()},
            headers=H,
        ).json()
        assert len([r for r in d2["rows"] if r["source_type"] == "VENDOR_BILL"]) == 1

        p1 = requests.post(
            f"{base_url}/api/vendor-payments",
            json={"vendor_id": vid, "amount": 2000, "mode": "cash",
                  "allocations": [{"bill_id": bid, "amount": 2000}]},
            headers=H,
        )
        assert p1.status_code == 201, p1.text
        rest = grand - 2000
        p2 = requests.post(
            f"{base_url}/api/vendor-payments",
            json={"vendor_id": vid, "amount": rest, "mode": "cash",
                  "allocations": [{"bill_id": bid, "amount": rest}]},
            headers=H,
        )
        assert p2.status_code == 201, p2.text

        d3 = requests.get(
            f"{base_url}/api/account-ledger/detail",
            params={"account_type": "VENDOR", "party_id": vid, "date": _today()},
            headers=H,
        ).json()
        pays = [r for r in d3["rows"] if r["source_type"] == "VENDOR_PAYMENT"]
        assert len(pays) == 2
        assert d3["balance"] == 0
        got = requests.get(f"{base_url}/api/vendor-bills/{bid}", headers=H).json()
        assert got["status"] == "paid"
        assert got["balance"] == 0
