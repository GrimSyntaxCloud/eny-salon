# Eny Hair Salon — restored PHP coursework

A fictional neighborhood salon with a real server-rendered booking workflow. The redesign uses cream, copper and sage, oversized editorial typography, original SVG salon artwork and responsive forms. No font CDNs, paid assets or third-party UI libraries.

## Run locally

Requires PHP 8.3+ with PDO SQLite and sessions. Tested with the real PHP 8.5.10 engine supplied by official WordPress `@php-wasm/cli` 3.1.60 in an isolated local installation.

```sh
export SALON_ADMIN_PASSWORD='choose-a-new-local-password'
php setup.php
php -d display_errors=0 -S 127.0.0.1:4340 -t public
```

Choose a unique password of at least 12 characters. Setup hashes it into the local database and refuses to overwrite an existing database. Optional `SALON_DB_PATH` selects a different SQLite file outside the public directory. Never point the web root at the project root. `storage/` must be writable by PHP and inaccessible over HTTP.

The staff workspace uses this password; there is no username. The current review server has a separate fictional local-only password supplied in the parent review notes, not a production credential.

## What works

- Homepage, About, service menu and contact form.
- Two-week appointment availability, customer details, service choice and optional extras.
- A database transaction reserves a time once and creates the booking and confirmation outbox entry together. Stale or already reserved times are rejected.
- Confirmation page is limited to the booking created in the current session.
- Staff login/logout, appointment list, edit customer/service details, reschedule into another available time, block/reopen unbooked slots.
- Contact messages and confirmation messages are visible in the staff inbox/outbox.
- Original prices: haircut $14.99, child/senior haircut $9.99, shampoo $5.99, style $24.99, trim $6.99.

## Intentional demo differences

This is a modernized recovery, not a copy of the original runtime. The original MySQL schema was replaced with a local SQLite schema; no old database records or credentials were imported. Fixed December 2017 dates became a two-week window relative to setup. The original duplicated week tables became a single slots table with unique dates/times. Staff edits preserve the reservation invariant.

**No actual email is sent.** Booking confirmation and contact workflows are retained with a local outbox/inbox instead of PHP `mail()`. The UI says this explicitly. SMTP delivery is a separate deployment decision; do not promise live email without implementing and testing an approved free provider.

This local demo is not yet a publicly deployed service. It has no automatic 96-hour cleanup job, rate limit for public booking/contact submissions, SMTP service or production backup scheduler. Availability is initialized at setup; a long-running public deployment needs an explicit rolling schedule or staff time-creation UI. These are documented deployment tasks, not claimed completed features. Do not deploy a static fake booking form to GitHub Pages.

## Security work

Prepared statements, output escaping, server-side validation, CSRF on every state-changing form, hashed staff password, session ID rotation, private session storage, HttpOnly/SameSite cookies, login throttling, security headers and a strict public document root. Public demo data should always be fictional. Existing remote credentials in historical source are not reused; this work does not revoke those credentials.

## Validation

`tests/http_test.py` exercises booking, validation, CSRF, stored-output escaping, duplicate-booking protection, staff authentication/access control, edits/rescheduling, contact/outbox, reserved-slot protection and logout against localhost. The test currently expects the review-only password; set up a disposable database before running it. Tests create fictional records. Mobile booking was additionally completed in the browser at 390px, with no page overflow. Desktop and mobile screenshots are in the parent `php/` folder.

## Provenance

Recovered from `GrimSyntaxCloud/php_git_folder`, `PortfolioProjectPHP`, commit `6563e649db7d7fac2268f3508bb5e6f6ed20e838`.

The original repository and its history are preserved. This extracted edition reimplements the original feature workflows in current PHP with a new UI and schema. It does not contain original connection files, SQL dumps, customer records or uncertain image assets. The original PHP/student-project identity remains explicit.
