#!/usr/bin/env bash
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DEMO_DIR/.demo-env"
BUCKET="airstrings-bundles"
CDN_BASE="http://localhost:9000/$BUCKET"
API_BASE="http://localhost:8080"

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found (run: make seed)"; exit 1; }
# shellcheck source=/dev/null
. "$ENV_FILE"

for v in ORG_ID PROJECT_ID ENV_ID PUBLIC_KEY_B64; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "ERROR: $v missing in $ENV_FILE"; exit 1; }
done

cat > "$DEMO_DIR/demo.config.generated.ts" <<EOF
export const DEMO = {
  organizationId: '$ORG_ID',
  projectId: '$PROJECT_ID',
  environmentId: '$ENV_ID',
  publicKeys: ['$PUBLIC_KEY_B64'],
  locale: 'en',
  apiBaseURL: '$API_BASE',
} as const
EOF
echo "==> Wrote demo.config.generated.ts"

BUNDLE_DIR="$DEMO_DIR/airstrings/bundles"
mkdir -p "$BUNDLE_DIR"
for locale in en fr es; do
  url="$CDN_BASE/$ORG_ID/$PROJECT_ID/$ENV_ID/$locale/bundle.json"
  curl -sf "$url" -o "$BUNDLE_DIR/$locale.json" || { echo "ERROR: could not fetch $url"; exit 1; }
  echo "  seeded $locale.json"
done

echo "==> Config + seed bundles ready. Next: make ios (or make android)"
