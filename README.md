# Restaurant orders

Waiters take orders and send them to the kitchen, cooks mark dishes ready, waiters settle the bill, managers
maintain the menu and look at revenue. English and Ukrainian UI.

- **API** — NestJS (`apps/api`), PostgreSQL 16 + Drizzle (`packages/db`)
- **Web** — Next.js 15 (App Router), React 19, TanStack Query, React Hook Form, Zod, Tailwind + shadcn/ui,
  next-intl, organised as Feature-Sliced Design (`apps/web`)
- **Shared** — Zod schemas, money math, business-day helpers (`packages/shared`), used by API **and** web
- **Edge** — nginx reverse proxy (`infra/nginx`)

## Run it

```bash
cp .env.example .env
docker compose up --build
```

That is the only manual step. Postgres starts, `db-init` applies the migrations and seeds the demo data (only when the
database is empty), then the API, web app and nginx start.

| What        | Where                                        |
| ----------- | -------------------------------------------- |
| Application | http://localhost:8080 (→ `/en/…` or `/uk/…`) |
| API docs    | http://localhost:8080/docs (Swagger)         |

### Demo logins

Passwords come from `.env` (`SEED_*_PASSWORD`); the defaults in `.env.example` are:

| Role    | Logins                | Password            |
| ------- | --------------------- | ------------------- |
| waiter  | `waiter1` … `waiter5` | `waiter-demo-pass`  |
| cook    | `cook1`, `cook2`      | `cook-demo-pass`    |
| manager | `manager`             | `manager-demo-pass` |

### Seed data

20 tables, 60 dishes in 11 categories (with modifier groups such as _Doneness_ — exactly 1 — and _Extras_ — 0 to 3; a few
dishes have limited stock: Lamb chops 5, Salmon 12, Chocolate fondant 8, Ribeye 20), 5 waiters, 2 cooks, 1 manager,
≈2 000 paid checks over the previous 60 days, and 5 open checks today (tables 1–5) in different kitchen states, so every
screen has something to show. The seed is deterministic and idempotent. `SEED_RESET=true` wipes and reseeds.

## Tests and checks

Prerequisites: Node 22+, pnpm (`corepack enable`), Docker.

```bash
pnpm install
docker compose up -d postgres          # tests that need a database use throw-away databases on it
pnpm lint && pnpm format && pnpm typecheck
pnpm test                              # shared, db, api (real server + real PostgreSQL), web
docker compose --profile test run --rm --build stack-tests   # black-box tests of nginx + api + postgres
pnpm --filter @app/e2e install:browsers && pnpm --filter @app/e2e test:e2e   # Playwright (stack must be up)
# the e2e tests close their own checks, so they can be re-run; to get pristine demo data again:
docker compose run --rm -e SEED_RESET=true db-init
```

CI (`.github/workflows/ci.yml`) runs lint, format, typecheck, all unit/integration tests, and — in a second job — the
stack tests and the Playwright suite against `docker compose`.

### What the tests are for

The tests try to _break_ things, not to confirm the happy path. A few examples:

- **db** — every `CHECK`/unique/FK constraint is hit directly; 50 and 200 concurrent check-number allocations with rollbacks
  must give `1…N` without a gap; 30 concurrent takers of a 5-portion dish; the seed is verified against independent SQL
  (totals, fees, payments sum, modifier rules); the 60-day report is asserted to run under 300 ms.
- **api** (a real HTTP server on a real port, real PostgreSQL):
  - a permission matrix: **every route × every role** (including anonymous) is generated from the routes' own metadata, and a
    route without access rules fails the build; IDOR and privilege-escalation attempts;
  - the **last portion** raced 25 times by two waiters; 12 concurrent sends for 5 portions; double-click on _send_;
  - **payments**: 2/5/25 identical requests at once, a response that never arrives followed by a retry, same id with different
    data, same id on another check;
  - **versions**: add-item vs. pay raced 30 times (exactly one wins, never a paid check with a surprise item);
    cancel vs. _cook starts_ raced 20 times (stock always matches the winner);
  - **50 concurrent openings** → check numbers `1…50`, with 20 failing attempts in the mix that must not burn numbers;
  - fuzzing every route with mutated bodies, random query strings, hostile ids and int32/2^53 boundary numbers — never a 5xx,
    never an internal detail in an error (this found a real bug: a price of 2 147 483 648 overflowed the `integer` column);
  - **hostile-user scenarios** — the server runs as a _separate process_ and attackers connect from distinct real source
    addresses: a 600-request flood from one address while a legitimate user from another keeps working; brute force,
    credential stuffing and password spraying; forged `X-Forwarded-For` (also directly against the API); a botnet logging in
    at once (hashing concurrency is capped); 300 half-open connections (slowloris).
