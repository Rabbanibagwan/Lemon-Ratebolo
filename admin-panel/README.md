# Lemon Mandi — Platform Admin Panel (v1)

Vite + React + TypeScript SPA for platform operators.

## Setup

```bash
cd admin-panel
cp .env.example .env
npm install
npm run dev
```

Set `VITE_API_BASE_URL` to the FastAPI backend (default Render URL).

## Backend requirements

Deployed API must expose `/api/admin/*` and have env:

- `PLATFORM_ADMIN_JWT_SECRET`
- `PLATFORM_ADMIN_BOOTSTRAP_USERNAME`
- `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` (min 8 chars, first admin only)

Legacy `X-Admin-Key` still works during migration.

## Production

Build static assets:

```bash
npm run build
```

Host `dist/` on a **Lemon-only** origin. Do **not** overwrite the existing
`https://admin.ratebolo.com` CRA app (Apache / Ratebolo) — that host currently
serves the separate RateBolo Construction admin and must not be modified.

Recommended Lemon hosts (pick one):

- New subdomain (e.g. `lemon-admin.ratebolo.com`) pointing at this `dist/`
- Or a dedicated Render Static Site for `admin-panel/dist`

Set `VITE_API_BASE_URL=https://lemon-ratebolo.onrender.com` at build time.

### Backend deploy (Render `lemon-ratebolo`)

Before or with the backend deploy of branch `cursor/admin-panel-v1-80c6`
(commit `7a6c395`+), set these **Render environment variables** (values never
committed; never shipped to the SPA):

| Variable | Required | Notes |
| --- | --- | --- |
| `PLATFORM_ADMIN_JWT_SECRET` | yes | Strong random secret; not the merchant JWT secret |
| `PLATFORM_ADMIN_BOOTSTRAP_USERNAME` | yes (first boot) | Creates first row in `platform_admins` when empty |
| `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` | yes (first boot) | Min 8 chars; hashed with bcrypt; only used once |
| `PLATFORM_ADMIN_JWT_TTL_HOURS` | no | Default `12` |

Legacy `ADMIN_API_KEY` / `BILLING_ADMIN_KEY` still accepted via `X-Admin-Key`.

### Secrets hygiene

- Secrets are **not** in git (only env var **names** in docs).
- SPA stores only the post-login JWT in `localStorage` (`lm.admin.token`).
- Bootstrap password and JWT signing secret never appear in browser bundles.