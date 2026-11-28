# AURA-AUTH-SESSION-01-I2-R1: security and integration correction (39247)

This responds to independent verification 39246 (NO-GO on head `c02b715`, integration `a2b58fa`).
- **Outcome:** F2–F6 are corrected.
- **F1 is stopped:** guaranteeing the Rev 3 B3 ordering needs a transaction architecture change. The owner must choose between the options below.
- **PR #407 stays draft.** Auto-merge and Auto-fix stay off.
- **Not touched:** migrations, Prisma, the legacy fallback, enforcement switches, Production, staging, credentials, Keychain and GOV-02.

## Reproduction on unchanged `c02b715`

The evidence is in `AURA_AUTH_SESSION_01_I2_R1_EVIDENCE/witness-c02b715/`. It is uncommitted and checksummed.

**F1 (`f1-consent-order.log`)** used the real local authorization server (`getLocalMcpAuth`, real `guardConsentGrant`, Postgres OAuth adapter) with two disposable databases, Aura and OAuth. A barrier held the Grant INSERT, and commit order was read with `pg_xact_commit_timestamp`.
- **H, healthy lock:** logout waits and the grant commits first. Ordering held.
- **T, lock holder terminated:** logout returned 200 and committed. The grant committed about 400 ms **later**. This is the reproduced defect.
- **I, idle-in-transaction timeout:** logout committed. The grant write hit the OAuth store's own 3 s deadline and rolled back (503). That outcome is incidental to the current constants, not guaranteed.
- No authorization code was issued in any scenario: resuming the authorization re-checks the Aura session.

**F2 (`f2-deadline.log`):** each phase was slowed by 1.2 s, under its own maximum. Sign-in still issued a session at **3 606 ms**. COMMIT, read-back and pool-wait cases also issued past 2 s.

**F3–F6** were confirmed from source and by the strengthened scanner run over the unchanged tree (`f4-coverage.log`: 15 violations). The new F3 and client tests cannot load on `c02b715`, so their detection is shown by the mutation controls instead.

## F1: decision required

`lib/mcpLocalOAuth.ts` keeps the OAuth store on `AURA_MCP_OAUTH_DATABASE_URL`, deliberately never `DATABASE_URL`. That separation is part of the I2b design.
- **Why it can't be guaranteed today:** the session `FOR SHARE` lock and the durable grant write are on different connections, and in local development on different databases. No pre-write check, timeout or cancellation can order a commit on one connection against a lock on another once the lock holder is lost.
- **What Rev 3 B3 says:** the re-check runs "inside their own transaction". For consent, that transaction is the OAuth store's.

| Option | What changes | Guarantee | Cost |
|---|---|---|---|
| **A. One transaction (matches Rev 3 B3 wording)** | Consent's session re-check `FOR SHARE` and the Grant write run in **one transaction on one connection**. The adapter writes the Grant through an ambient transaction client. | Strict. Lock loss rolls back the grant, and the overall 2 s deadline applies through `SET LOCAL`. | The OAuth store must live on the Aura session database: the I2b separation rule changes. B3 needs the Postgres store (memory store excluded). The adapter and provider save path change. |
| **B. Liveness proof plus compensation (smallest)** | After the grant commits, the lock transaction must still answer, then COMMIT. If it does, ordering is **proven**: the lock was held throughout. If it doesn't, the grant is revoked by id and the request answers 503. | Proven on success. On failure it relies on compensation, which can itself fail. Separately, code issuance still requires a live session. | Small. B3's invariant is restated as "no token is issued after revocation", a documented deviation from strict ordering. |
| **C. Accept the residual** | No change beyond documenting it. | An orphan Grant can survive logout, but it carries no tokens and issuance re-checks the session. | Deviation from Rev 3 B3, with no code change. |

- **Recommendation:** A if strict Rev 3 B3 ordering must hold. Otherwise B.
- **Consent-guard deadline (F2 item):** this is bound to the same decision. A caller timer around the external grant write, without A, would return failure while the write continues, which makes ordering worse. So it is **not applied**.

## Corrections (F2–F6)

**F2: shared sign-in deadline.**
- `createSignInSession` takes one monotonic 2 s deadline **before** pool acquisition. Acquisition, the transaction steps, `COMMIT` and the release read-back all run on what remains, and the `SET LOCAL` statement, lock and idle timeouts are clamped to it.
- I1 store change, additive: `SessionOperationOptions.deadlineAt`.
  - `commitAuthSessionTransaction` waits `min(2 000, remaining)`.
  - With no budget left it never sends the COMMIT. It returns `rolled_back` with the new reason `not_sent_deadline`, and the caller rolls back or discards.
  - Lookups and the read-back pass `deadlineAt` to `boundedSessionQuery`.
