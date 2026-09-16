# Infraestrutura — Supabase da Pecsil

Runbook para fechar o perímetro e habilitar a integração real. Siga na ordem.

## Topologia de produção (Coolify) — setembro/2026

A plataforma inteira roda no Coolify do servidor da PecSil. **A única porta
pública é o Business OS, em HTTPS.** O Supabase não é publicado para fora.

```
Internet ──HTTPS──▶ Traefik (Coolify) ──▶ Business OS (Next.js)
                                            │  /sb/auth/v1, /sb/rest/v1, /sb/storage/v1
                                            └──rede Docker interna──▶ Kong :8000 ──▶ Supabase
```

- O navegador usa `NEXT_PUBLIC_SUPABASE_URL=https://<business-os>/sb`. O handler
  `app/sb/[...path]/route.ts` repassa ao Kong e responde 404 para qualquer outra
  API (postgres-meta, analytics, functions).
- O servidor Next fala direto com `SUPABASE_INTERNAL_URL` (rotas de API, proxy de sessão).
- O cookie de sessão tem nome fixo (`sb-pecsil-auth-token`), independente do hostname.
- No Supabase (GoTrue): `SITE_URL=https://<business-os>`,
  `API_EXTERNAL_URL=https://<business-os>/sb`.
- Nenhuma porta do Supabase (5432, 6543, 8000, 8443, 3000) publicada no host.
  O Caddy e o domínio `supabase.pecsil.com.br` descritos abaixo deixam de ser usados.
- Histórico da Portaria: `node scripts/import-portaria-json.mjs --apply` (uma vez).

O restante deste documento é o runbook anterior (Supabase exposto por compose
manual) e serve de referência para o diagnóstico de portas.

**Situação em 14/08/2026:** o Supabase responde em `181.224.8.145` (IP público)
com PostgreSQL, pooler e gateway acessíveis pela internet, em HTTP puro.
Verificação: `npm run check:perimeter`.

---

## Diagnóstico: a exposição está no Docker, não no roteador

Em 14/08/2026 testamos fechar as portas no roteador da empresa. **Não teve
efeito** — a 5432 continuou respondendo no nível de aplicação. A varredura
revelou o padrão que explica por quê:

| Porta | Estado | Bind do Docker |
|---|---|---|
| 3000 (Studio) | fechada | `127.0.0.1` (só local) |
| 5432, 6543, 8000, 8443 | **abertas** | `0.0.0.0` (todas as interfaces) |
| 9000, 4000, 5000, 7000 (aleatórias) | fechadas | nada escuta |

As portas abertas são **exatamente** as que o `docker-compose` publica em
`0.0.0.0`. As aleatórias fechadas descartam DMZ. Conclusão: o IP público chega
direto no servidor e a exposição é o **bind do Docker**, não encaminhamento de
porta. Mexer no roteador não resolve — **o fix é obrigatoriamente na máquina do
servidor** (passo 2 abaixo), que exige shell/root.

## Por que isto importa

Conexão direta ao PostgreSQL **não passa por RLS**. As 57 policies protegem o
caminho PostgREST/GoTrue; um cliente `psql` autenticado vê tudo. Com a 5432
aberta na internet, o único obstáculo entre um desconhecido e o banco inteiro é
a senha do Postgres — sem limite de tentativas e sem registro de auditoria.

O schema e o provisionamento já foram aplicados (pelo SQL Editor, via 8000). O
risco cresce à medida que dados reais de RH e Financeiro entram.

---

## Ordem de execução

### 1 — Roteador da empresa (provavelmente não se aplica)

O diagnóstico acima indica que **não há encaminhamento de porta a remover** — o
servidor está direto no IP público. Confira mesmo assim: se o roteador estiver
em modo bridge/pass-through, pule direto para o passo 2. Se houver regras de
encaminhamento, mantenha só 80 e 443; remova 5432, 6543, 8000, 8443, 3000.

### 2 — Endurecer o servidor  ⟵ é aqui que a exposição fecha

No diretório do `docker-compose.yml` do Supabase, como root:

```bash
sudo bash harden-supabase.sh            # simula, não altera nada
sudo bash harden-supabase.sh --apply    # aplica
```

O script prende as publicações de porta a `127.0.0.1` e configura ufw/firewalld.
Faz backup do compose antes de mexer.

