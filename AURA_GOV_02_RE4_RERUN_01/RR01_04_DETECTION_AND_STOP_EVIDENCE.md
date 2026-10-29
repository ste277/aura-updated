# RR01-04: Detection and Stop Evidence (`evidence/rr01_stop_run.log`)

**Stop line:** `R2D STOP: T1-6: UI-automation / remote-control process running: …`

| Process (as named by the scan) | Field(s) that matched |
|---|---|
| ChatGPT for Chrome | `comm:ChatGPT for Chrome` and `ucomm:ChatGPT for Chro` (kernel name truncated to 16) |
| Claude | `comm:` and `ucomm:` |
| Claude Helper | `comm:` and `ucomm:` |
| Claude Helper (Renderer) | `comm:` and `ucomm:Claude Helper (R` |
| claude | `comm:` and `ucomm:` |
| superops (SuperOps RMM) | `comm:` and `ucomm:` |

These are the names actually observed in this run. **Both identity fields triggered for every detected process**, so neither field was needed alone.

**Stop evidence:**
- `stop() called -> exit 2`; subshell exit status **2**.
- **No `TRIPWIRE` line:** no Keychain-reaching function was called.
- **No `SENTINEL` line:** execution did not continue past T1-6.
- Verdict line `STOPPED`.
- No scan temp file left.
