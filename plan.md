# plan.md — Restaurant orders

Source of truth: `test-assignment-9.md`. On any conflict with my own preferences, **the assignment wins**.

## 0. Working agreement

- I write code **piece by piece** and stop at each checkpoint (✋) until you say "continue".
- **Commits only per full block** (8 total, below). I never push. Each commit must be green on its own (CI runs on every commit) — so a block is committed only after its own tests pass.
- Style: classes **only** in `apps/api` (NestJS); everything else is plain functions + data (enforced by ESLint `no-restricted-syntax` on `ClassDeclaration/ClassExpression` outside `apps/api`).
- Frontend = Feature-Sliced Design.
- No `any`; `@ts-ignore` / `@ts-expect-error` only with a written reason (ESLint `ban-ts-comment` with `allow-with-description`).
- Modular blocks: each block is built **end to end and tested in isolation** (schema → code → Dockerfile/compose bits → seed → tests), so a later failure can be attributed to the layer that broke.
- Env: `.env.example` is the only place listing every variable. `apps/api/src/env.ts` parses `process.env` with Zod, applies defaults for **non-sensitive** values only; sensitive ones (DB password, session secret, seed passwords) are required, no defaults in code.

## 1. Decision on conflicts between your message and the assignment

| Your message | Assignment | Decision |
| --- | --- | --- |
| "redis" as a block example | "Forbidden: external services … Redis, queues" | **No Redis anywhere.** Rate limiting is in-process in the API (+ `limit_req` in nginx as outer layer). SSE bus is in-process. |
| nginx block | Compose = `postgres`, `api`, `web` | Add **nginx** as a 4th service (reverse proxy, single origin → cookies/SSE work, edge rate limit). It does not contradict the list. Easy to drop if you disagree. |
| "tests find bugs" | Test list in §8 | Do §8 and more (adversarial suite below). |

## 2. Repo layout

```
apps/api            NestJS (classes allowed)
apps/web            Next.js 15, React 19, FSD
packages/shared     Zod schemas, types, money & plural helpers (pure functions)
packages/db         Drizzle schema, migrations, seed, db tests   (own package = own block)
infra/nginx         nginx.conf, Dockerfile
docker-compose.yml, .env.example, README.md, plan.md, .github/workflows/ci.yml
```

pnpm workspaces, Node 22, strict TS everywhere, ESLint flat config, Prettier.

## 3. Key design decisions (also go to README)

**Money.** Integer kopecks (`bigint`-safe `number`, all < 2^53; DB `integer`/`bigint`). Pure functions in `shared/money`.
- Item price = dish price + Σ modifier surcharges. Line total = unit × qty (qty = 1 per row; one row per portion, simplest for per-item status/cancel).
- Subtotal = Σ non-cancelled items. Service fee = `round_half_up(subtotal × 10 / 100)` if `guests >= 6` (integer math: `floor((subtotal*10 + 50) / 100)`). Total = subtotal + fee.
- Equal split on N: `base = floor(total/N)`, first `total mod N` parts get +1 kopeck → 100,00/3 = 33,34 + 33,33 + 33,33.
- Split by guests: each guest's subtotal; fee distributed by **largest remainder** over guests proportionally to their subtotals; Σ parts == total always (property-tested).
- Same functions used by server and web → "screen total == server total" by construction; web tests assert this against server fixtures.

**Split is stateless**: `POST /orders/:id/split` computes parts (deterministic) and returns them; it does not mutate. Payments are amounts against the order; optional `label` (e.g. "guest 2") for UX.

**Payments.** `payments.id` = client UUID (primary key). Same id + same body → returns the original result (200, `replayed: true`); same id + different body → 422. Cash: `tendered ≥ applied`, `change = tendered − applied`; card: `amount ≤ remaining`. Order becomes `paid` in the same transaction when Σ applied == total. Paid order is immutable (any mutation → 409).

**Versioning.** `orders.version` int. Mutating endpoints require `expectedVersion`; update is `... WHERE id=? AND version=?`; 0 rows → `409`. Payment and "send" bump the version. Adding an item to an order being paid → `409`.