> **Por que não basta o firewall:** o Docker escreve regras de iptables próprias
> que passam por cima do ufw. Enquanto o bind for `0.0.0.0`, a porta continua
> alcançável. Por isso o script corrige os dois.

### 3 — Caddy

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O certificado sai sozinho: o DNS já resolve e o IP é público.

### 4 — Apontar o Supabase para o domínio

No `.env` do Supabase:

```
API_EXTERNAL_URL=https://supabase.pecsil.com.br
SUPABASE_PUBLIC_URL=https://supabase.pecsil.com.br
SITE_URL=https://supabase.pecsil.com.br
```

```bash
docker compose up -d
```

### 5 — Confirmar de fora

Da estação de desenvolvimento:

```bash
npm run check:perimeter
```

Precisa passar **antes** de seguir. Se algo continuar aberto, pare aqui.

### 6 — Rotacionar as chaves

As chaves atuais trafegaram em HTTP puro na internet aberta e devem ser tratadas
como comprometidas.

```bash
node infra/rotate-jwt-keys.mjs --generate-secret
```

Cole o resultado no `.env` do servidor e no `.env.local` do projeto, reinicie os
contêineres e o `npm run dev`.

> Rotacionar invalida todas as sessões abertas. Faça fora do horário de operação.

### 7 — Backup antes da primeira migration

```bash
docker exec -t supabase-db pg_dumpall -U postgres > backup-$(date +%F).sql
```

### 8 — Migrations

Não copie SQL para o SQL Editor. O CLI aplica na ordem certa e registra o que
já rodou em `supabase_migrations.schema_migrations`, então repetir o comando é
seguro: ele aplica apenas o que estiver pendente.

Depois do endurecimento o Postgres só aceita conexão local, então abra um túnel:

```bash
ssh -L 5433:127.0.0.1:5432 usuario@servidor-interno
```

E, em outro terminal, na raiz do projeto:

```bash
supabase db push --db-url "postgresql://postgres:SENHA@127.0.0.1:5433/postgres"
```

> A senha precisa estar percent-encoded se tiver caracteres especiais.

Migrations do pacote atual:

| # | Arquivo | O que entrega |
|---|---|---|
| 1 | `202607140001_foundation.sql` | 14 tabelas, 27 policies, funções de acesso |
| 2 | `202607150001_module_registry_and_security.sql` | catálogo de módulos, `can_access_module()` |
| 3 | `202608040001_finance_permissions.sql` | permissões do Financeiro |
| 4 | `202608040002_finance_v1.sql` | 10 tabelas do Financeiro, 26 policies |
| 5 | `202608140001_table_grants.sql` | privilégios de DML — **sem esta, tudo retorna 403** |

Conferir o contrato depois de aplicar:

```bash
psql "postgresql://postgres:SENHA@127.0.0.1:5433/postgres" \
  -f supabase/tests/001_foundation_contract.sql
```

Esperado: `Contrato da Fundação Pecsil validado: 16 tabelas, RLS e autorização
modular presentes.`

### 9 — Provisionar

1. Criar o proprietário no Supabase Auth (o bootstrap não cria conta nem senha).
2. Preencher `INITIAL_OWNER_EMAIL` e `INITIAL_OWNER_NAME` no `.env.local`.
3. `npm run supabase:bootstrap`

### 10 — Critérios de aceite

- [ ] `npm run check:perimeter` passa sem falha
- [ ] 16 tabelas da Fundação existem com RLS ativo
- [ ] `can_access_module()` retorna falso sem habilitação **ou** sem permissão
- [ ] Usuário comum não altera catálogo, ativações nem auditoria
- [ ] Login real funciona e o menu é montado por permissão
- [ ] Isolamento por organização verificado com dois usuários de escopos distintos

---

## Acesso ao Studio

O Studio não é publicado. Use túnel SSH de uma estação autorizada:

```bash
ssh -L 3000:127.0.0.1:3000 usuario@servidor-interno
```

E abra `http://localhost:3000`. Publicar o Studio equivale a publicar um console
com poder de `service_role`.

---

## Arquivos

| Arquivo | Onde roda |
|---|---|
| `Caddyfile` | servidor, em `/etc/caddy/` |
| `harden-supabase.sh` | servidor, como root |
| `rotate-jwt-keys.mjs` | estação, offline |
| `../scripts/check-perimeter.mjs` | estação, contra o servidor |
