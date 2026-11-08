#!/usr/bin/env bash
# Verifies every Milki infra service answers on its fixed port (CLAUDE.md §5).
# Usage: ./infra/verify.sh   (exit code 0 = all good)
set -uo pipefail

cd "$(dirname "$0")"
REDIS_PASSWORD="${REDIS_PASSWORD:-milki_dev}"
MONGO_ROOT_USER="${MONGO_ROOT_USER:-milki}"
MONGO_ROOT_PASSWORD="${MONGO_ROOT_PASSWORD:-milki_dev}"
ME_USER="${ME_USER:-milki}"
ME_PASSWORD="${ME_PASSWORD:-milki_dev}"

fail=0
pass() { printf '  \033[32m✔\033[0m %-28s %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m✘\033[0m %-28s %s\n' "$1" "$2"; fail=1; }

# Retries a check for up to ~60s so this works right after `docker compose up`.
check() {
  local name="$1" port="$2"; shift 2
  for _ in $(seq 1 30); do
    if "$@" >/dev/null 2>&1; then pass "$name" ":$port"; return; fi
    sleep 2
  done
  bad "$name" ":$port not answering"
}

tcp_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

redis_ping() {
  # Speak raw RESP over TCP so the host needs no redis-cli.
  exec 3<>/dev/tcp/127.0.0.1/6390 || return 1
  printf 'AUTH %s\r\nPING\r\n' "$REDIS_PASSWORD" >&3
  local line ok=1
  while IFS= read -r -t 2 line <&3; do
    [[ "$line" == "+PONG"* ]] && { ok=0; break; }
  done
  exec 3>&-
  return $ok
}

mongo_ping() {
  docker exec milki-mongo mongosh --quiet \
    "mongodb://$MONGO_ROOT_USER:$MONGO_ROOT_PASSWORD@localhost:27017/admin" \
    --eval 'quit(db.adminCommand({ping:1}).ok === 1 ? 0 : 1)' && tcp_open 27117
}

smtp_banner() {
  exec 3<>/dev/tcp/127.0.0.1/1126 || return 1
  local banner=""
  IFS= read -r -t 2 banner <&3
  printf 'QUIT\r\n' >&3
  exec 3>&-
  [[ "$banner" == 220* ]]
}

echo "Milki infra: port verification"
check "MongoDB"            27117 mongo_ping
check "Mongo Express"      8181  curl -fsS -u "$ME_USER:$ME_PASSWORD" http://localhost:8181/
check "Redis"              6390  redis_ping
check "RedisInsight"       5541  curl -fsS http://localhost:5541/api/health
check "MinIO API"          9100  curl -fsS http://localhost:9100/minio/health/live
check "MinIO console"      9101  curl -fsS http://localhost:9101/
check "Mailpit SMTP"       1126  smtp_banner
check "Mailpit web UI"     8126  curl -fsS http://localhost:8126/livez

# Fabric ports must stay free of anything we run here.
for p in 7050 7051 7053 7054 8054 9051 9443 11051 11054 5984 7984 9984; do
  if docker compose ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$p->"; then
    bad "Fabric reserved port" ":$p is bound by the infra stack"
  fi
done

if [[ $fail -eq 0 ]]; then echo "All infra services healthy."; else echo "Some checks failed."; fi
exit $fail