**Last portion.** One atomic statement per dish inside the send transaction:
`UPDATE dishes SET stock = stock - $n WHERE id=$id AND (stock IS NULL OR stock >= $n)`; 0 rows → whole send rolls back, `409 OUT_OF_STOCK`. Dish ids are processed in sorted order (no deadlocks). Cancel returns the portion (`stock + 1`, only if stock not null). Stock reaching 0 ⇒ stop-list event over SSE. Stock is decremented **on send**, not on draft (assignment).

**Order numbers.** Table `order_counters(day date primary key, last int)`; open order does `INSERT … ON CONFLICT (day) DO UPDATE SET last = last + 1 RETURNING last` **in the same transaction** as the order insert → row lock serialises, rollback leaves no gaps. Unique `(day, number)`. "Day" = restaurant timezone (`RESTAURANT_TZ`, default `Europe/Kyiv`).

**Auth.** Password hash: `scrypt` (node:crypto, no native deps). Opaque 32-byte random session token in `httpOnly`, `SameSite=Lax`, `Secure` (env-controlled) cookie; DB stores only SHA-256 of the token (`sessions` table, expiry, revocation on logout). CSRF: SameSite + `Origin` check on non-GET. Login is timing-safe (dummy hash when user not found), generic error message.

**Roles / permissions (server-side, guard + per-resource checks).**
- waiter: menu read, tables read, create orders; mutate/pay/split **only own** orders; cannot open an order on a table that has another waiter's open order.
- cook: `GET /kitchen`, `PATCH /kitchen/items/:id` only; kitchen payload has **no prices, no check totals**; no access to `/orders*`.
- manager: menu CRUD, reports, read-only on orders; cannot pay/serve.
- Unknown/foreign resource → `404` for ids you may not know exist (no existence leak), `403` for role violations.

**Item lifecycle.** `draft → sent → cooking → ready → served`; `cancelled` from `draft|sent`. Cancel `draft` = no stock effect. Cancel `sent` = stock back. From `cooking+` → `409`. Cook transitions strictly `sent→cooking→ready` (no skipping/backwards). Waiter marks `ready → served`. Items of dishes with `station=bar` go to the same kitchen screen with a station filter (assumption).

