#!/usr/bin/env bash
# ============================================================================
# Pecsil Business OS — endurecimento do Supabase self-hosted
#
# Auditoria de 14/08/2026, feita de fora da rede da empresa, encontrou
# PostgreSQL (5432), pooler (6543) e o gateway (8000/8443) acessíveis pela
# internet, em HTTP puro. Conexão direta ao Postgres IGNORA todo o RLS —
# nenhuma das 57 policies protege esse caminho.
#
# Este script tranca o serviço no localhost. O tráfego externo passa a entrar
# somente por 443, via Caddy (ver infra/Caddyfile).
#
# EXECUTAR NO SERVIDOR, como root, no diretório do docker-compose do Supabase:
#   sudo bash harden-supabase.sh            # mostra o que faria
#   sudo bash harden-supabase.sh --apply    # aplica
#
# O script é idempotente e faz backup antes de alterar qualquer arquivo.
# ============================================================================

set -euo pipefail

APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
STAMP="$(date +%Y%m%d-%H%M%S)"

log()  { printf '\033[1;34m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

run() {
  if $APPLY; then
    eval "$@"
  else
    printf '    \033[2m[simulação] %s\033[0m\n' "$*"
  fi
}

$APPLY || warn "MODO SIMULAÇÃO — nada será alterado. Use --apply para valer."
echo

# ---------------------------------------------------------------------------
# 1. Estado atual das publicações de porta
# ---------------------------------------------------------------------------
log "Portas publicadas pelos contêineres do Supabase"
if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0|::' || ok "Nenhuma porta publicada em 0.0.0.0"
else
  die "docker não encontrado — rode este script no servidor do Supabase."
fi
echo

# ---------------------------------------------------------------------------
# 2. Prender as publicações ao localhost no docker-compose
#
# A causa da exposição é a forma "5432:5432", que o Docker publica em todas as
# interfaces. Trocando para "127.0.0.1:5432:5432" o serviço continua acessível
# ao Caddy e ao próprio host, mas some da internet.
#
# Importante: o Docker cria regras de iptables PRÓPRIAS que passam POR CIMA do
# ufw. Fechar só no firewall não resolve enquanto o bind for 0.0.0.0.
# ---------------------------------------------------------------------------
log "Prendendo publicações de porta a 127.0.0.1 em $COMPOSE_FILE"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  die "$COMPOSE_FILE não encontrado. Rode no diretório do compose ou defina COMPOSE_FILE=..."
fi

if $APPLY; then
  cp "$COMPOSE_FILE" "${COMPOSE_FILE}.bak-${STAMP}"
  ok "Backup: ${COMPOSE_FILE}.bak-${STAMP}"
fi

# Só as portas que não devem sair da máquina. A 8000 fica no localhost porque
# quem publica para fora agora é o Caddy.
for PORT in 5432 6543 8000 8443 3000; do
  if grep -qE "^\s*-\s*[\"']?${PORT}:${PORT}[\"']?\s*$" "$COMPOSE_FILE"; then
    log "  porta ${PORT}: publicada em todas as interfaces → prendendo ao localhost"
    run "sed -i -E 's|^(\s*)-\s*[\"'\'']?${PORT}:${PORT}[\"'\'']?\s*$|\1- \"127.0.0.1:${PORT}:${PORT}\"|' '$COMPOSE_FILE'"
  elif grep -qE "127\.0\.0\.1:${PORT}:" "$COMPOSE_FILE"; then
    ok "  porta ${PORT}: já presa ao localhost"
  else
    ok "  porta ${PORT}: não publicada"
  fi
done
echo

# ---------------------------------------------------------------------------
# 3. Firewall — defesa em profundidade
# ---------------------------------------------------------------------------
log "Regras de firewall"
if command -v ufw >/dev/null 2>&1; then
  run "ufw --force reset"
  run "ufw default deny incoming"
  run "ufw default allow outgoing"
  run "ufw allow 22/tcp comment 'SSH administrativo'"
  run "ufw allow 80/tcp comment 'Caddy - desafio ACME'"
  run "ufw allow 443/tcp comment 'Caddy - API Supabase'"
  run "ufw deny 5432/tcp comment 'PostgreSQL nunca exposto'"
  run "ufw deny 6543/tcp comment 'Pooler nunca exposto'"
  run "ufw deny 8000/tcp comment 'Kong somente via Caddy'"
  run "ufw deny 8443/tcp comment 'Kong somente via Caddy'"
  run "ufw deny 3000/tcp comment 'Studio somente por tunel SSH'"
  run "ufw --force enable"
  ok "ufw configurado"
elif command -v firewall-cmd >/dev/null 2>&1; then
  run "firewall-cmd --permanent --add-service=http"
  run "firewall-cmd --permanent --add-service=https"
  run "firewall-cmd --permanent --add-service=ssh"
  for P in 5432 6543 8000 8443 3000; do
    run "firewall-cmd --permanent --remove-port=${P}/tcp || true"
  done
  run "firewall-cmd --reload"
  ok "firewalld configurado"
else
  warn "Nem ufw nem firewalld encontrados — feche as portas no roteador."
fi
echo

# ---------------------------------------------------------------------------
# 4. Aplicar
# ---------------------------------------------------------------------------
log "Recriando os contêineres com as novas publicações"
run "docker compose up -d"
echo

# ---------------------------------------------------------------------------
# 5. Conferência local
# ---------------------------------------------------------------------------
log "Conferência (o que continua publicado em 0.0.0.0 é problema)"
if $APPLY; then
  sleep 4
  if docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0:(5432|6543|8000|8443|3000)'; then
    warn "Ainda há portas sensíveis em 0.0.0.0 — revise o compose manualmente."
  else
    ok "Nenhuma porta sensível publicada em 0.0.0.0"
  fi
fi
echo

cat <<'PROXIMOS'
──────────────────────────────────────────────────────────────────────────────
FALTA FAZER FORA DESTE SCRIPT

1. No roteador da empresa: encaminhar SOMENTE 80 e 443 para este servidor.
   Remover qualquer encaminhamento de 5432, 6543, 8000 e 8443.

2. Instalar o Caddy e copiar infra/Caddyfile para /etc/caddy/Caddyfile:
      sudo caddy validate --config /etc/caddy/Caddyfile
      sudo systemctl reload caddy

3. No .env do Supabase, apontar para o domínio HTTPS:
      API_EXTERNAL_URL=https://supabase.pecsil.com.br
      SUPABASE_PUBLIC_URL=https://supabase.pecsil.com.br
      SITE_URL=https://supabase.pecsil.com.br
   e reiniciar: docker compose up -d

4. Rotacionar as chaves — elas trafegaram em HTTP puro na internet aberta:
      node infra/rotate-jwt-keys.mjs --secret "<novo JWT_SECRET>"

5. Da estação de desenvolvimento, confirmar que o perímetro fechou:
      npm run check:perimeter
──────────────────────────────────────────────────────────────────────────────
PROXIMOS
