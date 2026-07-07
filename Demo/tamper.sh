#!/usr/bin/env bash
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DEMO_DIR/../../.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
ENV_FILE="$DEMO_DIR/.demo-env"
BUCKET="airstrings-bundles"

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found (run: make seed)"; exit 1; }
# shellcheck source=/dev/null
. "$ENV_FILE"

OBJECT="local/$BUCKET/$ORG_ID/$PROJECT_ID/$ENV_ID/en/bundle.json"

cd "$BACKEND_DIR"
mc() { docker compose exec -T minio mc "$@"; }
mc alias set local http://localhost:9000 minioadmin minioadmin >/dev/null

ORIG="$(mktemp)"
MUT="$(mktemp)"
trap 'rm -f "$ORIG" "$MUT"' EXIT

mc cat "$OBJECT" > "$ORIG"
# revision is signed metadata; changing it invalidates the Ed25519 signature and
# also changes the object bytes so MinIO returns a fresh ETag (no false 304).
sed -E 's/("revision"[[:space:]]*:[[:space:]]*)[0-9]+/\19999/' "$ORIG" > "$MUT"

if cmp -s "$ORIG" "$MUT"; then
  echo "ERROR: mutation produced identical bytes — bundle would keep its ETag and the SDK would 304 (tamper not exercised). Aborting."
  exit 1
fi

mc pipe "$OBJECT" < "$MUT"

echo "Tampered the en bundle in MinIO."
echo "  -> Press Refresh in the app: expect a strings:error with code SIGNATURE_VERIFICATION_FAILED."
echo "  -> Run 'make seed' to restore a clean, freshly signed bundle (revision +1)."
