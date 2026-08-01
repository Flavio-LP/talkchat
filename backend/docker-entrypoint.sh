#!/bin/bash
set -e

# Stale PID from a previous container run would make Puma refuse to start.
rm -f /app/tmp/pids/server.pid

# Idempotent: creates the databases on first run, migrates on every run after.
# Both development and test DBs are prepared so `docker compose exec backend
# bin/rspec` works without a separate setup step.
bin/rails db:prepare
RAILS_ENV=test bin/rails db:prepare

exec "$@"
