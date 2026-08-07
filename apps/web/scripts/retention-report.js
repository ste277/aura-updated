// Computes the retention numbers the MVP spec's kill criteria is actually about:
// "day-2 return rate (opened again next day, no push) under ~20% -> stop and rethink"
//
// Run: node scripts/retention-report.js
// Requires DATABASE_URL in the environment (or .env.local, loaded below).

require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const aDay = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDay = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bDay - aDay) / msPerDay);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: users } = await client.query('SELECT id, email, "createdAt" FROM "User" ORDER BY "createdAt"');
  const { rows: visits } = await client.query('SELECT "userId", "visitedAt" FROM "VisitLog" ORDER BY "visitedAt"');

  const visitsByUser = new Map();
  for (const v of visits) {
    if (!visitsByUser.has(v.userId)) visitsByUser.set(v.userId, []);
    visitsByUser.get(v.userId).push(new Date(v.visitedAt));
  }

  const now = new Date();
  let eligibleForDay2 = 0;
  let returnedDay2 = 0;
  let eligibleForDay7 = 0;
  let returnedDay7 = 0;

  console.log(`${users.length} user(s) total.\n`);

  for (const u of users) {
    const signupDate = new Date(u.createdAt);
    const daysSinceSignup = daysBetween(signupDate, now);
    const userVisits = (visitsByUser.get(u.id) || []).map((v) => daysBetween(signupDate, v));

    const returnedOnDay = (dayOffset) => userVisits.includes(dayOffset);

    if (daysSinceSignup >= 1) {
      eligibleForDay2 += 1;
      if (returnedOnDay(1)) returnedDay2 += 1;
    }
    if (daysSinceSignup >= 7) {
      eligibleForDay7 += 1;
      if (returnedOnDay(7)) returnedDay7 += 1;
    }

    console.log(
      `  ${u.email.padEnd(30)} signed up ${daysSinceSignup}d ago, visited on days [${userVisits.sort((a, b) => a - b).join(', ')}]`
    );
  }

  const day2Rate = eligibleForDay2 > 0 ? ((returnedDay2 / eligibleForDay2) * 100).toFixed(1) : 'n/a';
  const day7Rate = eligibleForDay7 > 0 ? ((returnedDay7 / eligibleForDay7) * 100).toFixed(1) : 'n/a';

  console.log(`\nDay-2 return rate: ${returnedDay2}/${eligibleForDay2} = ${day2Rate}% (eligible = signed up >=1 day ago)`);
  console.log(`Day-7 return rate: ${returnedDay7}/${eligibleForDay7} = ${day7Rate}% (eligible = signed up >=7 days ago)`);

  if (eligibleForDay2 >= 5) {
    const pass = parseFloat(day2Rate) >= 20;
    console.log(
      `\nMVP spec kill criteria (day-2 return rate >= ~20%): ${pass ? 'PASSING' : 'NOT PASSING — see MVP spec section "Kill criteria"'}`
    );
  } else {
    console.log(`\nNot enough eligible users yet (need >=5 signed up at least 1 day ago) to evaluate the kill criteria.`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
