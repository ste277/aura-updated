const { Client } = require('pg');
const crypto = require('crypto');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:auraschedule@localhost:5432/auraschedule_dev' });
  await client.connect();

  await client.query('DELETE FROM "HabitLog"');
  await client.query('DELETE FROM "User"');

  const userId = crypto.randomUUID();
  await client.query(
    `INSERT INTO "User" (id, email, "cityName", latitude, longitude, "tzOffsetMinutes")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, 'founder@auraschedule.test', 'Chennai', 13.0827, 80.2707, 330]
  );

  // Simulate logging habits across the last 3 days (today, yesterday, day before)
  // to prove the streak calculation works, plus a 5-day-old gap entry that should
  // NOT count toward the current streak.
  const now = new Date();
  const offsets = [0, 1, 2, 5]; // days ago
  for (const daysAgo of offsets) {
    const ts = new Date(now);
    ts.setDate(ts.getDate() - daysAgo);
    await client.query(
      `INSERT INTO "HabitLog" (id, "userId", "activityTitle", "activeWindow", "logTimestamp", "logMinuteOfDay")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), userId, 'Tackle your hardest task', 'ABHIJIT', ts, 750]
    );
  }

  const { rows } = await client.query(
    `SELECT "logTimestamp" FROM "HabitLog" WHERE "userId" = $1 ORDER BY "logTimestamp" DESC`,
    [userId]
  );

  console.log(`Inserted user + ${rows.length} habit logs. Rows from DB:`);
  for (const r of rows) console.log(' -', r.logTimestamp.toDateString());

  // Streak calc: consecutive days counting back from today
  const days = new Set(rows.map((r) => r.logTimestamp.toDateString()));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  console.log(`Computed streak: ${streak} (expected 3 — today, yesterday, day before; the 5-day-old entry is a gap and should not extend it)`);

  await client.end();

  if (streak === 3 && rows.length === 4) {
    console.log('DB INTEGRATION TEST PASSED');
    process.exit(0);
  } else {
    console.log('DB INTEGRATION TEST FAILED');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