- **stack tests** (inside the compose network, from many source addresses, against the real nginx): edge flood isolation,
  forged forwarding headers, login lockout through the proxy, size limits, SSE not being buffered, stream caps.
- **web** — money and plural formatting per locale (`1 234,50 ₴`, `3 позиції` / `5 позицій`), modifier min/max rules,
  totals and split identical to the server's, payment idempotency in the UI (double click, dropped connection with the same
  payment id), field-level errors, kitchen timers and the 15-minute highlight, live status updates, keyboard operation,
  and a guard that no Russian-only letters appear anywhere.
- **e2e** (Playwright, two real browser contexts): waiter → kitchen → ready visible to the waiter **without a reload**;
  split on three and payment; stop-list propagation; the last portion from two browsers at once; locale switch; report
  period in the URL.

I also checked that the tests can fail: for the critical mechanisms (stock guard, version check, payment idempotency,
cancel-vs-cook compare-and-set, global limiter, proxy trust) I temporarily broke the implementation and confirmed that the
suite went red.

## Acceptance checklist → where it is verified

| #   | Check                                                       | Verified by                                                                           |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `cp .env.example .env && docker compose up --build`         | the compose stack itself; CI jobs `stack` and `e2e` start it from scratch             |
| 2   | typecheck, lint, tests, CI                                  | `pnpm lint && pnpm format && pnpm typecheck && pnpm test`, `.github/workflows/ci.yml` |
| 3   | order with modifiers → kitchen → ready, no reload           | e2e `order-flow` (waiter page is proven not to reload), web live-status tests         |
| 4   | one portion, two simultaneous sends                         | api `concurrency` (25 rounds), db `ops`, e2e `stoplist` (two browsers)                |
| 5   | cancel before / after `cooking`                             | api `orders` + `concurrency` (cancel vs cook race), e2e `order-flow`                  |
| 6   | 7 guests, split equally on 3                                | shared `money` (property tests), api `payments`, web `local-split`, e2e `payment`     |
| 7   | double click and dropped connection on payment              | api `payments` + `concurrency`, web `payment`, e2e `payment`                          |
| 8   | add an item to a check being paid → `409`                   | api `concurrency` (30 raced rounds) and `payments`                                    |
| 9   | 50 concurrent check openings                                | api `concurrency` (with failing attempts mixed in), db `ops` (50 and 200)             |
| 10  | foreign table, cook → check, waiter → menu, direct requests | api `rbac` (every route × every role, IDOR, escalation), e2e `locale-and-access`      |
| 11  | 60-day report is fast; period from the URL                  | db `report`, api `reports.timing` (< 300 ms over HTTP), e2e report test               |
| 12  | `uk` and `en`: money and declensions                        | web `i18n`, `money`, e2e locale test                                                  |
| 13  | README matches behaviour                                    | this file was written against the tests above                                         |

## How money works

