# Eny Salon

A fictional salon demo restored from Andres’s PHP coursework. Browse services, reserve an appointment, edit a customer’s booking and manage the salon’s availability in your own private workspace.

The hosted edition keeps the cream/copper/sage design and the original feature intent, using **Node.js 22, Express, EJS and a real MongoDB-compatible database**. The restored PHP + SQLite edition is preserved in [`php-original/`](php-original/) for source history and local PHP study. It is not deployed as PHP to Azure Static Web Apps.

## Explore the demo

1. Use **Find your moment** to book with fictional details. A private workspace is created for you.
2. Open **Staff workspace → Open a private demo** to explore the calendar, sample appointment, editing and messages.
3. Optionally save a fictional workspace name and a unique password to revisit it after signing out. Without saved sign-in details, signing out loses access to that workspace.

Each visitor gets separate records. There is no public password granting access to a global administrator account. Customer details, inbox messages and bookings are never shared between visitor workspaces.

**No appointment is real, no payment is taken and no email is sent.** Confirmations are stored in your demo outbox. Use fictional information only.

## Features and original project mapping

| Original PHP workflow                             | Hosted edition                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Home, About, services and contact                 | Same design and content, responsive EJS views                      |
| Week-one/week-two availability                    | Two-week calendar with Eastern Time labels                         |
| Select time, customer details, service and extras | Validated booking; server-controlled service catalog               |
| Booking confirmation and email intent             | Confirmation page and explicitly unsent outbox                     |
| Staff login/logout                                | Private demo access; optional hashed-password sign-in              |
| Appointment list/customer edits                   | Scoped list, edits and rescheduling                                |
| Reopen unavailable times                          | Block/reopen unbooked times; booked times stay reserved            |
| Original MySQL database                           | Hosted Cosmos DB MongoDB API; local disposable MongoDB             |
| Restored PHP/SQLite implementation                | Preserved in `php-original/`, not mislabeled as the hosted runtime |

Prices remain $14.99 haircut, $9.99 child/senior haircut, $5.99 shampoo, $24.99 style and $6.99 trim.

## Data lifetime and safety

A workspace has a fixed **96-hour lifetime from creation**. Every user-created appointment, contact message, outbox entry and sign-in name inherits that deadline. Editing or signing in does not renew it. Expired data is denied immediately by API reads; an hourly cleanup workflow and opportunistic API cleanup remove expired documents. GitHub scheduled jobs can run late, so physical deletion is best effort; expired records remain inaccessible meanwhile.

An immutable fictional seed template never expires. Each visitor receives a disposable copy, so editing their sample appointment does not edit the permanent seed or affect other visitors. The cleanup predicate requires `isDemo: false`, protecting permanent seeds and unclassified historical records.

Storage is bounded to **100 fixed workspace slots**, at most **50 appointments, 100 messages and 100 outbox entries per workspace**, with a 220 KB document limit. Fixed IDs and atomic compare-and-swap enforce capacity and prevent duplicate booking across simultaneous requests. A replacement workspace receives a new generation ID; old sessions cannot access a recycled slot.

Sessions use random tokens with only their SHA-256 hashes stored in the database, HttpOnly/SameSite=Strict cookies and Secure cookies in Azure. Only one session is active per workspace, for at most eight hours and never beyond workspace expiry. Passwords use salted scrypt (`N=65536, r=8, p=2`). CSRF, same-origin checks, server-side validation, output escaping, security headers and request/login limits are enforced.

## Run locally

Use Node.js 22.22+ within Node 22 (or a supported newer runtime).

```sh
npm ci
npm run demo:local
```

The local demo launches a disposable MongoDB process with fictional data and binds to `127.0.0.1:4360`. It does not use Azure credentials. If MongoDB is already available, set `MONGOMS_SYSTEM_BINARY` to its executable to avoid a download.

For a persistent database, copy `.env.example` to a private `.env`, set `MONGODB_URI` and a random `SESSION_SECRET` of at least 32 characters, then run:

```sh
ALLOW_SCHEMA_PREPARE=true node --env-file=.env scripts/prepare-db.js
npm start
```

Never commit `.env` or put a database credential in the frontend. Run schema preparation against Azure only after backup and capacity checks.

## Verify

```sh
npm test
npm audit --omit=dev
npm run package:azure
```

The integration suite uses disposable MongoDB. It covers server rendering, headers, CSRF, cross-site rejection, durable sessions, booking, validation, escaping, simultaneous booking, cross-visitor isolation, edits/rescheduling, availability, contact/outbox, password sign-in, username collision, fixed expiration, atomic capacity, generation reuse, storage caps, seed-safe cleanup and request bounds.

## Azure deployment

- Azure Static Web Apps **Free**, included managed Node.js 22 Functions.
- Existing Cosmos DB MongoDB API database `portfolio-demos`, collection **`eny_demo`**, sharing the existing database throughput. No dedicated collection throughput is required.
- Server app settings: `MONGODB_URI` (least-privilege role restricted to this collection), `MONGODB_DATABASE=portfolio-demos`, random `SESSION_SECRET`.
- Indexes: `{kind:1,expiresAt:1}`, `{kind:1,workspaceId:1,generation:1}`, `{isDemo:1,expiresAt:1}`, plus `_id`.
- CI checks and packaging are automatic. Deployment requires repository variable `AZURE_DEPLOY_ENABLED=true` and the `azure` environment secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- Hourly retention requires variable `DEMO_CLEANUP_ENABLED=true` and environment secret `DEMO_CLEANUP_MONGODB_URI`, scoped to `eny_demo`.
- `DEMO_MAINTENANCE=true` temporarily stops the API and cleanup for a verified maintenance/backup window.

The package allowlist excludes the original PHP code, local scripts/tests, credentials and Git history. App health verifies a real database ping. Do not upgrade the subscription, remove its spending limit, add a paid App Service plan, allocate new RU/s or create paid logging resources for this demo. Public/free GitHub Actions are used; scheduled cleanup can be delayed or disabled after repository inactivity, and request-time expiry remains authoritative.

## Provenance

Original: [`GrimSyntaxCloud/php_git_folder/PortfolioProjectPHP`](https://github.com/GrimSyntaxCloud/php_git_folder/tree/6563e649db7d7fac2268f3508bb5e6f6ed20e838/PortfolioProjectPHP), commit `6563e649db7d7fac2268f3508bb5e6f6ed20e838`. Restored with AI assistance in 2026. This is a modernized coursework project, not an untouched historical extraction or a real operating salon. No original customer records, SQL exports, connection files or uncertain image assets are included.