- Unchanged: ambiguous-COMMIT handling, transaction binding, single-use release and the rule of no cookie without an acknowledged COMMIT.

**F3: an outage is 503, never sign-in.**
- **MCP:** a resolver that throws (an unavailable session store) now raises `StoreUnavailableError`.
  - The interaction answers a 503 page with `Retry-After` instead of "Sign in to Aura".
  - The consent-approval guard maps `SessionVerificationUnavailableError` to the same 503.
  - The provider's own 503 error pages now carry `Retry-After`.
  - Revoked and missing sessions still answer 401 sign-in.
- **E2 pages** (captures, goals, goal detail, Plan Day) resolve the session through `pageSessionOrUnavailable` (`lib/sessionPage.ts`).
  - An outage redirects to `/session-unavailable`, a public route handler that answers **503** with `Retry-After`, no-store, no cookie change, and a "Try again" link to the same-origin page.
  - An App Router page can't set its own status, which is why the redirect is needed.

**F4: central boundary.**
- Plan Day reads no cookie. It resolves the session once (memoised) through `lib/session.ts` and passes only `verifySession(): {userId} | null` to its four resolvers. The `getSessionToken` seam is removed from `planDayBootstrap.ts` and from 21 test fixtures.
- Equivalent path removed: the unused `readSessionCookieValue` export in `lib/mcpLocalOAuth.ts`. `readSessionCookieFromHeader` is now private to `lib/session.ts`.
- Scanner changes:
  - **C4** has no presence-check exception: any `cookies().get/getAll/has`, or any use of `activeSessionCookieName` / `readSessionCookieFromHeader` outside the session module, is a violation.
  - **C7** now checks each exported handler through the TypeScript AST, following same-file helpers: 109 handlers.
  - New **C12**: E2 pages must use the 503 boundary.
  - Negative fixtures N18–N23 cover the reproduced bypass, a request-cookie read, an unauthenticated second handler, the helper pattern, comment-only matches, and a direct page await.

**F5: Home logout race.** `createAuthFence()` (`lib/sessionClient.ts`) works like this:
- Refreshes take a ticket, are paused while a sign-out is in flight, and apply results only while their ticket is current.
- Starting **and** ending a sign-out each advance the epoch.
- After a failed sign-out (503 twice, one automatic retry) the user stays signed in, the error shows, and Home re-checks with a fresh ticket.
- Home's `loadUserDataAndLogs` checks the fence after every `await`.

**F6: `/find`.**
- The auth state is explicit: `unknown | signed_in | signed_out`, read through `fetchSessionBootstrap`, where 503 means unknown.
- Choosing an activity, or saving, re-checks while the state is unknown. Neither the guest path nor the signed-in route is taken until the server answers definitively, and an inline notice is shown.
- Audit: no other client component reads `/api/auth/session`. Home already used `fetchSessionBootstrap`.

**Test migration gap.** `dayConstructorPreviewIntegrity.test.ts` keeps the legacy control and adds genuine **v2** wrong-purpose controls in both directions.

## Verification

| Suite | Result |
|---|---|
| `authSessionI2R1DeadlineDb` (new, CI DB job) | 10/10. Every slow phase ends within 2 s with no session; the no-budget COMMIT is not sent; the code stays unconsumed. |
| `authSessionI2R1OutageDb` (new, CI DB job) | 12/12. Real dead pool. Interaction and consent approval answer 503 with `Retry-After`; revoked and missing sessions answer 401; the E2 boundary and the 503 route work; returnTo is same-origin only. |
| `authSessionI2R1ClientJsdom` (new, CI math-core) | 20/20. The fence uses deferred fetches across overlap, 503 logout and re-authentication; the real `/find` is mounted after a 503. |
| Coverage scanner | 31/31, with 23 negative fixtures. On unchanged `c02b715` it reports 15 violations. |
| Mutation controls (`controls/mutations.json`) | 13/13 caught. Each control reverts one fix on the corrected tree. |
| I1 and I2 suites | I2 DB 64/64, R1 DB 42/42, R3 DB 24/24, store 50/50, contract 21/21, deadline 27/27, token 68/68, client 12/12. |
| MCP OAuth | local 119/119, security regression 34/34, I2b 116/116. |
| Plan Day, Goal and Capture seams | The bootstrap, row identity, handoff, demand, rhythm, provenance and HPG-FIX-01 suites pass. |
| Web typecheck | clean |

**Still outstanding:** F1 (owner decision), N1–N8 device acceptance, Neon pool verification, staging latency, INFRA-01, and the cutover runbook.