**Realtime.** SSE `/events` (in-process EventEmitter; single API replica, documented). Events: `item.changed`, `stoplist.changed`, `table.changed`. Role-filtered (cook doesn't get price/check data). Heartbeat comment every 15 s, `Last-Event-ID` not replayed → client refetches on reconnect. Web: TanStack Query invalidation from events + polling fallback.

**Errors.** One envelope: `{ error: { code, message, details?, requestId } }`. Global exception filter maps Zod errors → 400/422, everything unknown → 500 with no internals. Fuzz test asserts: malformed input never yields 5xx.

**Rate limiting (no Redis).** In-process, per client IP, bounded memory (LRU cap) so key-rotation can't OOM us.
- Global bucket per IP; stricter bucket on `/auth/login` keyed by **ip** and by **ip+username** (never by username alone → an attacker can't lock out a victim account or starve others).
- Real client IP: `TRUSTED_PROXIES` env; `X-Forwarded-For` honoured only when the socket peer is a trusted proxy (spoof test).
- `429` + `Retry-After`. SSE connection cap per IP and per user.
- nginx adds `limit_req`/`limit_conn` as an outer layer.

**Report** `GET /reports/revenue?from&to` (≤ 60 days, else 400): single SQL aggregation over `orders(status, paid_at)` index + `order_items` index; top dishes; test asserts < 300 ms on the 60-day seed.

**i18n (web).** next-intl, locales exactly `uk` + `en` (assignment §7, acceptance #12). **No Russian anywhere** (UI, seed data, errors, README). `en` is the default locale; `uk` is the required second one. Code, comments, commits and docs are in English. Locale in URL prefix. Money via `Intl.NumberFormat` (`1 234,50 ₴`, nbsp handled), plurals via ICU (`uk`: one/few/many). Period in URL search params.

**Menu delete** is soft (archived) because history references dishes.

## 4. Blocks, checkpoints, commits

Each block = one commit. ✋ = I stop and wait for your review.

### Block 1 — Foundation + shared  → commit `chore: workspace, tooling, CI, shared schemas`
1. pnpm workspace, tsconfig base, ESLint (no-any, class ban outside api, ts-comment rule), Prettier, Vitest base, CI workflow (lint, typecheck, test; Postgres service). `.gitignore`, `git init`. ✋
2. `packages/shared`: Zod schemas (roles, statuses, dish, modifier group, order, item, payment, split, errors, report query) + inferred types. ✋
3. `shared/money`: money math, service fee, equal split, guest split, format-agnostic. Tests incl. property-based (fast-check): Σparts == total for random inputs, 100.00/3 case, huge/zero/negative rejection. ✋

### Block 2 — DB (end to end)  → `feat(db): drizzle schema, migrations, seed, tests`
1. Drizzle schema: users, sessions, tables, dishes, modifier_groups, modifiers, orders, order_items, order_item_modifiers, payments, order_counters; CHECK constraints (stock ≥ 0, amounts ≥ 0, min ≤ max), FKs, indexes (report indexes). ✋
2. Generated migrations + migrate runner. ✋
3. Seed (deterministic seeded PRNG, idempotent): 20 tables, 60 dishes (categories, modifier groups), 5 waiters, 2 cooks, 1 manager, 60 days of paid orders (numbers sequential per day, totals consistent with shared money fns), a few open orders today. Passwords from `.env`. ✋
4. `packages/db/Dockerfile` (migrate+seed job), compose `postgres` + `db-init` with healthcheck; `.env.example` (db part).
5. Tests against real PG (database per test file from a template): constraints reject bad rows, migration up from empty, seed idempotent (run twice), seed invariants (no gaps in numbers, totals == Σ items+fee, paid ⇒ payments == total), concurrent counter upserts (50 parallel, no gaps/dups), stock CHECK under parallel decrements. ✋

### Block 3 — API core (env, errors, auth, rate limit)  → `feat(api): bootstrap, auth, rbac, rate limiting`
1. `env.ts` (Zod, defaults only for non-sensitive), `.env.example` extended, Nest bootstrap, Swagger `/docs` (generated from shared Zod), health, request id, logging without secrets. ✋
2. Error envelope + Zod validation pipe + exception filter. ✋
3. Auth: login/logout/me, sessions in DB, scrypt, cookies, Origin/CSRF check, RolesGuard. ✋
4. Rate limiter module (per-IP LRU token bucket, login buckets, trusted-proxy IP resolution). ✋
5. API Dockerfile (multi-stage, non-root, runs migrations awaiting `db-init`).
6. Tests — **real server on a real port, real HTTP, real PG**:
   - auth: wrong password / unknown user indistinguishable (body + timing bound), session fixation, cookie flags, logout invalidates token server-side, expired session, tampered/garbage/oversized cookie, SQL-injection strings in login, huge bodies (413), wrong content-types, prototype-pollution JSON (`__proto__`), Unicode/null-byte input.
   - **malicious-user scenario**: attacker hammers `/auth/login` and generic routes from IP A while a legit user from IP B (via `X-Forwarded-For` through a trusted proxy peer) keeps working with p95 latency bound and zero 429s; attacker rotating many fake XFF values from an untrusted peer gets no bypass; attacker rotating usernames can't lock the real victim account; memory stays bounded under millions of distinct keys; SSE connection flood capped.
   - RBAC matrix test generated from route metadata: every route × every role (+ anonymous) vs expected status — a new route without a rule fails the test.
   - Fuzz: random/malformed payloads on all endpoints never give 5xx. ✋

### Block 4 — API domain  → `feat(api): menu, orders, kitchen, payments, reports, SSE`
Pieces, each followed by ✋: (1) menu + stock + `/tables`; (2) orders open + numbering; (3) items add/remove + modifier min/max validation + versioning; (4) send + last portion + cancel/return; (5) kitchen + status machine; (6) split + payments (idempotent, change); (7) SSE; (8) reports + perf.
Tests (real PG, real server): everything in assignment §8 + acceptance 4–11:
- 2…50 parallel sends of the last portion → exactly one wins, stock ≥ 0, stop-list event emitted.
- Cancel before/after `cooking`, stock return exact, double cancel idempotent-safe (no double return).
- Same payment id ×20 in parallel and after "network drop" (retry) → one payment; same id different body → 422; overpay card → 4xx; paid order immutable.
- Add item while payment in-flight → `409`; stale `expectedVersion` → `409`.
- 50 (and 200) parallel order opens → numbers 1..N unique, gapless; failed open rolls back without burning a number.
- Cross-waiter attacks (tamper ids, IDOR on orders/items/tables), cook → orders, waiter → menu write, manager → pay.
- Money: random orders vs independent reference calc; 7 guests / split 3 case; rounding edge cases.
- Invalid modifiers (below min, above max, foreign dish's modifier, duplicate, negative qty, other guest number) → 4xx.
- Report: 60-day seed < 300 ms (warm, asserted), > 60 days → 400, matches independent SQL sum. ✋

### Block 5 — nginx + compose  → `feat(infra): nginx, compose, edge limits`
- nginx: reverse proxy `/` → web, `/api` → api, SSE-safe (`proxy_buffering off`, long read timeout), security headers, body size limit, `limit_req`/`limit_conn`, correct `X-Forwarded-For` (`$remote_addr` overwritten, never appended from client).
- compose: `postgres`, `db-init`, `api`, `web`, `nginx`; healthchecks, ordered startup; single manual step `cp .env.example .env`.
- Tests against the real compose stack: XFF spoof through nginx doesn't bypass limits, flood from one source doesn't degrade a second source, SSE works through proxy, oversized body/headers rejected, slowloris-style slow request doesn't block others, direct `api` port not exposed. ✋

### Block 6 — Web foundation  → `feat(web): FSD skeleton, i18n, auth, api client`
FSD layers in `apps/web/src`: `app / pages / widgets / features / entities / shared` (Next `app/` at root of `apps/web` is a thin router that re-exports from `src/pages`; empty root `pages/` placeholder so Next ignores `src/pages` as a Pages Router — standard FSD+Next setup). Rule enforced by ESLint (`eslint-plugin-boundaries`): lower layers can't import upper ones; no cross-slice imports.
Includes: TanStack Query provider, typed fetch client (Zod-parsed responses), next-intl (`uk`/`en`), money/plural formatting, login page, role-based route guard (UX only; server is authoritative), shadcn/ui base, SSE hook. Web Dockerfile (standalone output). Tests: money formatting & plurals per locale, api client error mapping. ✋

### Block 7 — Web features  → `feat(web): waiter, kitchen, manager screens`
1. Waiter: tables grid (free / occupied / ready dishes, live). ✋
2. Waiter: order screen (menu by category, modifier picker with min/max validation via RHF+Zod, per-guest items, comment, stop-list flags on drafts, live item statuses). ✋
3. Waiter: checkout (split equal / by guest, payments, change, client-generated payment UUID, retry-safe). ✋
4. Kitchen: queue in send order, timer, >15 min highlight, click = cooking → ready, live adds/cancels. ✋
5. Manager: menu CRUD + modifiers + stock; revenue + top dishes, period in URL. ✋
Tests (Vitest + Testing Library): total & split computation == server fixtures, modifier selection rules, form field errors, keyboard-only main path, plural/money rendering.

### Block 8 — e2e + README  → `test(e2e): playwright flows; docs: README`
- Playwright against compose stack: order → kitchen → ready visible to waiter without reload; split for 3 + payment; stop-list propagation across two browser contexts; double-click pay → one payment; uk/en switch.
- README: run & test, logins, money & rounding, last-portion mechanics, payment idempotency, versioning, rate limiting, all decisions above, known limits (single API replica for SSE/limiter).
- Final: lint + typecheck + all tests green, acceptance table 1–13 walked through with evidence. ✋

## 5. Assumptions I'm making (tell me if wrong)

1. Day boundary for order numbers = `Europe/Kyiv` midnight.
2. One order row item = one portion (no quantity field).
3. Manager has read-only access to orders; cooks never see prices.
4. Bar items appear on the same kitchen screen with a station filter.
5. Split is a computed view, not persisted.
6. Tests need Docker (for Postgres); CI uses a Postgres service container.
7. Demo passwords come from `.env.example` (documented as demo-only), never from code.
