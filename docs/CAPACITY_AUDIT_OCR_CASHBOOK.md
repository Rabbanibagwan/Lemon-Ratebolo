# Lemon Mandi — Multi-Merchant Concurrency / OCR / Cash Book Capacity Audit

**Branch:** `cursor/capacity-ocr-cashbook-audit-80c6`  
**Scope:** Lemon Mandi only (no RateCAD / RateBolo Construction)  
**Date:** 2026-10-12  
**APK/iOS build:** NOT REQUESTED  

---

## A. Actual live architecture

| Layer | Evidence |
| --- | --- |
| Frontend | Expo / React Native (`frontend/`), Expo Router screens including `/cash-book`, `/ocr` |
| Live backend URL | `https://lemon-ratebolo.onrender.com` (`frontend/eas.json` → `EXPO_PUBLIC_BACKEND_URL`) |
| Hosting | **Render** (response header `x-render-origin-server: uvicorn`; Cloudflare in front). Exact Render plan / CPU / RAM: **UNKNOWN** (no Render API token or dashboard access in this environment) |
| Backend framework | FastAPI (`backend/server.py`), ASGI via **uvicorn** |
| Database | MongoDB via **Motor** (`AsyncIOMotorClient`). URL from env `MONGO_URL` (not printed). TLS pinned with certifi for Atlas/SRV. Timeouts: serverSelection 30s, connect/socket 20s. `maxPoolSize` not overridden → Motor/PyMongo default (typically 100). Atlas tier: **UNKNOWN** without project access |
| Auth | JWT bearer; `shop_id` in token; owner vs staff roles (`current_user` / `owner_only`) |
| OCR endpoints (live OpenAPI) | `/api/ocr/status`, `/api/ocr/metrics`, `/api/ocr/action-diary`, `/api/ocr/jobs`, `/api/ocr/jobs/{job_id}`, `/api/ocr/action-diary-text` |
| OCR models (code defaults) | Primary `gemini-2.5-flash` → fallback `gemini-2.5-flash-lite` → `gemini-3.5-flash-lite`; obsolete 1.5/2.0 models skipped; optional Vision text fallback |
| OCR concurrency | Process-wide `asyncio.Semaphore`, `OCR_MAX_CONCURRENT` default **2**; Gemini via blocking `requests` in `asyncio.to_thread`; per-model retries `OCR_MAX_RETRIES` default 3; Gemini timeout default 180s |
| Cash Book API | **None.** Live OpenAPI `cash_paths: []`. Store is device AsyncStorage only (`frontend/src/utils/cash-book-store.ts`) |
| Farmer Patti / Vendor Bill | Indexed by `shop_id` (+ day/vendor). Routes under `/api/pattis*`, `/api/vendor-bills*` (OpenAPI counts: 11 patti-related, 6 vendor-bill-related) |
| Queues / workers | No external queue (Redis/Celery/etc.). OCR jobs are **in-memory** process-local (`_JOBS` dict) + optional `asyncio.create_task` for `/ocr/jobs` |
| Warm latency (probe) | `/docs` ~0.22–0.68s; unauth `/api/ocr/status` → 401 ~0.62s; invalid-token `/api/auth/me` → 401 ~0.27–0.67s |

**Registered vs active vs simultaneous:**  
- **Registered merchants** = shops in Mongo (not counted here).  
- **Active users** = users who open the app in a period.  
- **Simultaneously active** = overlapping in-flight API/OCR work. Capacity claims must use simultaneous load, not registered count.

---

## B. Evidence for the Cash Book / OCR incident

| Question | Finding |
| --- | --- |
| Historical Render / Atlas / Gemini logs for the incident window | **Unavailable** in this environment (no Render/Atlas credentials; process metrics are in-memory and reset on deploy) |
| HTTP 429 / 503 / 5xx / DB pool exhaustion at that time | **UNKNOWN** — cannot invent |
| Could Cash Book writes hit the backend? | **No** — confirmed by code + live OpenAPI (zero cash-book paths) |
| Could Cash Book activity contend on Mongo with OCR? | **No** — Cash Book does not touch Mongo |
| Could shared Gemini quota / `OCR_MAX_CONCURRENT=2` delay OCR? | **Architecturally yes** for concurrent OCR from any merchants sharing the same backend process + API key — independent of Cash Book |
| Temporal correlation (OCR improved when Cash Book stopped) | Observed by user; **not causal evidence** given local-only Cash Book |

