# Pendência de infraestrutura — Supabase Pecsil

Status: **exposição pública identificada em 14/08/2026.** A correção é
executável hoje e não depende mais de acesso presencial.

## O que mudou desde a versão anterior deste documento

A versão anterior dizia que faltava domínio HTTPS e que o Supabase só existia em
rede interna. Ambas as premissas estavam erradas:

- `supabase.pecsil.com.br` **já resolve**, para `181.224.8.145` — IP público.
- O Supabase **não está** restrito à LAN. Responde da internet aberta.

## Situação medida

Verificação feita de fora da rede da empresa, com `npm run check:perimeter`:

| Porta | Serviço | Estado | Risco |
|---|---|---|---|
| 5432 | PostgreSQL | 🔴 acessível | Conexão direta **ignora todo o RLS** |
| 6543 | Pooler (Supavisor) | 🔴 acessível | Mesmo alcance do banco |
| 8000 | Kong HTTP | 🔴 acessível | API e chaves em texto claro |
| 8443 | Kong TLS | 🔴 acessível | Sem certificado válido |
| 3000 | Studio | ✅ fechada | — |
| 443 | HTTPS | ⚠️ sem resposta | Caddy ainda não publica |

### Por que a 5432 é o item mais grave

As 57 policies de RLS protegem o caminho PostgREST/GoTrue. Um cliente `psql`
autenticado no banco **não passa por elas** — vê e altera tudo. Com a porta
aberta na internet, o único obstáculo é a senha do Postgres, sem limite de
tentativas e sem trilha de auditoria.

### Consequência para as chaves

`ANON_KEY` e `SERVICE_ROLE_KEY` trafegaram por HTTP puro na internet aberta.
Devem ser tratadas como comprometidas e rotacionadas **depois** de fechar o
perímetro. A `SERVICE_ROLE_KEY` ignora RLS por definição.

## Diagnóstico (14/08/2026): a exposição é o bind do Docker, não o roteador

Tentamos fechar as portas no roteador da empresa e **não teve efeito**. A
varredura externa mostrou o padrão que explica por quê:

- Abertas: **5432, 6543, 8000, 8443** — exatamente as que o `docker-compose`
  publica em `0.0.0.0`.
- Fechada: **3000** (Studio) — publicada só em `127.0.0.1`.
- Fechadas: portas aleatórias (9000, 4000, 5000, 7000) — **descarta DMZ**.

Conclusão: o IP público chega direto no servidor; a exposição é o **bind do
Docker em `0.0.0.0`**, não encaminhamento de porta. Mexer no roteador não
resolve. **O fix é obrigatoriamente na máquina do servidor** e exige shell/root.

## Correção

Runbook completo e ordenado em [`infra/README.md`](../infra/README.md).

Resumo:

1. ~~Roteador~~ — não se aplica (não há encaminhamento; servidor direto no IP
   público). Confirmar se o roteador está em bridge.
2. Servidor: `sudo bash infra/harden-supabase.sh --apply` — prende as portas a
   `127.0.0.1` e configura o firewall. **É aqui que a exposição fecha.**
3. Caddy com `infra/Caddyfile` — certificado Let's Encrypt automático.
4. `.env` do Supabase apontando para `https://supabase.pecsil.com.br`.
5. Confirmar de fora: `npm run check:perimeter`.
6. Rotacionar chaves: `node infra/rotate-jwt-keys.mjs --generate-secret`.

> **Firewall sozinho não resolve.** O Docker escreve regras de iptables próprias
> que passam por cima do ufw. Enquanto a publicação for `0.0.0.0:5432:5432`, a
> porta continua alcançável. O script corrige o bind e o firewall.

## Estado atual (por decisão do usuário)

O perímetro segue **aberto**, por escolha consciente de tocar o desenvolvimento
primeiro. Não bloqueia o trabalho — a aplicação conecta pela 8000. Retomar
quando houver acesso shell ao servidor.

## Ferramentas criadas

| Arquivo | Função |
|---|---|
| [`infra/Caddyfile`](../infra/Caddyfile) | Proxy HTTPS para o Kong, com HSTS |
| [`infra/harden-supabase.sh`](../infra/harden-supabase.sh) | Prende portas ao localhost e configura firewall |
| [`infra/rotate-jwt-keys.mjs`](../infra/rotate-jwt-keys.mjs) | Gera novo par ANON/SERVICE_ROLE |
| [`scripts/check-perimeter.mjs`](../scripts/check-perimeter.mjs) | Verifica o perímetro de fora |

## O que pode avançar em paralelo

- Pacote SQL: já validado offline (`npm run supabase:validate` — 4 migrations,
  26 tabelas, bootstrap íntegro).
- Schema do RH: **não existe** e é a maior lacuna funcional (divergência D6 do
  Blueprint). Pode ser escrito antes do servidor estar pronto.
- Catálogo de módulos: completar `planned.ts` e o seed do bootstrap com os 10
  domínios (divergência D3).

## Critério para considerar encerrada

`npm run check:perimeter` sai com código 0: banco e pooler inacessíveis, API
somente por HTTPS com cadeia confiável.
