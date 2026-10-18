"""Isolated OCR concurrency harness (mocked Gemini — never hits production).

Stages exercise process-local OCR_MAX_CONCURRENT under synthetic provider latency.
These numbers are TESTED capacity of the OCR gate alone, not live merchant capacity.
"""
from __future__ import annotations

import asyncio
import json
import statistics
import time
from unittest.mock import patch

import pytest

import ocr_service as ocr_mod
from ocr_service import (
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_FALLBACK_MODEL_2,
    DEFAULT_PRIMARY_MODEL,
    extract_with_resilience,
)


def _patch_list_models(available=None):
    return patch("ocr_service.list_available_gemini_models", return_value=available)


@pytest.fixture(autouse=True)
def _reset_ocr_runtime():
    ocr_mod._runtime_unavailable_models.clear()
    ocr_mod._available_models_cache = None
    ocr_mod._gemini_sem = None
    yield
    ocr_mod._runtime_unavailable_models.clear()
    ocr_mod._available_models_cache = None
    ocr_mod._gemini_sem = None


def _percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


async def _run_stage(
    *,
    concurrency: int,
    max_concurrent: int,
    provider_latency_s: float,
) -> dict:
    in_flight = {"n": 0, "max": 0}
    latencies: list[float] = []
    errors = 0

    def fake_gemini(*args, **kwargs):
        in_flight["n"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["n"])
        time.sleep(provider_latency_s)
        in_flight["n"] -= 1
        return json.dumps({"rows": [{"lot_serial_no": 1}]}), DEFAULT_PRIMARY_MODEL

    ocr_mod._gemini_sem = asyncio.Semaphore(max_concurrent)
    env = {
        "GEMINI_API_KEY": "test-key",
        "OCR_MAX_CONCURRENT": str(max_concurrent),
        "OCR_MAX_RETRIES": "1",
        "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
        "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
        "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
    }

    async def one(i: int) -> None:
        nonlocal errors
        t0 = time.time()
        try:
            await extract_with_resilience(
                image_b64="x" * 200,
                mime_type="image/jpeg",
                hint=None,
                system_prompt="sys",
                parse_diary_text=lambda t: [],
                shop_id=f"shop-{i % 7}",
            )
        except Exception:
            errors += 1
        latencies.append((time.time() - t0) * 1000)

    with patch.dict("os.environ", env):
        with _patch_list_models(None):
            with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                with patch("ocr_service.optimize_ocr_image_b64", side_effect=lambda b, m: (b, m)):
                    await asyncio.gather(*(one(i) for i in range(concurrency)))

    latencies.sort()
    return {
        "concurrency": concurrency,
        "max_concurrent": max_concurrent,
        "provider_latency_s": provider_latency_s,
        "success": concurrency - errors,
        "failed": errors,
        "provider_in_flight_max": in_flight["max"],
        "median_ms": statistics.median(latencies) if latencies else 0,
        "p95_ms": _percentile(latencies, 95),
        "p99_ms": _percentile(latencies, 99),
        "max_ms": max(latencies) if latencies else 0,
    }


def test_ocr_capacity_stages_mocked_provider():
    """Staged concurrency against mocked Gemini (isolated — not production)."""
    stages = (1, 5, 10, 25)
    max_concurrent = 2
    provider_latency_s = 0.05
    results = []

    async def _all():
        out = []
        for n in stages:
            out.append(
                await _run_stage(
                    concurrency=n,
                    max_concurrent=max_concurrent,
                    provider_latency_s=provider_latency_s,
                )
            )
        return out

    results = asyncio.run(_all())

    for r in results:
        # Gate must never exceed OCR_MAX_CONCURRENT provider calls.
        assert r["provider_in_flight_max"] <= max_concurrent
        assert r["failed"] == 0
        # Under queueing, p95 grows roughly with ceil(n/max)*provider_latency.
        waves = (r["concurrency"] + max_concurrent - 1) // max_concurrent
        # Allow generous slack for thread scheduling.
        assert r["p95_ms"] < (waves * provider_latency_s * 1000) + 500

    # Higher concurrency must queue (p95 rises vs single request).
    by_n = {r["concurrency"]: r for r in results}
    assert by_n[10]["p95_ms"] >= by_n[1]["median_ms"]

    # Print machine-readable summary for the capacity report (pytest -s shows it).
    print("OCR_CAPACITY_HARNESS_RESULTS", json.dumps(results))


def test_cash_book_has_no_backend_api_surface():
    """Architectural guard: Cash Book must not appear as a backend route."""
    from pathlib import Path

    server = Path(__file__).resolve().parents[1] / "server.py"
    text = server.read_text(encoding="utf-8")
    assert "/cash-book" not in text
    assert '@api.post("/cash-book' not in text
    assert '@api.get("/cash-book' not in text
    assert "CashBook" not in text
