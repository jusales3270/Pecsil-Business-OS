#!/usr/bin/env bash
# DEPRECATED: o procedimento antigo reiniciava contêineres, resetava UFW e prendia
# portas a localhost, interrompendo os clientes que usam o endereço LAN do host.
# Substituído por protect-public-ports.py e docs/SECURITY-ROLLOUT.md.
set -euo pipefail
printf '%s\n' 'Procedimento antigo desativado: nenhuma alteração será executada.'
printf '%s\n' 'Leia docs/SECURITY-ROLLOUT.md e gere primeiro um plano com infra/protect-public-ports.py.'
if [[ "${1:-}" == "--apply" ]]; then
  printf '%s\n' '--apply recusado: o procedimento antigo não é seguro para a topologia atual.' >&2
  exit 1
fi
