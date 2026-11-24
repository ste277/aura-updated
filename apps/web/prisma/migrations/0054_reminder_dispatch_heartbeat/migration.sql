-- AURA-REM-01: one row per reminder dispatch channel recording when the
-- scheduler last reached the dispatch endpoint. Lets the app say "device
-- notifications are working" only when background delivery has actually
-- run recently, instead of inferring it from configuration alone.
-- Additive only: no existing table or row changes. Holds no user data.
CREATE TABLE "ReminderDispatchHeartbeat" (
  channel TEXT PRIMARY KEY, -- "WEB_PUSH"
  "lastRunAt" TIMESTAMPTZ(3) NOT NULL,
  "lastRunConfigured" BOOLEAN NOT NULL
);
