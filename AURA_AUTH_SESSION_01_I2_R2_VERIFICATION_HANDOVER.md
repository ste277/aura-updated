# AURA-AUTH-SESSION-01-I2-R2: Option D, session-bound MCP consent finalization (39250)

**Scope.** This implements the F1 architecture approved in 39249/39250 and the F2 consent deadline. Rev 4 is recorded narrowly in `AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md`: B3 row and §3.1, MCP consent only.
- The Aura and MCP OAuth databases stay separate. The OAuth schema is unchanged.
- Token formats, lifetimes and rotation are unchanged. There is no authorization caching.
- PR #407 stays draft. Auto-merge and Auto-fix stay off.

## Contract

**Guarantee:** an incomplete MCP consent operation associated with a revoked Aura session never becomes a usable authorization, even if its OAuth grant write commits after logout.

| Element | Implementation |
|---|---|
| Authoritative state | `McpConsentFinalization`, in the **Aura** database (migration `0057_mcp_consent_finalization`, additive). It is keyed by the grant's SHA-256 storage key and binds the user, client and canonical authorization (every OIDC scope, OIDC claim and resource scope). `rar` or malformed grants can never be covered. Rows are immutable: an update trigger blocks changes and inserts use `ON CONFLICT DO NOTHING`. Account deletion cascades. |
| Linearization point | The COMMIT of one parameterized `INSERT … SELECT … FROM "AuthSession" … FOR SHARE OF s` (`apps/web/lib/mcpConsentFinalization.ts`). It requires the token's own row (`idHash`, `userId`, `expiresAt` = token exp), `revokedAt IS NULL`, and `expiresAt > now()` by the database clock. Under READ COMMITTED: if logout commits first, the row is re-checked and nothing is inserted; if finalization commits first, logout waits for it. |
| Enforcement | `withConsentFinalization` (`packages/mcp-tools/src/auth/consentFinalization.ts`) wraps the provider's `Grant` model: `find` returns a grant only if a live finalization for the same grant, account and client covers every item the grant carries. In oidc-provider 9.13.3, which stays pinned exactly in `package.json` and the lockfile, that one point serves resume and code issuance, code redemption, refresh and Aura's MCP `verifyAccessToken`. Connection listing applies the same check. |
| Consent flow | New grant every time (no reuse) → save (OAuth database) → finalize (Aura database) → `interactionFinished` **only** after a confirmed `'finalized'`. A refusal answers 401. An outage, an ambiguous COMMIT or a spent budget answers 503 with `Retry-After`, and the interaction is never finished. |
| Outages | A failed Aura-database check throws `StoreUnavailableError`. Token and resource endpoints answer 503, and the grant is checked before any code or refresh token is consumed, so nothing is revoked or used up. |
| F2 deadline | A consent POST runs in `runWithRequestBudget(min(2 000, request budget))`, starting before its session verification. The session lookup, finalization and every OAuth-store call are clamped to what remains. Finalization is not attempted with less than 300 ms left. A finalization confirmed after the budget ran out finishes nothing. |
| Retention and cleanup | `expiresAt` = grant maximum lifetime (max(30 d, absolute refresh lifetime)) + 1 day. The existing daily cron deletes only expired rows, in a bounded batch, so no live connection loses its finalization. Disconnect deletes the grant in the OAuth database; the leftover finalization is inert and expires. Orphan grants with no finalization expire through the OAuth store's own cleanup. |

## Behaviour change for review

- **Superseded session-bound tokens.** With no grant reuse, re-authorizing the **same client in the same browser** supersedes the earlier access token if it lacked `offline_access`. oidc-provider's expires-with-session tokens follow the session's current grant. Refresh-capable connections are unaffected.
  - `mcpOAuthSecurityRegression` F1.6b was restated to assert exactly this.
  - **Safe alternative, if you want the old behaviour:** reuse an existing *finalized* grant only when the request is fully covered and **nothing is written**.
- **One-time reconnect.** Existing local-development grants have no finalization and need one reconnect.

## Verification

**Witness.** The original F1 witness reproduced on unchanged `170b62f` before any change: the lock holder was terminated and the grant committed after logout (`AURA_AUTH_SESSION_01_I2_R2_EVIDENCE/witness-170b62f/`).

**New suite.** `test/mcpConsentFinalizationDb.test.ts` (CI DB job) runs 46 checks on **two** disposable databases, with real consent, token and resource handlers. It covers:
- a control run, and a completed connection surviving logout;
- both finalization-versus-logout orders;
- the late grant commit, with no code and an unusable grant;
- finalization backend terminated;
- idle-in-transaction timeout;
- an ambiguous COMMIT that committed, with the interaction not finished;
- session expiry by the database clock;
- outages at consent, code redemption, refresh, resource access and listing, with nothing consumed after recovery;
- a consent process SIGKILLed mid-finalization;
- every enabled path with a missing, mismatched, narrower or malformed finalization;
- immutability and scope extension, and no reuse;
- retry and resume;
- disconnect and account deletion;
- the 2 s budget exhausted at five stages.

**Negative controls.** `controls/mutations-option-d.json` holds 10 single-change mutations, run against this suite. They bypass `Grant` enforcement, skip the revocation check, drop `FOR SHARE`, drop the expiry and token binding, finish a refused consent, reuse grants, skip scope coverage, ignore the client or account, read an outage as "not finalized", and remove the 300 ms floor.

**Unchanged and still passing:** the I1 guarantees, the F2–F6 corrections and the previous evidence.
