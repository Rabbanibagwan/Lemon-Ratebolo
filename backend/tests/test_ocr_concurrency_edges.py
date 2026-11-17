"""Isolated OCR concurrency edge cases (mocked provider only — never production)."""
from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import patch

import pytest

import ocr_service as ocr_mod
from ocr_service import (
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_FALLBACK_MODEL_2,
    DEFAULT_PRIMARY_MODEL,
    ClassifiedOcrError,
    OcrErrorClass,
    OcrServiceError,
    extract_with_resilience,
)


def _patch_list_models(available=None):
    return patch("ocr_service.list_available_gemini_models", return_value=available)


@pytest.fixture(autouse=True)
def _reset():
    ocr_mod._runtime_unavailable_models.clear()
    ocr_mod._available_models_cache = None
    ocr_mod._gemini_sem = None
    ocr_mod._QUEUE_WAIT_TIMEOUT_SEC = 120.0
    # Reset live gauges without wiping historical counters used elsewhere.
    ocr_mod.METRICS.active_provider_calls = 0
    ocr_mod.METRICS.queued_waiting = 0
    yield
    ocr_mod._runtime_unavailable_models.clear()
    ocr_mod._available_models_cache = None
    ocr_mod._gemini_sem = None
    ocr_mod.METRICS.active_provider_calls = 0
    ocr_mod.METRICS.queued_waiting = 0


ENV = {
    "GEMINI_API_KEY": "k",
    "OCR_MAX_CONCURRENT": "2",
    "OCR_MAX_RETRIES": "2",
    "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
    "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
    "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
}


def test_concurrent_success_respects_max_concurrent():
    in_flight = {"n": 0, "max": 0}

    def ok(*a, **k):
        in_flight["n"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["n"])
        time.sleep(0.03)
        in_flight["n"] -= 1
        return json.dumps({"rows": []}), DEFAULT_PRIMARY_MODEL

    async def _run():
        ocr_mod._gemini_sem = asyncio.Semaphore(2)
        with patch.dict("os.environ", ENV):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=ok):
                    with patch("ocr_service.optimize_ocr_image_b64", side_effect=lambda b, m: (b, m)):
                        await asyncio.gather(
                            *[
                                extract_with_resilience(
                                    image_b64="x" * 50,
                                    mime_type="image/jpeg",
                                    hint=None,
                                    system_prompt="sys",
                                    parse_diary_text=lambda t: [],
                                    shop_id=f"s{i}",
                                )
                                for i in range(6)
                            ]
                        )

    asyncio.run(_run())
    assert in_flight["max"] <= 2
    assert ocr_mod.METRICS.active_provider_calls == 0
    assert ocr_mod.METRICS.queued_waiting == 0


def test_provider_429_then_success_on_retry():
    n = {"c": 0}

    def flaky(*a, **k):
        n["c"] += 1
        if n["c"] == 1:
            raise OcrServiceError(
                ClassifiedOcrError(
                    OcrErrorClass.RATE_LIMIT,
                    429,
                    True,
                    0.01,
                    "gemini",
                    DEFAULT_PRIMARY_MODEL,
                    "busy",
                    "rpm",
                )
            )
        return json.dumps({"rows": [{"lot_serial_no": 1}]}), DEFAULT_PRIMARY_MODEL

    async def _run():
        ocr_mod._gemini_sem = asyncio.Semaphore(1)
        with patch.dict("os.environ", {**ENV, "OCR_MAX_CONCURRENT": "1"}):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=flaky):
                    with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                        return await extract_with_resilience(
                            image_b64="x" * 50,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="s1",
                        )

    result = asyncio.run(_run())
    assert result.provider == "gemini"
    assert n["c"] == 2


def test_provider_503_high_demand_rotates_model():
    models_seen: list[str] = []

    def by_model(image_b64, mime_type, hint, api_key, system_prompt, model=None):
        models_seen.append(model or DEFAULT_PRIMARY_MODEL)
        if (model or DEFAULT_PRIMARY_MODEL) == DEFAULT_PRIMARY_MODEL:
            raise OcrServiceError(
                ClassifiedOcrError(
                    OcrErrorClass.TEMP_UNAVAILABLE,
                    503,
                    True,
                    0.01,
                    "gemini",
                    DEFAULT_PRIMARY_MODEL,
                    "busy",
                    "The model is overloaded due to high demand",
                )
            )
        return json.dumps({"rows": []}), model or DEFAULT_FALLBACK_MODEL

    async def _run():
        ocr_mod._gemini_sem = asyncio.Semaphore(1)
        with patch.dict("os.environ", {**ENV, "OCR_MAX_RETRIES": "2"}):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=by_model):
                    with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                        return await extract_with_resilience(
                            image_b64="x" * 50,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="s1",
                        )

    result = asyncio.run(_run())
    assert result.provider == "gemini"
    assert DEFAULT_PRIMARY_MODEL in models_seen
    assert any(m != DEFAULT_PRIMARY_MODEL for m in models_seen)


def test_slow_provider_queues_second_request():
    order: list[str] = []

    def slow(*a, **k):
        order.append("provider_enter")
        time.sleep(0.08)
        order.append("provider_exit")
        return json.dumps({"rows": []}), DEFAULT_PRIMARY_MODEL

    async def _run():
        ocr_mod._gemini_sem = asyncio.Semaphore(1)
        with patch.dict("os.environ", {**ENV, "OCR_MAX_CONCURRENT": "1", "OCR_MAX_RETRIES": "1"}):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=slow):
                    with patch("ocr_service.optimize_ocr_image_b64", side_effect=lambda b, m: (b, m)):
                        await asyncio.gather(
                            extract_with_resilience(
                                image_b64="a" * 50,
                                mime_type="image/jpeg",
                                hint=None,
                                system_prompt="sys",
                                parse_diary_text=lambda t: [],
                                shop_id="a",
                            ),
                            extract_with_resilience(
                                image_b64="b" * 50,
                                mime_type="image/jpeg",
                                hint=None,
                                system_prompt="sys",
                                parse_diary_text=lambda t: [],
                                shop_id="b",
                            ),
                        )

    asyncio.run(_run())
    # Strict serialization under max_concurrent=1.
    assert order == ["provider_enter", "provider_exit", "provider_enter", "provider_exit"]
