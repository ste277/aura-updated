# Aura MCP server (local foundation, AURA-MCP-01-I1)

A **local-only, read-only, non-personalized** [Model Context Protocol](https://modelcontextprotocol.io) server that exposes one tool, `find_best_time`. The tool is backed by Aura's existing Timing Search pipeline.

This server:

- runs as a local child process over **stdio**. It opens no network port.
- is **not connected to Aura accounts**. It reads no session, no user record and no birth profile, and it has no database.
- is **read-only**. It creates, saves and records nothing, including product events.
- is **not remotely hosted, not deployed and not production-ready**.

## Prerequisites

- Node.js 20 or newer (the repository's `.nvmrc` pins 20).
- npm.

No `DATABASE_URL`, `AUTH_SECRET`, Vercel configuration or credentials are needed. The server reads no environment variables.

## Install, build and run

```bash
cd apps/mcp
npm ci
npm run build      # compiles to dist/ (git-ignored)
npm start          # node dist/apps/mcp/src/index.js
```

`npm start` waits for MCP JSON-RPC messages on stdin. Normally an MCP client launches it, so you won't run it by hand. stdout carries protocol messages only, and diagnostics go to stderr with an `[aura-mcp]` prefix.

## MCP client configuration

Point any stdio-capable MCP client at the built entry file. Replace `<ABSOLUTE_PATH_TO_REPO>` with your checkout's path.

```json
{
  "mcpServers": {
    "aura": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/apps/mcp/dist/apps/mcp/src/index.js"]
    }
  }
}
```

For Claude Code, the equivalent is:

```bash
claude mcp add aura -- node <ABSOLUTE_PATH_TO_REPO>/apps/mcp/dist/apps/mcp/src/index.js
```

## Tool: `find_best_time`

This tool finds suitable start times for an activity. It uses Aura's existing Timing Search in FIND mode: Panchangam windows, Muhurta and activity fit, plus optional Daily Rhythm work hours.

The call path is:

```
buildTimingSearchRequest() → runTimingSearchWithDailyRhythm() → runTimingSearch()
```

These live in `apps/web/lib/timingSearchRequest.ts`, `apps/web/lib/timingSearchDailyRhythm.ts` and `packages/recommendation/src/timingSearch.ts`. The tool adds no scoring, ranking, overlap or Panchangam logic of its own.

### Input

| Field | Required | Notes |
|---|---|---|
| `activityId` | one of the two | A catalog id from `FULL_ACTIVITY_CATALOG`, e.g. `workout`, `deep-work`, `meditation`, `business-start`. Unknown ids are rejected. |
| `taskTitle` | one of the two | Free text (1–200 chars), classified by the existing classifier. |
| `durationMinutes` | yes | 15–360. |
| `location` | yes | `{ latitude: -90..90, longitude: -180..180 }`. No geocoding and no inference. |
| `timezone` | yes | An IANA zone containing a `/`, e.g. `Asia/Kolkata`. This is the same rule as `isValidIanaTimezone`. |
| `dateRange` | no | `{ start, end }` as local `YYYY-MM-DD` real calendar dates, inclusive, ≤ 90 days. |
| `horizon` | no | `NOW`, `TODAY`, `TOMORROW`, `WEEKEND` or `SEVEN_DAYS`. Defaults to `TODAY`. Can't be combined with `dateRange`. |
| `timePreference` | no | `ANY` (default), `MORNING`, `AFTERNOON`, `EVENING` or `NIGHT`. |
| `limit` | no | 1–10, default 3. |
| `referenceTime` | no | The "now" for the search, as an ISO instant **with an offset** (`Z` or `±hh:mm`). It defaults to the server clock, and the result reports which was used. Supply it for reproducible results. |
| `dailyRhythm` | no | `{ workStart: "HH:mm", workEnd: "HH:mm", workDays: [0..6] }`, where 0 is Sunday. It must not run overnight. When omitted, no Daily Rhythm preference is applied. |

Example:

```json
{
  "activityId": "workout",
  "durationMinutes": 45,
  "location": { "latitude": 13.0827, "longitude": 80.2707 },
  "timezone": "Asia/Kolkata",
  "dateRange": { "start": "2026-11-10", "end": "2026-11-10" },
  "referenceTime": "2026-11-09T00:00:00+05:30",
  "limit": 1,
  "dailyRhythm": { "workStart": "09:00", "workEnd": "17:00", "workDays": [1, 2, 3, 4, 5] }
}
```

### Response

The response is returned both as `structuredContent` and as JSON text. Each candidate is the pipeline's own `TimingCandidate`, unmodified, with two additions: `rank`, which is its position in the pipeline order, and an optional `dailyRhythmNote`. Times are UTC instants. In the example below, `reasons` is abbreviated.

```json
{
  "personalized": false,
  "personalizationNote": "Recommendations use the supplied location, timezone and scheduling preferences. No Aura account or birth-profile personalization was applied.",
  "query": {
    "activityId": "workout", "durationMinutes": 45, "timePreference": "ANY",
    "searchWindow": { "dateRange": { "start": "2026-11-10", "end": "2026-11-10" } },
    "timezone": "Asia/Kolkata", "tzOffsetMinutes": 330,
    "location": { "latitude": 13.0827, "longitude": 80.2707 },
    "referenceTime": "2026-11-08T18:30:00.000Z", "referenceTimeSource": "SUPPLIED",
    "limit": 1,
    "dailyRhythm": { "workStart": "09:00", "workEnd": "17:00", "workDays": [1, 2, 3, 4, 5] }
  },
  "mode": "FIND",
  "candidates": [
    {
      "start": "2026-11-09T23:00:00.000Z", "end": "2026-11-09T23:45:00.000Z",
      "score": 7.2, "label": "GOOD", "muhurtaScore": 7, "auraFitScore": 72,
      "reasons": [{ "code": "YOGA_SUPPORTIVE", "factor": "YOGA", "polarity": "SUPPORT", "impact": 4, "value": "Shobhana" }],
      "metadata": { "windowType": "BRAHMA", "windowLabel": "Brahma Muhurta", "activityType": "Workout", "dateLabel": "Tue, Nov 10" },
      "rank": 1,
      "dailyRhythmNote": "Fits your preferred personal time."
    }
  ],
  "unavailableDayCount": 0
}
```

How to read the results:

- `label` and `score` come straight from the engine. A `CAUTION` label is guidance, not a prohibition, and an Abhijit window can still be labelled `CAUTION` (see `reasons`).
- When the sun doesn't rise or set at the location (polar day or night), `candidates` is `[]` and `unavailable.reason` is `SOLAR_NO_EVENT`. No times are made up.

### Errors

Errors come back as an MCP tool result with `isError: true`, plus `structuredContent.error = { kind, message }`:

- `INVALID_INPUT`: schema violations, or a request the existing `buildTimingSearchRequest` rejects.
- `CALCULATION_FAILED`: the pipeline threw an error. Only the error class name is returned, never a message, stack or path.

Schema violations caught by the SDK itself return `MCP error -32602: Input validation error: …`. An unknown tool name returns `Tool <name> not found`.

## Tests

```bash
cd apps/mcp
npm test        # builds, then runs node --test on dist/apps/mcp/test/*.test.js
```

There are four suites. Each runs the server as a real child process over stdio, and none needs a database or secrets.

- `protocol.test.ts`:
  - initialize, capabilities and tool discovery (exactly one tool)
  - valid and invalid calls, unknown tool and unknown method
  - safe errors
  - raw JSON-RPC stdout discipline and malformed input
  - clean exit when stdin closes
  - a PATH-only environment
- `validation.test.ts`:
  - every rejection rule
  - schema bounds checked against `buildTimingSearchRequest` at each boundary
  - safe `CALCULATION_FAILED`
  - disclosure of the default clock
- `parity.test.ts`: compares tool output over MCP field-for-field with an independently built call to the existing pipeline. Scenarios include favorable, CAUTION-labelled Abhijit, multi-day ranking, horizons, a DST boundary, a timezone change, Daily Rhythm on and off, polar unavailability and determinism. **These cover the non-personalized path only.**
- `isolation.test.ts`:
  - runtime and static proof that no DB, HTTP framework, network or `child_process` module is loaded
  - no `process.env` reads
  - no console or stdout writes in the server graph
  - exactly one tool registration

## Troubleshooting

- **`Cannot find module .../dist/...`**: run `npm run build` first.
- **The client hangs or shows garbled output**: make sure nothing wraps the process and writes to stdout. Diagnostics go only to stderr.
- **`timezone: must be a valid IANA timezone`**: use a region zone such as `Europe/London`. Bare abbreviations (`IST`) and `UTC` are rejected by the shared validator.
- **Results differ from the Aura app**: this is expected when the user has a birth profile. The app adds birth-profile personalization and this server doesn't. The app also takes "now" from the browser clock, so pass `referenceTime` to compare.

## Security limitations

- stdio is safe only because the client launches the process locally. That is **not** authentication. A remote or user-scoped MCP server needs a separate, approved architecture decision on how a client is tied to an Aura user. See audit finding MCP-F2 in AURA-MCP-01-D1.
- Input text (for example `taskTitle`) is classified by existing deterministic code and is never executed or sent anywhere.

## Explicitly excluded

The following are out of scope:

- HTTP or remote transport, OAuth, sessions and user lookup
- database access, Prisma and `pg`
- write tools: plans, activities, preferences and reminders
- notifications and product events
- resources and prompts
- CHECK and COMPARE modes
- birth-profile personalization
- deployment, and any change to Panchangam scoring, overlap rules or Timing Search
