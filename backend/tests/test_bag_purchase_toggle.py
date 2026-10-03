"""Admin ON/OFF switch for bag purchase: admin setting, merchant flag, backend enforcement."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from test_free_bags import _setup

ADMIN = {"id": "adm-1", "username": "superadmin"}


def _ctx():
    db, shop_id, api, route, billing_mod = _setup()
    user = {"id": "user-1", "shop_id": shop_id, "role": "owner"}
    return db, shop_id, route, billing_mod, user


def _toggle(route, billing_mod, enabled: bool):
    return asyncio.run(route("/admin/billing/bag-purchase", "PUT").endpoint(
        billing_mod.BagPurchaseToggleIn(enabled=enabled), admin=ADMIN,
    ))


def _buy(route, billing_mod, user, bags=100):
    pending = asyncio.run(route("/billing/purchases", "POST").endpoint(
        billing_mod.PurchaseCreateIn(bags=bags), user=user,
    ))
    return asyncio.run(route("/billing/purchases/{purchase_id}/confirm-test", "POST").endpoint(pending.id, user=user))


def test_enabled_by_default_and_purchase_flow_unchanged():
    db, shop_id, route, billing_mod, user = _ctx()
    settings = asyncio.run(route("/admin/billing/settings", "GET").endpoint(admin=ADMIN))
    assert settings.bag_purchase_enabled is True
    wallet = asyncio.run(route("/billing/wallet", "GET").endpoint(user=user))
    assert wallet.purchase_enabled is True
    assert asyncio.run(route("/billing/price", "GET").endpoint(user=user))["purchase_enabled"] is True

    paid = _buy(route, billing_mod, user, bags=100)
    assert paid.status == "PAID" and paid.payment_ref.startswith("TEST-")
    assert db.merchant_bag_wallets.rows[0]["purchased_total"] == 100


def test_admin_disable_persists_and_is_audited():
    db, _, route, billing_mod, user = _ctx()
    out = _toggle(route, billing_mod, False)
    assert out.bag_purchase_enabled is False
    assert db.platform_billing_settings.rows[0]["bag_purchase_enabled"] is False
    assert db.platform_billing_settings.rows[0]["price_per_bag"] == 0.25
    audit = db.platform_admin_audit_log.rows[-1]
    assert audit["action"] == "BAG_PURCHASE_DISABLED"

    again = asyncio.run(route("/admin/billing/settings", "GET").endpoint(admin=ADMIN))
    assert again.bag_purchase_enabled is False
    assert asyncio.run(route("/billing/wallet", "GET").endpoint(user=user)).purchase_enabled is False
    assert asyncio.run(route("/billing/price", "GET").endpoint(user=user))["purchase_enabled"] is False

    _toggle(route, billing_mod, True)
    assert db.platform_admin_audit_log.rows[-1]["action"] == "BAG_PURCHASE_ENABLED"
    assert asyncio.run(route("/billing/wallet", "GET").endpoint(user=user)).purchase_enabled is True


def test_disabled_rejects_new_purchase_and_checkout():
    db, shop_id, route, billing_mod, user = _ctx()
    pending = asyncio.run(route("/billing/purchases", "POST").endpoint(
        billing_mod.PurchaseCreateIn(bags=50), user=user,
    ))
    _toggle(route, billing_mod, False)
    rows_before = len(db.bag_purchases.rows)

    with pytest.raises(HTTPException) as create_err:
        asyncio.run(route("/billing/purchases", "POST").endpoint(billing_mod.PurchaseCreateIn(bags=10), user=user))
    assert create_err.value.status_code == 403
    assert create_err.value.detail == {
        "code": "BAG_PURCHASE_DISABLED",
        "message": "Bag purchase is currently unavailable.",
    }
    assert len(db.bag_purchases.rows) == rows_before

    with pytest.raises(HTTPException) as confirm_err:
        asyncio.run(route("/billing/purchases/{purchase_id}/confirm-test", "POST").endpoint(pending.id, user=user))
    assert confirm_err.value.status_code == 403
    assert confirm_err.value.detail["code"] == "BAG_PURCHASE_DISABLED"
    assert db.merchant_bag_wallets.rows[0]["purchased_total"] == 0
    assert next(p for p in db.bag_purchases.rows if p["id"] == pending.id)["status"] == "PENDING"


def test_disabled_keeps_balance_history_usage_invoice_and_free_bags():
    db, shop_id, route, billing_mod, user = _ctx()
    paid = _buy(route, billing_mod, user, bags=100)
    db.bag_usage.rows.append({"id": "u-1", "shop_id": shop_id, "kind": "PATTI", "bags": 5,
                              "at": datetime.now(timezone.utc), "status": "ACTIVE"})
    _toggle(route, billing_mod, False)

    wallet = asyncio.run(route("/billing/wallet", "GET").endpoint(user=user))
    assert wallet.purchased_bags == 100 and wallet.purchase_enabled is False
    history = asyncio.run(route("/billing/purchases", "GET").endpoint(user=user, limit=100))
    assert [p.id for p in history] == [paid.id]
    usage = asyncio.run(route("/billing/usage", "GET").endpoint(user=user, limit=200))
    assert any(u["id"] == "u-1" for u in usage)
    inv = asyncio.run(route("/billing/purchases/{purchase_id}/invoice", "GET").endpoint(paid.id, user=user))
    assert inv.purchase_id == paid.id and inv.total_amount == paid.total_amount

    free_in = __import__("free_bags", fromlist=["FreeAllocationCreateIn"]).FreeAllocationCreateIn
    alloc = asyncio.run(route("/admin/billing/free-allocations", "POST").endpoint(
        free_in(shop_id=shop_id, bags=200, year=2026, month=10), admin=ADMIN,
    ))
    claimed = asyncio.run(route("/billing/free-allocations/{allocation_id}/claim", "POST").endpoint(alloc.id, user=user))
    assert claimed.status == "CLAIMED"
    assert db.merchant_bag_wallets.rows[0]["free_allocated"] == 1200


def test_settings_save_without_field_does_not_flip_switch():
    db, _, route, billing_mod, _ = _ctx()
    _toggle(route, billing_mod, False)
    put = route("/admin/billing/settings", "PUT")
    base = dict(price_per_bag=0.3, new_merchant_free_bags=1000, gst_percent=18.0, service_hsn_code="998399")

    out = asyncio.run(put.endpoint(billing_mod.PlatformBillingSettingsIn(**base), admin=ADMIN))
    assert out.bag_purchase_enabled is False and out.price_per_bag == 0.3

    out = asyncio.run(put.endpoint(billing_mod.PlatformBillingSettingsIn(**base, bag_purchase_enabled=True), admin=ADMIN))
    assert out.bag_purchase_enabled is True
