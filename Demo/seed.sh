#!/usr/bin/env bash
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="http://localhost:8080"
EMAIL="demo@airstrings.local"
PASSWORD="demo-password-123"

echo "==> Checking backend health..."
curl -sf "$BASE/healthz" >/dev/null || { echo "ERROR: backend not running at $BASE (run: make stack)"; exit 1; }

echo "==> Authenticating ($EMAIL)..."
CREDS="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE/v1/auth/signup" -H 'Content-Type: application/json' -d "$CREDS")
STATUS=$(printf '%s' "$RESP" | tail -1)
BODY=$(printf '%s' "$RESP" | sed '$d')
if [ "$STATUS" -ge 400 ]; then
  RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE/v1/auth/login" -H 'Content-Type: application/json' -d "$CREDS")
  STATUS=$(printf '%s' "$RESP" | tail -1)
  BODY=$(printf '%s' "$RESP" | sed '$d')
  [ "$STATUS" -eq 200 ] || { echo "ERROR: login failed (HTTP $STATUS): $BODY"; exit 1; }
fi
TOKEN=$(printf '%s' "$BODY" | jq -r '.access_token')
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "ERROR: no access_token in auth response"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

echo "==> Resolving organization..."
ORG_ID=$(curl -sf "$BASE/v1/org/" -H "$AUTH" | jq -r '.id // .organization_id // .organization.id')
[ -n "$ORG_ID" ] && [ "$ORG_ID" != "null" ] || { echo "ERROR: could not resolve org id"; exit 1; }
echo "  org: $ORG_ID"

echo "==> Finding or creating project 'RN Demo'..."
PROJECT_ID=$(curl -sf "$BASE/v1/projects/" -H "$AUTH" | jq -r '.data | map(select(.name=="RN Demo")) | .[0].id // empty')
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(curl -sf -X POST "$BASE/v1/projects/" -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{"name":"RN Demo","default_locale":"en"}' | jq -r '.id')
fi
[ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "null" ] || { echo "ERROR: could not resolve project id"; exit 1; }
echo "  project: $PROJECT_ID"

echo "==> Resolving default environment..."
ENVS=$(curl -sf "$BASE/v1/projects/$PROJECT_ID/environments/" -H "$AUTH")
ENV_ID=$(printf '%s' "$ENVS" | jq -r '.data as $e | ($e | map(select(.is_default==true)) | .[0].id) // ($e | .[0].id)')
[ -n "$ENV_ID" ] && [ "$ENV_ID" != "null" ] || { echo "ERROR: could not resolve environment id"; exit 1; }
echo "  environment: $ENV_ID"

ENV_BASE="$BASE/v1/projects/$PROJECT_ID/environments/$ENV_ID"

echo "==> Reading environment public key..."
PUBLIC_KEY_B64=$(curl -sf "$ENV_BASE/" -H "$AUTH" | jq -r '.public_key')
[ -n "$PUBLIC_KEY_B64" ] && [ "$PUBLIC_KEY_B64" != "null" ] || { echo "ERROR: no public_key on environment"; exit 1; }

create_string() {
  local key="$1" format="$2" values="$3"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ENV_BASE/strings/" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"key\":\"$key\",\"format\":\"$format\",\"values\":$values}")
  if [ "$status" = "409" ]; then
    curl -s -o /dev/null -X PUT "$ENV_BASE/strings/$key/" \
      -H "$AUTH" -H 'Content-Type: application/json' \
      -d "{\"format\":\"$format\",\"values\":$values}"
    echo "  updated: $key"
  elif [ "$status" = "201" ] || [ "$status" = "200" ]; then
    echo "  created: $key"
  else
    echo "  WARN: $key -> HTTP $status"
  fi
}

echo "==> Seeding strings..."
create_string "greeting"           "text" '{"en":"Hello!","fr":"Bonjour !","es":"Hola!"}'
create_string "farewell"           "text" '{"en":"Goodbye!","fr":"Au revoir !","es":"Adios!"}'
create_string "app.title"          "text" '{"en":"AirStrings Demo","fr":"Démo AirStrings","es":"Demo AirStrings"}'
create_string "settings.theme"     "text" '{"en":"Theme"}'
create_string "settings.language"  "text" '{"en":"Language","fr":"Langue","es":"Idioma"}'
create_string "onboarding.welcome" "text" '{"en":"Welcome to AirStrings","fr":"Bienvenue sur AirStrings","es":"Bienvenido a AirStrings"}'
create_string "items.count"        "icu"  '{"en":"{count, plural, one {# item} other {# items}}","fr":"{count, plural, one {# article} other {# articles}}","es":"{count, plural, one {# elemento} other {# elementos}}"}'

echo "==> Publishing bundles (en, fr, es)..."
RESP=$(curl -s -w '\n%{http_code}' -X POST "$ENV_BASE/bundles/publish" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"locales":["en","fr","es"]}')
STATUS=$(printf '%s' "$RESP" | tail -1)
BODY=$(printf '%s' "$RESP" | sed '$d')
[ "$STATUS" -eq 200 ] || { echo "ERROR: publish failed (HTTP $STATUS): $BODY"; exit 1; }
printf '%s' "$BODY" | jq -r '.results[] | "  \(.locale): \(.status) rev \(.bundle.revision) -> \(.bundle.cdn_url)"'

cat > "$DEMO_DIR/.demo-env" <<EOF
ORG_ID='$ORG_ID'
PROJECT_ID='$PROJECT_ID'
ENV_ID='$ENV_ID'
PUBLIC_KEY_B64='$PUBLIC_KEY_B64'
EOF

echo "==> Wrote $DEMO_DIR/.demo-env"
echo "==> Seed complete. Next: make config"
