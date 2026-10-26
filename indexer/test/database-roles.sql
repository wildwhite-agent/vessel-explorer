\set ON_ERROR_STOP on
-- Disposable local database only; never point this fixture at production.
BEGIN;
SET LOCAL ROLE vessel_indexer;
CREATE SCHEMA vessel_security_fixture;
CREATE TABLE vessel_security_fixture.tokens (id integer PRIMARY KEY);
INSERT INTO vessel_security_fixture.tokens VALUES (1);
CREATE VIEW vessel.security_fixture AS SELECT * FROM vessel_security_fixture.tokens;
RESET ROLE;
SET LOCAL ROLE vessel_api;
SELECT * FROM vessel.security_fixture;
DO $$
BEGIN
  BEGIN
    INSERT INTO vessel.security_fixture VALUES (2);
    RAISE EXCEPTION 'API write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'CREATE TABLE vessel.api_write (id int)';
    RAISE EXCEPTION 'API DDL unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM vessel_security_fixture.tokens;
    RAISE EXCEPTION 'API access to deployment schema unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'CREATE SCHEMA api_schema';
    RAISE EXCEPTION 'API schema creation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'CREATE ROLE api_role';
    RAISE EXCEPTION 'API role creation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE vessel_indexer;
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE ROLE writer_role';
    RAISE EXCEPTION 'Indexer role creation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER ROLE vessel_indexer SUPERUSER';
    RAISE EXCEPTION 'Indexer elevation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- Replacing views preserves reader privileges via ALTER DEFAULT PRIVILEGES.
SET LOCAL ROLE vessel_indexer;
DROP VIEW vessel.security_fixture;
CREATE VIEW vessel.security_fixture AS SELECT * FROM vessel_security_fixture.tokens;
RESET ROLE;
SET LOCAL ROLE vessel_api;
SELECT * FROM vessel.security_fixture;
RESET ROLE;
SELECT bool_and(NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) AS application_roles_limited
FROM pg_roles WHERE rolname IN ('vessel_indexer', 'vessel_api');
ROLLBACK;
