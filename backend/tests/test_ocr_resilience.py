"""Unit tests for production OCR resilience (no live Gemini required)."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import pytest

from ocr_service import (
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_FALLBACK_MODEL_2,
    DEFAULT_PRIMARY_MODEL,
    OBSOLETE_GEMINI_MODELS,
    ClassifiedOcrError,
    OcrErrorClass,
    OcrServiceError,
    call_gemini_vision,
    classify_provider_error,
    extract_with_resilience,
    model_candidates,
)

CURRENT_CHAIN = (
    DEFAULT_PRIMARY_MODEL,
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_FALLBACK_MODEL_2,
)
OBSOLETE = ("gemini-2.0-flash", "gemini-1.5-flash")


def _patch_list_models(available=None):
    """Avoid live ListModels calls during unit tests."""
    return patch("ocr_service.list_available_gemini_models", return_value=available)


def test_classify_rate_limit_429():
    c = classify_provider_error(
        status_code=429,
        body='{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for requests per minute"}}',
        provider="gemini",
        model="gemini-2.5-flash",
    )
    assert c.error_class == OcrErrorClass.RATE_LIMIT
    assert c.retryable is True


def test_classify_daily_quota_429():
    c = classify_provider_error(
        status_code=429,
        body='{"error":{"message":"GenerateRequestsPerDayPerProjectPerModel-FreeTier limit: generate_requests_per_model_per_day"}}',
        provider="gemini",
        model="gemini-2.5-flash",
    )
    assert c.error_class == OcrErrorClass.DAILY_QUOTA
    assert c.retryable is False


def test_classify_503_temp():
    c = classify_provider_error(status_code=503, body="Service Unavailable", provider="gemini", model="x")
    assert c.error_class == OcrErrorClass.TEMP_UNAVAILABLE
    assert c.retryable is True


def test_classify_404_model_unavailable():
    c = classify_provider_error(
        status_code=404,
        body='{"error":{"code":404,"message":"models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent.","status":"NOT_FOUND"}}',
        provider="gemini",
        model="gemini-1.5-flash",
    )
    assert c.error_class == OcrErrorClass.MODEL_UNAVAILABLE
    assert c.retryable is False
    assert c.http_status == 404


def test_classify_404_not_temp_unavailable():
    c = classify_provider_error(
        status_code=404,
        body='{"error":{"message":"Model is unavailable / not found","status":"NOT_FOUND"}}',
        provider="gemini",
        model="gemini-2.0-flash",
    )
    assert c.error_class == OcrErrorClass.MODEL_UNAVAILABLE
    assert c.retryable is False


def test_classify_invalid_key():
    c = classify_provider_error(
        status_code=400,
        body='{"error":{"message":"API key not valid. Please pass a valid API key."}}',
        provider="gemini",
        model="x",
    )
    assert c.error_class == OcrErrorClass.AUTH
    assert c.retryable is False


def test_classify_billing():
    c = classify_provider_error(
        status_code=403,
        body='{"error":{"message":"Billing account not configured for this project"}}',
        provider="gemini",
        model="x",
    )
    assert c.error_class == OcrErrorClass.BILLING
    assert c.retryable is False


def test_classify_quota_exceeded_not_billing():
    c = classify_provider_error(
        status_code=429,
        body='{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits"}}',
        provider="gemini",
        model="gemini-2.5-flash",
    )
    assert c.error_class == OcrErrorClass.DAILY_QUOTA
    assert c.retryable is False
    assert "billing" not in c.message.lower() or "quota" in c.message.lower()


def test_classify_retry_delay_from_body():
    c = classify_provider_error(
        status_code=429,
        body='{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"12s"}]}}',
        provider="gemini",
        model="x",
    )
    assert c.retry_after_seconds == 12.0


def test_http_payload_codes():
    err = OcrServiceError(
        ClassifiedOcrError(
            OcrErrorClass.RATE_LIMIT,
            429,
            True,
            5.0,
            "gemini",
            "gemini-2.5-flash",
            "busy",
            "snip",
        )
    )
    p = err.http_payload()
    assert p["code"] == "OCR_RATE_LIMIT"
    assert p["retryable"] is True
    assert p["status_code"] == 429


def test_http_payload_model_unavailable():
    err = OcrServiceError(
        ClassifiedOcrError(
            OcrErrorClass.MODEL_UNAVAILABLE,
            404,
            False,
            None,
            "gemini",
            "gemini-1.5-flash",
            "gone",
            "NOT_FOUND",
        )
    )
    p = err.http_payload()
    assert p["code"] == "OCR_MODEL_UNAVAILABLE"
    assert p["retryable"] is False
    assert p["status_code"] == 404


def test_extract_retries_then_succeeds():
    calls = {"n": 0}

    def fake_gemini(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise OcrServiceError(
                ClassifiedOcrError(
                    OcrErrorClass.RATE_LIMIT,
                    429,
                    True,
                    0.01,
                    "gemini",
                    "gemini-2.5-flash",
                    "busy",
                    "rpm",
                )
            )
        return (
            json.dumps(
                {
                    "rows": [
                        {
                            "lot_serial_no": 1,
                            "total_bags": 5,
                            "farmer_name": "A",
                            "vendor_name": "V",
                            "bags": 2,
                            "rate_per_bag": 1000,
                        }
                    ]
                }
            ),
            "gemini-2.5-flash",
        )

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "test-key",
                "OCR_MAX_RETRIES": "3",
                "OCR_MAX_CONCURRENT": "1",
                "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
            },
        ):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                    with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                        return await extract_with_resilience(
                            image_b64="a" * 200,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="shop1",
                        )

    result = asyncio.run(_run())
    assert calls["n"] == 3
    assert result.provider == "gemini"
    assert "rows" in result.rows_raw_text


def test_extract_falls_back_to_vision_after_429():
    def always_429(*args, **kwargs):
        raise OcrServiceError(
            ClassifiedOcrError(
                OcrErrorClass.RATE_LIMIT,
                429,
                True,
                0.01,
                "gemini",
                "gemini-2.5-flash",
                "busy",
                "rpm",
            )
        )

    def fake_vision(*args, **kwargs):
        return "1/5 ABDG (50)\nMM 2 1000"

    def parse_diary(text: str):
        return [
            {
                "lot_serial_no": 1,
                "total_bags": 5,
                "farmer_name": "ABDG",
                "vendor_name": "MM",
                "bags": 2,
                "rate_per_bag": 1000.0,
                "bhada_total": 50.0,
            }
        ]

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "test-key",
                "GOOGLE_VISION_API_KEY": "vision-key",
                "OCR_MAX_RETRIES": "1",
                "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=always_429):
                    with patch("ocr_service.call_google_vision_text", side_effect=fake_vision):
                        with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                            return await extract_with_resilience(
                                image_b64="a" * 200,
                                mime_type="image/jpeg",
                                hint=None,
                                system_prompt="sys",
                                parse_diary_text=parse_diary,
                                shop_id="shop1",
                            )

    result = asyncio.run(_run())
    assert result.provider == "vision"
    assert result.model == "vision+parser"
    data = json.loads(result.rows_raw_text)
    assert len(data["rows"]) == 1


def test_auth_error_does_not_fallback():
    def auth_fail(*args, **kwargs):
        raise OcrServiceError(
            ClassifiedOcrError(
                OcrErrorClass.AUTH,
                400,
                False,
                None,
                "gemini",
                "gemini-2.5-flash",
                "bad key",
                "invalid",
            )
        )

    vision_called = {"n": 0}

    def fake_vision(*args, **kwargs):
        vision_called["n"] += 1
        return "text"

    async def _run():
        with patch.dict(
            "os.environ",
            {"GEMINI_API_KEY": "bad", "GOOGLE_VISION_API_KEY": "vision-key", "OCR_MAX_RETRIES": "2"},
        ):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=auth_fail):
                    with patch("ocr_service.call_google_vision_text", side_effect=fake_vision):
                        await extract_with_resilience(
                            image_b64="a" * 200,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="shop1",
                        )

    with pytest.raises(OcrServiceError) as ei:
        asyncio.run(_run())
    assert ei.value.classified.error_class == OcrErrorClass.AUTH
    assert vision_called["n"] == 0


def test_concurrency_queue_serializes():
    in_flight = {"n": 0, "max": 0}

    def slow_ok(*args, **kwargs):
        in_flight["n"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["n"])
        import time

        time.sleep(0.05)
        in_flight["n"] -= 1
        return json.dumps({"rows": []}), "gemini-2.5-flash"

    async def _run():
        import ocr_service as mod

        mod._gemini_sem = asyncio.Semaphore(1)
        with patch.dict("os.environ", {"GEMINI_API_KEY": "k", "OCR_MAX_CONCURRENT": "1", "OCR_MAX_RETRIES": "1"}):
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=slow_ok):
                    await asyncio.gather(
                        extract_with_resilience(
                            image_b64="a" * 200,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="s1",
                        ),
                        extract_with_resilience(
                            image_b64="b" * 200,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="s2",
                        ),
                    )

    asyncio.run(_run())
    assert in_flight["max"] == 1


def test_call_gemini_vision_classifies_503(monkeypatch):
    class FakeResp:
        status_code = 503
        text = "unavailable"
        headers = {}

        def json(self):
            return {}

    monkeypatch.setenv("GEMINI_OCR_MODEL", "gemini-2.5-flash")
    with patch("requests.post", return_value=FakeResp()):
        with pytest.raises(OcrServiceError) as ei:
            call_gemini_vision("abc", "image/jpeg", None, "test-key", "sys")
    assert ei.value.classified.error_class == OcrErrorClass.TEMP_UNAVAILABLE


def test_call_gemini_vision_classifies_404_model_unavailable(monkeypatch):
    class FakeResp:
        status_code = 404
        text = '{"error":{"code":404,"message":"models/gemini-2.0-flash is not found","status":"NOT_FOUND"}}'
        headers = {}

        def json(self):
            return {"error": {"code": 404, "status": "NOT_FOUND"}}

    monkeypatch.setenv("GEMINI_OCR_MODEL", "gemini-2.0-flash")
    with patch("requests.post", return_value=FakeResp()):
        with pytest.raises(OcrServiceError) as ei:
            call_gemini_vision("abc", "image/jpeg", None, "test-key", "sys", model="gemini-2.0-flash")
    assert ei.value.classified.error_class == OcrErrorClass.MODEL_UNAVAILABLE
    assert ei.value.classified.retryable is False


def test_404_does_not_retry_same_model_rotates_to_fallback():
    """404 model-not-found must not retry the same model; rotate once to next candidate."""
    calls: list[str] = []

    def fake_gemini(image_b64, mime_type, hint, api_key, system_prompt, model=None):
        calls.append(model or "")
        if model == DEFAULT_PRIMARY_MODEL:
            raise OcrServiceError(
                classify_provider_error(
                    status_code=404,
                    body='{"error":{"code":404,"message":"models/gemini-2.5-flash is not found","status":"NOT_FOUND"}}',
                    provider="gemini",
                    model=model,
                )
            )
        return json.dumps(
            {"rows": [{"lot_serial_no": 1, "total_bags": 1, "farmer_name": "X", "vendor_name": "Y", "bags": 1, "rate_per_bag": 10}]}
        ), model or "ok"

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "k",
                "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
                "OCR_MAX_RETRIES": "5",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            import ocr_service as mod

            mod._gemini_sem = asyncio.Semaphore(1)
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                    with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                        return await extract_with_resilience(
                            image_b64="a" * 200,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="shop1",
                        )

    result = asyncio.run(_run())
    assert calls.count(DEFAULT_PRIMARY_MODEL) == 1  # no infinite / multi retry on 404
    assert DEFAULT_FALLBACK_MODEL in calls
    assert result.model == DEFAULT_FALLBACK_MODEL
    assert all(m not in OBSOLETE for m in calls)


def test_high_demand_503_rotates_to_valid_fallback():
    """503 high-demand: brief retry then rotate to gemini-2.5-flash-lite (not obsolete models)."""
    calls: list[str] = []

    def fake_gemini(image_b64, mime_type, hint, api_key, system_prompt, model=None):
        calls.append(model or "")
        if model == DEFAULT_PRIMARY_MODEL:
            raise OcrServiceError(
                classify_provider_error(
                    status_code=503,
                    body='{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}',
                    provider="gemini",
                    model=model,
                )
            )
        return json.dumps(
            {"rows": [{"lot_serial_no": 1, "total_bags": 1, "farmer_name": "X", "vendor_name": "Y", "bags": 1, "rate_per_bag": 10}]}
        ), model or "ok"

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "k",
                "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
                "OCR_MAX_RETRIES": "2",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            import ocr_service as mod

            mod._gemini_sem = asyncio.Semaphore(1)
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                    with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                        return await extract_with_resilience(
                            image_b64="a" * 200,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=lambda t: [],
                            shop_id="shop1",
                        )

    result = asyncio.run(_run())
    assert calls[0] == DEFAULT_PRIMARY_MODEL
    assert DEFAULT_FALLBACK_MODEL in calls
    assert result.model == DEFAULT_FALLBACK_MODEL
    assert all(m not in OBSOLETE for m in calls)
    assert all(m not in OBSOLETE_GEMINI_MODELS for m in calls)


def test_model_candidates_current_chain_only():
    with patch.dict(
        "os.environ",
        {
            "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
            "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
            "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
        },
        clear=False,
    ):
        with _patch_list_models(None):
            models = model_candidates()
    assert models[:3] == list(CURRENT_CHAIN)
    for obsolete in OBSOLETE:
        assert obsolete not in models
    for obsolete in OBSOLETE_GEMINI_MODELS:
        assert obsolete not in models


def test_model_candidates_skips_obsolete_env_fallback():
    """If Render still has shutdown fallback env vars, they must be ignored."""
    with patch.dict(
        "os.environ",
        {
            "GEMINI_OCR_MODEL": "gemini-2.5-flash",
            "GEMINI_OCR_FALLBACK_MODEL": "gemini-2.0-flash",
            "GEMINI_OCR_FALLBACK_MODEL_2": "gemini-1.5-flash",
            "GEMINI_OCR_MODEL_CHAIN": "gemini-2.0-flash,gemini-1.5-flash",
        },
        clear=False,
    ):
        with _patch_list_models(None):
            models = model_candidates()
    assert "gemini-2.0-flash" not in models
    assert "gemini-1.5-flash" not in models
    assert models[0] == "gemini-2.5-flash"
    assert DEFAULT_FALLBACK_MODEL in models
    assert DEFAULT_FALLBACK_MODEL_2 in models


def test_model_candidates_filters_via_list_models():
    available = {DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODEL}  # 3.5 lite not listed
    with patch.dict(
        "os.environ",
        {
            "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
            "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
            "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
        },
        clear=False,
    ):
        with _patch_list_models(available):
            models = model_candidates(api_key="real-key")
    assert models == [DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODEL]
    assert DEFAULT_FALLBACK_MODEL_2 not in models


def test_high_demand_payload_message():
    c = classify_provider_error(
        status_code=503,
        body='{"error":{"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
        provider="gemini",
        model="gemini-3.6-flash",
    )
    err = OcrServiceError(c)
    p = err.http_payload()
    assert p["high_demand"] is True
    assert "high demand" in p["message"].lower()
    assert p["code"] == "OCR_TEMP_UNAVAILABLE"


def test_flaky_primary_demoted_so_first_call_uses_stable():
    calls: list[str] = []

    def fake_gemini(image_b64, mime_type, hint, api_key, system_prompt, model=None):
        calls.append(model or "")
        return json.dumps(
            {"rows": [{"lot_serial_no": 1, "total_bags": 1, "farmer_name": "X", "vendor_name": "Y", "bags": 1, "rate_per_bag": 10}]}
        ), model or "ok"

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "k",
                "GEMINI_OCR_MODEL": "gemini-3.6-flash",
                "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
                "OCR_MAX_RETRIES": "1",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            import ocr_service as mod

            mod._gemini_sem = asyncio.Semaphore(1)
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                    return await extract_with_resilience(
                        image_b64="a" * 200,
                        mime_type="image/jpeg",
                        hint=None,
                        system_prompt="sys",
                        parse_diary_text=lambda t: [],
                        shop_id="shop1",
                    )

    result = asyncio.run(_run())
    assert calls[0] == DEFAULT_PRIMARY_MODEL
    assert result.model == DEFAULT_PRIMARY_MODEL
    assert "gemini-3.6-flash" not in calls[:1]
    assert all(m not in OBSOLETE for m in calls)


def test_429_uses_only_current_fallback_chain():
    """On 429, rotate only through current multimodal models — never obsolete ones."""
    calls: list[str] = []

    def always_429(image_b64, mime_type, hint, api_key, system_prompt, model=None):
        calls.append(model or "")
        raise OcrServiceError(
            ClassifiedOcrError(
                OcrErrorClass.RATE_LIMIT,
                429,
                True,
                0.01,
                "gemini",
                model,
                "busy",
                "rpm",
            )
        )

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "k",
                "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
                "GEMINI_OCR_FALLBACK_MODEL_2": DEFAULT_FALLBACK_MODEL_2,
                "OCR_MAX_RETRIES": "1",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            import ocr_service as mod

            mod._gemini_sem = asyncio.Semaphore(1)
            with _patch_list_models(None):
                with patch("ocr_service.call_gemini_vision", side_effect=always_429):
                    with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                        with pytest.raises(OcrServiceError) as ei:
                            await extract_with_resilience(
                                image_b64="a" * 200,
                                mime_type="image/jpeg",
                                hint=None,
                                system_prompt="sys",
                                parse_diary_text=lambda t: [],
                                shop_id="shop1",
                            )
                        return ei.value

    err = asyncio.run(_run())
    assert err.classified.error_class == OcrErrorClass.RATE_LIMIT
    assert set(calls) == set(CURRENT_CHAIN)
    assert all(m not in OBSOLETE for m in calls)


def test_successful_ocr_returns_normally():
    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "k",
                "GEMINI_OCR_MODEL": DEFAULT_PRIMARY_MODEL,
                "OCR_MAX_RETRIES": "1",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            import ocr_service as mod

            mod._gemini_sem = asyncio.Semaphore(1)
            with _patch_list_models(None):
                with patch(
                    "ocr_service.call_gemini_vision",
                    return_value=(
                        json.dumps(
                            {
                                "rows": [
                                    {
                                        "lot_serial_no": 1,
                                        "total_bags": 2,
                                        "farmer_name": "F",
                                        "vendor_name": "V",
                                        "bags": 1,
                                        "rate_per_bag": 500,
                                    }
                                ]
                            }
                        ),
                        DEFAULT_PRIMARY_MODEL,
                    ),
                ):
                    return await extract_with_resilience(
                        image_b64="a" * 200,
                        mime_type="image/jpeg",
                        hint=None,
                        system_prompt="sys",
                        parse_diary_text=lambda t: [],
                        shop_id="shop1",
                    )

    result = asyncio.run(_run())
    assert result.provider == "gemini"
    assert result.model == DEFAULT_PRIMARY_MODEL
    assert "rows" in result.rows_raw_text
