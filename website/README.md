# Lemon Mandi — Public Website

Production public site for **Lemon Mandi** (Rbolo Info Services Private Limited).

Primary purpose: permanent HTTPS business URL for payment-gateway onboarding
(e.g. PhonePe) and public policy pages.

## Preferred production URL

`https://lemonmandi.ratebolo.com`

### Current status (as of last check)

- DNS for `lemonmandi.ratebolo.com`: **not configured** (NXDOMAIN / no A or CNAME)
- HTTPS: **not available** until DNS + Render custom domain are set
- Site source in this repo: **ready** (`website/`, builds to static `dist/`)
- PhonePe payment integration in the app: **not** included here (onboarding URL only)

## Local development

```bash
cd website
npm install
npm run dev
```

## Build

```bash
cd website
npm install
npm run build
```

Static output is written to `website/dist/`.

## Deploy (Render Static Site)

Create a **new** Render Static Site (Lemon Mandi only — do not reuse Construction hosts):

| Setting | Value |
| --- | --- |
| Repository | `Rabbanibagwan/Lemon-Ratebolo` |
| Branch | `main` (or this feature branch until merged) |
| Root directory | `website` |
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |

Suggested Render service name: `lemon-mandi-website`

### Custom domain DNS (GoDaddy / domaincontrol)

`ratebolo.com` nameservers observed: `ns73.domaincontrol.com`, `ns74.domaincontrol.com`.

Add at your DNS host for `ratebolo.com`:

| Type | Name / Host | Value / Target | Notes |
| --- | --- | --- | --- |
| CNAME | `lemonmandi` | `<your-render-static-hostname>.onrender.com` | Use the hostname Render shows after the static site is created |
| or ANAME/ALIAS | `lemonmandi` | (if your DNS supports alias to Render) | Prefer CNAME when Render provides a target |

Then in Render → Static Site → Custom Domains → add `lemonmandi.ratebolo.com` and complete HTTPS certificate provisioning.

**Do not** point this subdomain at:

- localhost / LAN IPs
- Expo preview / trycloudflare temporary tunnels
- `admin.ratebolo.com` (RateBolo Construction admin — must not be modified)
- Lemon Mandi API (`lemon-ratebolo.onrender.com`) unless intentionally serving HTML from the API (not recommended)

## Company identity (from product billing constants)

- Brand: LEMON MANDI
- Legal: Rbolo Info Services Private Limited
- GSTIN: 29AAMCR3486L1ZI
- Address: MUJAWAR MOHALLA BABALESHWAR NAKA IBRAHIM ROZA VIJAYPUR, BIJAPUR - 586101

Public support contacts used on this site:
`support@ratebolo.com` and `+91 7892026535` (official Rbolo Info Services Private Limited support number).

## Pages

- `/` Home (includes company + policy link section)
- `/about.html` — About / Business
- `/features.html`
- `/contact.html` — Contact Us (`support@ratebolo.com`, `+91 7892026535`, registered address)
- `/bag-balance.html` — Bag Balance prepaid service, pricing reference, GST
- `/payment.html` — Payment Information
- `/privacy.html` — Privacy Policy
- `/terms.html` — Terms & Conditions
- `/refund.html` — Refund & Cancellation Policy

Header and footer links are **static HTML** (not JavaScript-only) so payment-gateway crawlers can discover policy pages without executing scripts.

## PhonePe note

This website alone does **not** mean PhonePe checkout is live in the app.
Use the production URL for onboarding/policy disclosure; implement and verify the gateway separately.

Public support contacts used on this site: `support@ratebolo.com` and `+91 7892026535`
(official Rbolo Info Services Private Limited support number).
