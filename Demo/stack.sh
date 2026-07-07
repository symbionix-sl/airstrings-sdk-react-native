#!/usr/bin/env bash
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DEMO_DIR/../../.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
DATABASE_URL="${DATABASE_URL:-postgres://airstrings:airstrings@localhost:5432/airstrings?sslmode=disable}"
BUCKET="airstrings-bundles"

echo "==> Starting Postgres + MinIO..."
cd "$BACKEND_DIR"
docker compose up -d --wait

# Migrations 012/013 DROP+recreate signing_keys, so re-applying on an already-migrated
# DB wipes keys. Only migrate a fresh database.
if psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.organizations')" 2>/dev/null | grep -q organizations; then
  echo "==> Database already initialized, skipping migrations."
else
  echo "==> Applying migrations..."
  for f in "$BACKEND_DIR"/migrations/*.up.sql; do
    psql "$DATABASE_URL" -q -f "$f" >/dev/null 2>&1 || true
  done
fi

echo "==> Provisioning MinIO bucket ($BUCKET)..."
docker compose exec -T minio mc alias set local http://localhost:9000 minioadmin minioadmin >/dev/null
docker compose exec -T minio mc mb --ignore-existing "local/$BUCKET" >/dev/null
docker compose exec -T minio mc anonymous set download "local/$BUCKET" >/dev/null

echo "==> Ensuring dev key-encryption key..."
mkdir -p "$REPO_ROOT/.local"
[ -f "$REPO_ROOT/.local/dev-kek" ] || openssl rand -base64 32 > "$REPO_ROOT/.local/dev-kek"

if curl -sf http://localhost:8080/healthz >/dev/null 2>&1; then
  echo "==> Backend already running on :8080."
  exit 0
fi

echo "==> Starting backend (go run ./cmd/server)..."
cd "$BACKEND_DIR"
DATABASE_URL="$DATABASE_URL" \
JWT_SECRET=dev-jwt-secret \
KEY_ENCRYPTION_KEY="$(cat "$REPO_ROOT/.local/dev-kek")" \
R2_ENDPOINT=http://localhost:9000 \
R2_ACCESS_KEY=minioadmin \
R2_SECRET_KEY=minioadmin \
CDN_BASE_URL="http://localhost:9000/$BUCKET" \
  go run ./cmd/server >"$DEMO_DIR/.stack-server.log" 2>&1 &
echo $! > "$DEMO_DIR/.stack-server.pid"

echo "==> Waiting for backend health..."
for _ in $(seq 1 60); do
  if curl -sf http://localhost:8080/healthz >/dev/null 2>&1; then
    echo "==> Backend healthy on :8080."
    exit 0
  fi
  sleep 1
done

echo "ERROR: backend did not become healthy — see $DEMO_DIR/.stack-server.log"
exit 1
