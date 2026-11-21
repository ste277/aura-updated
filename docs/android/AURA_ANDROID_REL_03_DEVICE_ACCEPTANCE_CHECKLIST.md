# AURA-ANDROID-REL-03 — Physical-Device Acceptance Checklist

**Status: PREPARED, NOT EXECUTED.** Running it requires a separate GO.

**Preconditions**
- A debug build from one identified commit (record the SHA).
- A disposable test account and a non-production backend.
- The device's location settings recorded before starting: Google Location Accuracy, Wi-Fi, SIM.
- No coordinates are written into any report. Record the city name only.

**Pass rule:** every step's expected result is observed, with **0 FATAL / 0 ANR** and **no spinner lasting more than 31 s**. Any deviation is a FAIL; record the step, the time and what was on screen.

| # | Area | Steps | Expected result | Pass / fail |
|---|---|---|---|---|
| 1 | Fresh install and launch | Uninstall, install, launch, cold-start twice | Landing screen within 5 s; no white screen or connection-error page while the server is up; with the server down, the connection-error page shows and Back exits | Each launch matches; the server-down page shows instead of a blank WebView |
| 2 | First-time permission | Location step → *Use my current location* | A single **Approximate**-only dialog (no Precise option); after Allow, "Finding…" → confirmation card (or "City lookup unavailable" if there is no key) | Exactly 1 dialog; the card or the lookup message appears within 30 s; nothing saves until **Confirm** |
| 3 | One-time permission | Choose *Only this time* → acquire → background the app until Android revokes the grant (or force-stop) → tap again | The first attempt works; after revocation the dialog appears again | Re-prompts; no stale "denied" message |
| 4 | Deny once / permanently | Deny → tap → Deny (and *don't ask again*) → tap | 1st denial: "permission was denied…" plus search/manual. 2nd: "turned off…" plus **Open Settings**. 3rd tap: no dialog, same message | The messages match each stage; Open Settings opens App info; Back returns to Aura |
| 4b | Settings recovery (B-1) | In App info, allow location → Back | "Location access is on. Tap … to try again."; nothing is requested automatically | The notice appears; no automatic prompt or acquisition |
| 5 | GPS acquisition and timeout | (a) good Wi-Fi with Google Location Accuracy ON; (b) only if approved: poor or no network | (a) a fix within a few seconds; (b) "Still finding…" at about 10 s, a timeout message at about 30 s, spinner cleared, retry possible | (a) ≥ 5/5 fixes; (b) the message and timing are within ±2 s and no stuck spinner |
| 5b | F1 supersede | Tap GPS; during "Finding…", search and pick a city (and separately save a dropdown city) | The picked city stays in the card; no GPS card appears later | The late fix never replaces or reopens anything |
| 6 | Manual city selection | Search "Kollam" → pick → Confirm; Advanced → curated city; Advanced → manual coordinates and timezone | Each saves once; Home shows that city and timezone | Each saved location is correct after an app restart |
| 7 | Background / foreground | Tap GPS → Home button → wait 10 s → reopen; repeat during the permission dialog | The result is delivered once, or a clean timeout; no duplicate prompt | No duplicate dialogs or cards; spinner ≤ 31 s |
| 8 | Back navigation | Back from: a tab two levels deep, an open modal, the location modal mid-request, `/goals`, `/plan-day`, `/find`, signed-out landing | Pops one level / closes the modal / goes Home / exits only at root or when signed out | Every case matches; no exit from a non-root screen |
| 9 | Find a Time | Run a search as a guest and while signed in; rotate the device; press Back | Results or a clear error with retry; no spinner left after an error | A result or a typed error each time |
| 10 | Save and sign-in | As a guest, save from Find a Time → sign in with the 6-digit code → return | The saved item persists after sign-in and after an app restart; sign-out clears the session | The item is present after both; signing back in works |

**Record per run:** build SHA, device model and API level, location-settings state, start and end time, each step's P/F, and FATAL/ANR count.