All amounts are **integer kopecks**; there is no floating point anywhere in the money path (`packages/shared/src/money.ts`,
used by the API and by the web app, so the total on the screen is computed by the same code as the server's).

- **Item price** = dish price + sum of the chosen modifiers' surcharges.
- **Bill** = items in `sent`, `cooking`, `ready`, `served`. Drafts (not yet sent) and cancelled items are not billed.
- **Service fee** = 10% of the subtotal, **rounded half up to the kopeck**, only for **6 or more guests**
  (`floor((subtotal·10 + 50) / 100)`).
- **Equal split** into _N_: `base = floor(total / N)`, the first `total mod N` parts get one extra kopeck —
  100,00 on 3 = **33,34 + 33,33 + 33,33**. The parts always add up to the total.
- **Split by guest**: every guest pays for their own items; the service fee is shared in proportion to what each guest ordered
  using the **largest-remainder method** (ties go to the lower guest number), so the parts again add up to the total exactly.
  (`amount × weight` can exceed 2^53, so that step uses `BigInt`.)
- **Change** (cash) = tendered − amount, stored with the payment. Cards are recorded by hand (no terminal integration).
- A check is `paid` when the sum of its payments equals the total; several payments are allowed. Overpaying is refused, and once any money has been taken an already-sent item can no longer be cancelled (`409 ORDER_PARTIALLY_PAID`), so the total can never drop below what was paid.
- Limits (so that every value fits Postgres `integer`): price/surcharge ≤ 100 000,00; payment/tender ≤ 20 000 000,00; a
  check's subtotal ≤ 18 000 000,00. Beyond that the API answers 400/422, never 500.

The split is a _computed view_ (`POST /orders/:id/split` does not change anything); paying a part is just a payment of that
amount. The UI marks parts as paid by comparing the running sum of parts with what has been paid.

## The last portion (stock)

- Stock is `NULL` (unlimited) or an integer ≥ 0 (`CHECK stock >= 0` in the database as a second line of defence).
- "Send to kitchen" takes portions in **one atomic statement per dish**:
  `UPDATE dishes SET stock = stock - n WHERE id = $1 AND (stock IS NULL OR stock >= n)`. The condition and the decrement
  cannot be separated, so two waiters racing for the last portion can never both win; the loser's `UPDATE` matches zero rows.
- The whole send is **one transaction** (all or nothing): if any dish is short, everything rolls back — including portions
  already taken for other dishes — and the response is `409 OUT_OF_STOCK` listing which dish and how many are left.
  Dishes are processed in id order so that two concurrent sends cannot deadlock.
- Stock reaching 0 puts the dish on the **stop-list** (`stopListed` in the API, an SSE event to everyone). Drafts of that dish
  stay on the check but are flagged "no longer available" and block _send_ until removed.
- Cancelling a `sent` item gives the portion back (`stock + 1`, only if stock is not `NULL`). Cancelling is a
  compare-and-set on the item status (`WHERE status = 'sent'`), so a cancel racing against the cook's click has exactly
  one winner, and a double cancel returns the portion once. After `cooking` cancelling is refused (`409`).
- Draft items do **not** reserve stock — the assignment decrements on _send_.

## Idempotent payments

- The client generates a **payment UUID** and sends it in the body. It is the primary key of `payments`.
- Replay rule (answered _before_ the version check, because a legitimate retry carries a version that is now stale):
  same id + same content → `200` with the original payment and `replayed: true`; same id + different content (amount,
  method, tender, label, or another check) → `422 IDEMPOTENCY_MISMATCH`.
- Two identical requests at the same moment: both try to take the check's row lock; the loser then fails the version check
  (or the primary key) and is **resolved to the winner's result** instead of an error — so a double click yields one `201`
  and one `200`.
- The web app keeps the same id while the request is "the same" (method, amount, tender, part) and generates a new one
  as soon as the cashier edits something. On a dropped connection it retries automatically with the **same** body (same id).
  The Playwright suite drops the response of a request that the server did process and checks that exactly one payment exists.

## Versions and conflicts

`orders.version` is an optimistic lock. Every mutating call (`items`, `send`, `payments`, item `DELETE`) must carry
`expectedVersion` and runs `UPDATE orders SET version = version + 1 WHERE id = $1 AND version = $2 AND status = 'open'`.
The statement also takes the row lock, so it serialises with everything else that touches the same check. Zero rows →
`409 VERSION_CONFLICT` (stale) or `409 ORDER_PAID`. A paid check is immutable: item changes, serving, and the cook's transitions are all refused with `409 ORDER_PAID`, and paid checks disappear from the kitchen queue. The web app queues mutations of one check
(TanStack Query `scope`) so that rapid clicks do not conflict with themselves, and after a conflict reloads the check
and shows a notice.

## Check numbers

`order_counters(day, last)` plus `INSERT … ON CONFLICT (day) DO UPDATE SET last = last + 1 RETURNING last`, executed in the
**same transaction** as the order insert. The row lock serialises concurrent openers; a rollback (e.g. the table already has an
open check) rolls the increment back as well, so numbers are gap-free and never repeat. `UNIQUE (day, number)` backs it up.
"Day" is the restaurant's business day in `RESTAURANT_TZ` (default `Europe/Kyiv`).

## Security

- **Sessions**: opaque 32-byte random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` + `__Host-` prefix when
  `COOKIE_SECURE=true`). Only the SHA-256 of the token is stored (`sessions` table), so logout and deactivation take effect
  immediately on the server. Passwords: `scrypt`. Login takes the same time whether or not the user exists.
- **Authorization** is on the server, per route (`@Endpoint({ access })`); a route without it is **denied**. Waiters mutate
  only their own checks, cooks see only the kitchen queue (the API does not even send them prices), only managers change the menu.
- **CSRF**: state-changing requests must come from an allowed origin (`WEB_ORIGINS` or same-origin).
- **Validation**: every input is parsed with the Zod schemas from `packages/shared` (strict — unknown keys are rejected); path ids
  are UUIDs; one error envelope `{ error: { code, message, requestId, details? } }`; bad input is `4xx`, never `5xx`.
- **Rate limiting (no Redis)**: in-process token buckets per client IP (memory-bounded LRU; IPv6 limited per /64), stricter
  limits on login per IP and per **IP + username** (never by username alone, or anyone could lock out a victim), a **fair**
  gate on concurrent password hashing (extra logins wait in a short queue; one address may use at most half of the slots and queue
  8 attempts, so a flood from one address, or a few, cannot make everyone else's login fail), and SSE connection caps. A botnet of
  many addresses can still slow logins down (each address is limited, but they add up); that is the limit of IP-based protection
  without an external service. `X-Forwarded-For` is trusted only from `TRUSTED_PROXIES` (the nginx
  container); nginx _overwrites_ the header with the real peer and adds its own edge limits, size limits and timeouts.

## Real-time

`GET /events` is Server-Sent Events. Events carry ids only; the web app invalidates exactly the cached queries they affect
(a check, the kitchen queue, tables, the menu). Events are emitted **after** the database transaction commits. After a
reconnect everything is refetched (missed events are not replayed), and when the stream is down screens fall back to polling.
nginx does not buffer the stream. Logging out closes that session's open streams. If the server answers the stream with an error
(restart, stream cap) the browser gives up for good, so the web app opens a new stream itself with a growing delay.

## Decisions on ambiguous points

- **Waiters can read other waiters' checks but cannot change, pay or serve them** (403). Managers can read checks and reports
  but cannot place orders or pay. Cooks see no checks and no prices.
- **One order row = one portion.** There is no quantity field; two portions are two rows (each has its own status, can be cancelled
  and returns its own portion).
- **Drafts are not billed**, and a check with drafts cannot be paid (`409`): send or remove them first.
- **Stock is taken on _send_, not on draft.** A draft whose dish ran out is flagged, not deleted.
- **`GET /menu`** hides archived dishes; deleting a dish is a **soft delete** because past checks refer to it. Item names, prices and
  modifiers are **snapshotted** on the check, so editing the menu never changes a bill.
- **The kitchen queue** shows items in `sent` and `cooking`, oldest first (by send time), and both stations (kitchen and bar)
  with a station filter. Items older than **15 minutes** (strictly more) are highlighted.
- **Cooks move items only `sent → cooking → ready`**; the waiter marks `ready → served` (`PATCH /orders/:id/items/:itemId`).
- **Revenue** is attributed to the business day on which the check was opened; the service fee is part of revenue; top dishes
  count billed items (cancelled and draft are excluded).
- **Reports** accept up to 60 days inclusive; `from`/`to` live in the URL (`?from=YYYY-MM-DD&to=YYYY-MM-DD`).
- **Cards** are marked by hand; there is no terminal integration.
- **nginx** is a fourth compose service (the assignment lists postgres, api, web); it gives one origin for cookies and SSE and an
  extra rate-limit layer. The API and web ports are not published.
- **Locales** `uk` and `en` only (default `en`). No Russian anywhere; a test guards against it.

## Known limits

- The rate limiter and the SSE bus live in the API process's memory (Redis and queues are forbidden by the assignment), so the API
  is designed to run as **one instance**; a restart resets counters.
- A check with **nothing to bill** (opened by mistake, or every item cancelled) is closed with `POST /orders/:id/close`, which frees
  the table; it counts as neither a sale nor a report row. There is no "void" for a check that already has billable items or payments.
- There is no way to **restore an archived dish** (no un-archive in the API or the UI); create it again.
- The split is stateless: parts are not stored per guest, payments are just amounts (optionally labelled).
- HTTPS is not terminated in this stack (set `COOKIE_SECURE=true` behind a TLS terminator).
- The Swagger UI is public.
- Rate limits are per client IP. In a restaurant all tablets usually share **one NAT address**, so the general and login limits are
  deliberately generous (`RATE_LIMIT_*` in `.env`); what stays strict is brute force on a single account (5 tries per address
  _and_ account). Tune the numbers to your venue.

## Repository layout

```
apps/api          NestJS API (the only place with classes)
apps/web          Next.js app, Feature-Sliced Design: src/{app,pages,widgets,features,entities,shared}
packages/shared   Zod schemas, money & time helpers (pure functions)
packages/db       Drizzle schema, migrations, seed, db helpers (atomic stock/number operations, report query)
infra/nginx       reverse proxy
infra/stack-tests black-box tests of the whole stack, run inside the compose network
e2e               Playwright tests
```

Everything outside `apps/api` is plain functions and data (ESLint forbids `class` there). `any` is banned, and `@ts-ignore`
needs a written reason. Import boundaries of the web app follow FSD and are enforced by ESLint (a lower layer cannot import a
higher one, and slices cannot import each other).

## Configuration

`.env.example` lists every variable. `apps/api/src/env.ts` parses and validates them with Zod: only `DATABASE_URL` has no
default; non-sensitive settings have defaults in code.