---

## C. Root cause of the past incident

**UNKNOWN** (insufficient historical telemetry).

**Ruled out as a direct backend cause:** Cash Book HTTP/DB load (there is none).

**Plausible independent causes (not proven for that day):** Gemini 429/503 / high-demand; process-wide OCR semaphore saturation; client+server retry multiplication (mitigated in this PR); Render single-process cold/CPU limits (plan unconfirmed).

---

## D. Backend / database / OCR bottlenecks (code + probes)

1. **OCR provider concurrency gate (confirmed):** default max **2** Gemini calls process-wide. Extra OCR requests wait on the semaphore.  
2. **Semaphore held during backoff (confirmed bug, fixed):** retries slept **inside** `async with sem`, blocking peer OCR for up to tens of seconds. Regression test: `test_backoff_releases_concurrency_slot`.  
3. **Shared Gemini API key (confirmed in code):** all shops use server env key → shared provider RPM/RPD.  
4. **Blocking HTTP in thread pool:** `call_gemini_vision` uses sync `requests` with up to 180s timeout via `to_thread`.  
5. **Client retries multiplied provider load (confirmed, mitigated):** capture screen previously retried up to 3 full server extracts; now network-only, max 1, skipped when server already returned `attempts`.  
6. **Cash Book local races (confirmed, mitigated):** rapid double-tap could enqueue duplicate local writes; UI `savingRef` + store `withCashBookLock`.  
7. **No external OCR queue:** intentional; in-process semaphore provides bounded concurrency.  
8. **Hosting/DB plan limits:** **UNKNOWN** without provider dashboards — do not guess free-tier vs paid.

Merchant isolation: OCR jobs filtered by `job.shop_id`; Mongo indexes include `shop_id` on farmers/vendors/lots/pattis/vendor_bills/ledger. No schema changes made.

---

## E. Load-test setup

| Item | Detail |
| --- | --- |
| Production aggressive load | **Not run** (policy) |
| Isolated harness | `backend/tests/test_ocr_capacity_harness.py` — mocked Gemini, no network |
| Stages | Concurrent extracts: 1, 5, 10, 25 with `OCR_MAX_CONCURRENT=2`, synthetic provider latency 50ms |
| Scenario A (multi Cash Book API) | **N/A** — no Cash Book API; local store verified by `frontend/scripts/verify-cash-book-local.ts` |
| Scenario B (Cash Book + OCR backend contention) | **Architecturally impossible** on server path |
| Scenario C/D full stack on prod | **Not run** |
| Live smoke | Auth 401 latency only (no authenticated OCR against live Gemini) |

---

## F. Tested concurrency and measured latency

### Isolated OCR gate (mocked provider, `OCR_MAX_CONCURRENT=2`, 50ms fake Gemini)

| Concurrent extracts | Success | Fail | Provider in-flight max | Median ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 1 | ~52 | ~52 | ~52 |
| 5 | 5 | 0 | 2 | ~103 | ~144 | ~152 |
| 10 | 10 | 0 | 2 | ~154 | ~255 | ~255 |
| 25 | 25 | 0 | 2 | ~355 | ~608 | ~647 |

**Interpretation:** These measure **queueing behind the local semaphore** under a tiny fake provider delay. They are **not** live Gemini latency and **not** “25 merchants supported in production.”

### Live ordinary API (unauthenticated smoke)

| Call | HTTP | Approx latency |
| --- | --- | --- |
| `GET /docs` | 200 | ~0.22–0.68s |
| `GET /api/ocr/status` (no token) | 401 | ~0.62s |
| `GET /api/auth/me` (bad token) | 401 | ~0.27–0.67s |

