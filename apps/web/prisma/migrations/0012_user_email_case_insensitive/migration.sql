-- Emails are case-insensitive identities: both sign-in flows lowercase the
-- address before hashing/looking up codes, but User.email was matched exactly,
-- so Foo@x.com and foo@x.com could become two accounts. Normalize existing
-- rows and enforce uniqueness on the lowercased value.
--
-- If this fails on the UPDATE with a unique-violation, the database already
-- holds true case-duplicates (two accounts differing only by case). Merge or
-- delete them manually first — this migration deliberately refuses to guess
-- which one is the real account.
UPDATE "User" SET email = lower(email) WHERE email <> lower(email);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_key" ON "User" (lower(email));
