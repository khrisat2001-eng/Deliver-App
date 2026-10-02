# @ride/i18n

Single source of truth for every user-facing string in the Passenger app, Driver app, Admin dashboard,
and server-side notifications (push / SMS / email).

- `locales/<locale>.json` — flat keys grouped by prefix (`common.`, `auth.`, `trip.`, `notify.` …).
- `locales/meta.json` — direction (RTL/LTR) and display name per locale.
- `en.json` is the reference: every key must exist there. Missing keys in other locales fall back to `ar`, then `en`.
- Placeholders use `{name}` syntax.

Locales: `ar` (Arabic, RTL), `en` (English, LTR), `ckb` (Kurdish Sorani, RTL). `kmr` (Kurmanji/Badini) is planned for Duhok.

Run `node check.mjs` to verify all locales have the same keys and placeholders.
