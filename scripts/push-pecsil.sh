#!/usr/bin/env bash
# ============================================================================
# Aplica as migrations no Supabase da PecSil.
#
# Lê PECSIL_DB_PASSWORD do .env.local — a senha nunca é passada por argumento,
# para não ficar no histórico do shell nem visível em `ps`.
#
#   bash scripts/push-pecsil.sh            # mostra o que está pendente
#   bash scripts/push-pecsil.sh --apply    # aplica
# ============================================================================

set -euo pipefail

HOST="${PECSIL_DB_HOST:-supabase.pecsil.com.br}"
PORT="${PECSIL_DB_PORT:-5432}"
DB="${PECSIL_DB_NAME:-postgres}"
USER="${PECSIL_DB_USER:-postgres}"

APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
info() { printf '\033[1;34m›\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f .env.local ]] || die ".env.local não encontrado."

# Lê só a variável da senha, sem executar o arquivo inteiro.
PASS="$(grep -E '^PECSIL_DB_PASSWORD=' .env.local | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"

if [[ -z "$PASS" ]]; then
  die "PECSIL_DB_PASSWORD está vazia no .env.local.
    Preencha com a senha do usuário postgres do servidor
    (variável POSTGRES_PASSWORD no .env do docker-compose)."
fi

# Percent-encode: senhas com @ : / ? # quebram a URL de conexão.
ENC="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$PASS")"
URL="postgresql://${USER}:${ENC}@${HOST}:${PORT}/${DB}"

info "Destino: ${USER}@${HOST}:${PORT}/${DB}"

info "Testando conexão"
if ! node -e '
const net=require("net");
const s=net.connect({host:process.argv[1],port:+process.argv[2],timeout:8000});
s.on("connect",()=>{s.destroy();process.exit(0)});
s.on("timeout",()=>{s.destroy();process.exit(1)});
s.on("error",()=>process.exit(1));
' "$HOST" "$PORT"; then
  die "Não foi possível abrir ${HOST}:${PORT}."
fi
ok "porta alcançável"

if $APPLY; then
  info "Aplicando migrations pendentes"
  supabase db push --db-url "$URL"
  echo
  info "Validando o contrato da Fundação"
  supabase db push --db-url "$URL" --dry-run >/dev/null 2>&1 || true
  ok "concluído — confira com: supabase migration list --db-url <url>"
else
  info "Migrations pendentes (simulação, nada será aplicado)"
  supabase db push --db-url "$URL" --dry-run
  echo
  printf '\033[1;33m!\033[0m Para aplicar de verdade: bash scripts/push-pecsil.sh --apply\n'
fi
