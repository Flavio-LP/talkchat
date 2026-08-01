---
name: chalk-talk-local-services
description: Chalk Talk local Postgres runs on port 5433 and only accepts socket/peer auth; role creation needs a human with sudo
metadata:
  type: project
---

The Chalk Talk backend's local services on this machine:

- **PostgreSQL 16** listens on **port 5433** (cluster `main`), not 5432.
- The documented setup command creates a **passwordless** role:
  `sudo -u postgres psql -p 5433 -c "CREATE ROLE flavio WITH LOGIN CREATEDB;"`
  A passwordless role only works over the **Unix socket** (peer auth) — the
  default `pg_hba.conf` answers TCP connections with `scram-sha-256`. That is
  why `backend/.env` leaves `DATABASE_HOST` **empty** and `config/database.yml`
  omits the `host:` key entirely when the variable is blank.
- **Redis 7** runs as the Docker container `chalk-talk-redis` on port 6379,
  because `redis-server` is not installed and there is no non-interactive sudo.

**Why:** the agent environment has no passwordless sudo, so the Postgres role
must be created by a human. Without it every DB-touching command fails with
`FATAL: role "flavio" does not exist`.

**How to apply:** if `rails db:create` / `bin/rspec` fail on the missing role,
that is an environment prerequisite, not a code bug — say so instead of
"fixing" `database.yml`. To verify code that needs a real database without
waiting for the human, spin up a throwaway container
(`docker run -d --name chalk-talk-pg-verify -e POSTGRES_PASSWORD=... -e
POSTGRES_USER=flavio -p 5434:5432 postgres:16-alpine`) and run with
`DATABASE_HOST=localhost DATABASE_PORT=5434 DATABASE_PASSWORD=...` — this ran
the full suite green and was torn down afterwards.

Related: [[chalk-talk-doc-authority]]