**p95 for authenticated business APIs / live OCR:** **UNTESTED** (no load credentials / no prod load test).

### Unit / regression

- `tests/test_ocr_resilience.py` + harness: **30 passed** (including backoff slot release).  
- `npx tsx scripts/verify-cash-book-local.ts`: **PASS**.

---

## G. Estimated sustainable capacity and limitations

| Claim type | Statement |
| --- | --- |
| **Tested** | Process OCR gate caps provider calls at `OCR_MAX_CONCURRENT` (default 2). Concurrent extract *requests* can be higher; they queue. Harness showed 25 queued extracts succeed with mocked 50ms provider when max concurrent = 2. |
| **Estimated (not load-proven)** | Sustainable **simultaneous OCR provider calls** ≈ configured semaphore (default **2**) per backend process, further limited by Gemini quota. Sustainable **Cash Book writers on server** = N/A (local). Ordinary JWT API concurrency limited by Render instance + Atlas pool — **not measured**. |
| **Untested** | Real multi-merchant Cash Book+OCR field mix; 50 concurrent live users; Atlas connection saturation; Render CPU/memory ceilings; Gemini paid-tier RPM. |

**Do not equate:** registered shops ≠ simultaneous OCR slots.

**Headroom before instability (OCR):** once >2 OCR provider calls needed at once, wait time ≈ queue depth × provider latency (often multi-second to multi-minute with real Gemini + fallbacks). After the backoff fix, waiting jobs are no longer blocked by another job’s sleep.

---

## H. Fixes implemented and tests passed

1. **OCR:** Release concurrency semaphore during retry backoff; log `req=` + `queue_wait_ms`.  
2. **OCR client:** Bound retries — transport/network only; skip when server returned `attempts`; no TIMEOUT auto-retry.  
3. **Cash Book UI:** `savingRef` double-tap guard.  
4. **Cash Book store:** `withCashBookLock` serializes local read-modify-write.  
5. **Tests:** `test_backoff_releases_concurrency_slot`; capacity harness; cash-book local verify script; architectural no `/cash-book` API guard.  
6. **Preserved:** Gemini model fallback chain defaults; no accounting/ownership rule changes; no RateCAD/Construction edits.

**Not done (intentionally):** hosting upgrade, Redis OCR queue, schema migrations, production load blast, APK.

---

## I. Remaining risks and recommended next steps

1. Enable **Render + Atlas + Gemini** log retention and correlate next OCR failure (request id / `queue_wait_ms` / provider 429).  
2. Confirm Render plan (CPU/RAM/instances) and Atlas tier in the dashboard; record limits in this doc.  
3. Optional: authenticated **staging** load test (Scenarios C/D) with a dedicated Gemini key — not production.  
4. If simultaneous OCR regularly exceeds 2, raise `OCR_MAX_CONCURRENT` only after measuring Gemini RPM and Render CPU.  
5. When a real Cash Book **backend** is added, re-run contention tests; today there is no server path.

**Cost estimates:** omitted — no reliable public quote tied to the unknown current plan.

---

## J. Branch / commit / push

See git commit on `cursor/capacity-ocr-cashbook-audit-80c6` after push (SHA filled in PR).

---

## Copy block

```
LEMON MANDI CAPACITY AUDIT
Cash Book → backend: NO (local AsyncStorage only)
Live API: https://lemon-ratebolo.onrender.com (Render + uvicorn + Motor/Mongo)
OCR chain: gemini-2.5-flash → 2.5-flash-lite → 3.5-flash-lite (+ optional Vision)
OCR_MAX_CONCURRENT default: 2 (process-wide)
Incident Cash Book↔OCR causality: UNKNOWN (no historical logs); direct DB contention ruled out
Fix: OCR semaphore no longer held during backoff; client retries bounded; Cash Book double-save lock
Load test on production: NOT RUN
Isolated OCR harness: 1/5/10/25 queued extracts OK with mocked 50ms provider @ max_concurrent=2
APK: NOT REQUESTED
```
