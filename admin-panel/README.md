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

Build static assets and host at `admin.ratebolo.com`:

```bash
npm run build
```

Point the host's root to `dist/`.
