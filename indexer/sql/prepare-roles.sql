\set ON_ERROR_STOP on
-- Run as the existing administrator against the dedicated Vessel database only.
-- No passwords are accepted by this file; set them using psql \password later.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'vessel' THEN
    RAISE EXCEPTION 'Expected the dedicated vessel database';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vessel_indexer') THEN
    CREATE ROLE vessel_indexer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 48;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vessel_api') THEN
    CREATE ROLE vessel_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 24;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('vessel_indexer', 'vessel_api')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT FROM pg_auth_members WHERE member IN
      (SELECT oid FROM pg_roles WHERE rolname IN ('vessel_indexer', 'vessel_api'))) THEN
    RAISE EXCEPTION 'Existing application roles have unexpected privileges or memberships; review before proceeding';
  END IF;
END $$;

REVOKE ALL ON DATABASE vessel FROM PUBLIC, vessel_api, vessel_indexer;
GRANT CONNECT, CREATE ON DATABASE vessel TO vessel_indexer;
GRANT CONNECT ON DATABASE vessel TO vessel_api;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Ponder needs DDL in its sync store and its own deployment schemas. It has no
-- cluster privileges and cannot modify objects owned by other applications.
CREATE SCHEMA IF NOT EXISTS ponder_sync AUTHORIZATION vessel_indexer;
CREATE SCHEMA IF NOT EXISTS vessel AUTHORIZATION vessel_indexer;
ALTER SCHEMA ponder_sync OWNER TO vessel_indexer;
ALTER SCHEMA vessel OWNER TO vessel_indexer;

-- Transfer only the two explicitly named Ponder namespaces. Old deployment
-- schemas remain with their existing owner for rollback; new builds get new ones.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('ponder_sync', 'vessel') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    ORDER BY CASE WHEN c.relkind = 'S' THEN 1 ELSE 0 END
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO vessel_indexer',
      CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      item.nspname, item.relname);
  END LOOP;
  FOR item IN
    SELECT p.oid::regprocedure AS signature, p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('ponder_sync', 'vessel') AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO vessel_indexer', CASE item.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, item.signature);
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA ponder_sync, vessel FROM PUBLIC, vessel_api;
REVOKE ALL ON ALL TABLES IN SCHEMA ponder_sync, vessel FROM PUBLIC, vessel_api;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ponder_sync, vessel FROM PUBLIC, vessel_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ponder_sync, vessel FROM PUBLIC, vessel_api;
GRANT USAGE ON SCHEMA vessel TO vessel_api;
GRANT SELECT ON ALL TABLES IN SCHEMA vessel TO vessel_api;
ALTER DEFAULT PRIVILEGES FOR ROLE vessel_indexer IN SCHEMA vessel GRANT SELECT ON TABLES TO vessel_api;
ALTER DEFAULT PRIVILEGES FOR ROLE vessel_indexer REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE vessel_indexer REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE vessel_indexer REVOKE ALL ON SEQUENCES FROM PUBLIC;

ALTER ROLE vessel_api IN DATABASE vessel SET default_transaction_read_only = on;
ALTER ROLE vessel_api IN DATABASE vessel SET statement_timeout = '15s';
ALTER ROLE vessel_api IN DATABASE vessel SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE vessel_api IN DATABASE vessel SET search_path = vessel, pg_catalog;
ALTER ROLE vessel_indexer IN DATABASE vessel SET search_path = pg_catalog;
COMMIT;
