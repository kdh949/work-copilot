BEGIN;

UPDATE "user"
SET "loginId" = 'suho'
WHERE "loginId" = 'test';

UPDATE board
SET writer = 'suho'
WHERE writer = 'test';

UPDATE comment
SET writer = 'suho'
WHERE writer = 'test';

COMMIT;

SELECT id, "loginId" FROM "user" ORDER BY id;
