AURA-GOV-02-I0-C hash-pinned procedure artifacts (local, UNTRACKED; contain no secret values).
b2b/  B2-B (executed 2026-11-11, attempt 2 PASS): apply.sql, writer.zsh
b3/   B3   (executed, PASS - CLOSED WITH ACCEPTED SECURITY EXCEPTION): b3_checks.sql, b3_connect.zsh
b4/   B4   DRAFTS - NOT AUTHORIZED FOR EXECUTION (readiness plan: AURA_GOV_02_I0_C_B4_GRANTS_READINESS_PLAN.md)
rot/  B2-B-R / B3-R DRAFTS - NOT AUTHORIZED FOR EXECUTION (plan: AURA_GOV_02_I0_C_B2B_R_ROTATION_PLAN.md). rot_settings.sql and rot_run_DRAFT.zsh pin the Production direct endpoint host (not secret; do not commit unmasked).
Verify: cd AURA_GOV_02_I0_C_ARTIFACTS && shasum -a 256 -c SHA256SUMS
Do not commit without separate authorization (Production merge freeze active).
