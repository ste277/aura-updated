const { Client } = require('pg');
const crypto = require('crypto');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:auraschedule@localhost:5432/auraschedule_dev' });
  await client.connect();

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  // Scenario: 6 users signed up at various points in the past.
  // - alice: signed up 10d ago, came back every day (strong retention)
  // - bob: signed up 10d ago, came back day 1 only, then churned
  // - carol: signed up 10d ago, never came back after signup day (churned immediately)
  // - dave: signed up 3d ago, came back day 1 and day 2 (too early for day-7 eval)
  // - erin: signed up 10d ago, came back day 1, 3, 7 (patchy but present at day 7)
  // - frank: signed up today (too early to be eligible for anything)
  const scenarios = [
    { email: 'alice@test.dev', signedUpDaysAgo: 10, visitOffsets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { email: 'bob@test.dev', signedUpDaysAgo: 10, visitOffsets: [0, 1] },
    { email: 'carol@test.dev', signedUpDaysAgo: 10, visitOffsets: [0] },
    { email: 'dave@test.dev', signedUpDaysAgo: 3, visitOffsets: [0, 1, 2] },
    { email: 'erin@test.dev', signedUpDaysAgo: 10, visitOffsets: [0, 1, 3, 7] },
    { email: 'frank@test.dev', signedUpDaysAgo: 0, visitOffsets: [0] },
  ];

  for (const s of scenarios) {
    const userId = crypto.randomUUID();
    const createdAt = daysAgo(s.signedUpDaysAgo);
    await client.query(
      `INSERT INTO "User" (id, email, "cityName", latitude, longitude, "tzOffsetMinutes", "createdAt")
       VALUES ($1, $2, 'Chennai', 13.0827, 80.2707, 330, $3)`,
      [userId, s.email, createdAt]
    );
    for (const offset of s.visitOffsets) {
      const visitedAt = daysAgo(s.signedUpDaysAgo - offset);
      await client.query(`INSERT INTO "VisitLog" (id, "userId", "visitedAt") VALUES ($1, $2, $3)`, [
        crypto.randomUUID(),
        userId,
        visitedAt,
      ]);
    }
  }

  console.log('Seeded 6 users with varied retention patterns.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
