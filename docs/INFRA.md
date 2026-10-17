# Infraestrutura da PecSil — o que roda, onde e como recuperar

> Item **B-09** do [roadmap](ROADMAP.md). Este é o mapa da infraestrutura para quem precisar
> recuperar o servidor sem depender de memória: o proprietário, ou um técnico chamado numa pane.
> **Nenhuma senha, chave ou token fica aqui:** só os nomes e onde cada um mora.
>
> Atualizado em 17/10/2026. Toda mudança de infraestrutura (serviço novo, porta, variável, tarefa
> agendada, domínio) atualiza este arquivo no mesmo commit.
>
> Serviços, variáveis e tarefas conferidos pela API do Coolify em 17/10/2026 (só nomes e situação,
> nenhum valor).

---

## 1. Visão geral

Um servidor só, na empresa, com o Coolify administrando os aplicativos. O Supabase roda na mesma
máquina, mas **fora** do Coolify (docker-compose próprio).

```
Internet ── 181.224.8.145 (IP público) ── roteador da empresa
                                            │
                                  servidor "innovait-server" · 192.168.0.89 · Ubuntu
                                            │
              ┌─────────────────────────────┼──────────────────────────────┐
              │ Coolify 4.3.23 + Traefik (coolify-proxy), portas 80 e 443   │
              │   ├─ Business OS (Next.js)        home.pecsil.com.br        │
              │   ├─ Forja (compose: API, web, Postgres, MinIO)             │
              │   └─ Transmissor da NF-e (porta 3100, só rede interna)      │
              └─────────────────────────────────────────────────────────────┘
              Supabase (docker-compose fora do Coolify): Kong :8000, Postgres :5432,
              pooler :6543, :8443
```

- **Única entrada pensada para o público:** o Business OS em HTTPS. O navegador fala com o Supabase
  só por `https://home.pecsil.com.br/sb/*` (`app/sb/[...path]/route.ts`, que deixa passar auth,
  rest e storage). O servidor do Business OS fala com o Supabase direto, por `SUPABASE_INTERNAL_URL`.
- **A Forja** é alcançada pelo Business OS pelo Traefik interno: `http://coolify-proxy` com o
  cabeçalho `Host: forja.pecsil` (`lib/forja/client.ts` usa `node:http`, porque o `fetch` do Node
  descarta o Host).
- **O transmissor da NF-e** só fala com a SEFAZ e com o Business OS, pela rede interna
  (`TRANSMISSOR_URL`). Detalhe em [FISCAL-NFE.md](FISCAL-NFE.md).

## 2. Endereços e portas

| Endereço | O que é | Situação |
|---|---|---|
| `https://home.pecsil.com.br` | Business OS (a plataforma) | Público; a 80 redireciona para a 443 |
| `https://coolify.pecsil.com.br` | Painel e API do Coolify | Público (deveria ficar só na VPN: B-05) |
| `http://192.168.0.89:8001` · `http://181.224.8.145:8001` | Coolify direto, sem proxy | **Aberto também na internet, em HTTP** (painel e API sem criptografia; risco: B-05) |
| `181.224.8.145:8000` | Kong do Supabase (inclui `/pg/query`, SQL com a chave de serviço) | **Aberto na internet, em HTTP** (risco: B-01) |
| `181.224.8.145:5432`, `:6543`, `:8443` | Postgres, pooler e Kong TLS do Supabase | **Abertos na internet** (risco: B-01) |
| `181.224.8.145:22` | SSH do servidor | Recusa a senha conhecida (ver 7.4) |
| `forja.pecsil` | Forja, pelo Host no Traefik | Responde também pela 80 pública |
| `supabase.pecsil.com.br` | Nome antigo do Supabase | Não é mais usado; existia só no `/etc/hosts` de um Mac |

O porquê das portas do Supabase abertas: elas são publicadas pelo docker-compose em `0.0.0.0`;
fechar no roteador não resolve. A correção é no servidor e está em
[infra/README.md](../infra/README.md) e `infra/harden-supabase.sh` (exige acesso ao terminal).

## 3. Serviços

| Serviço | Como sobe | Código | Dados | Identificador no Coolify |
|---|---|---|---|---|
| Business OS | App do Coolify, build Railpack a partir do `main` (o Deploy leva uns 3 min) | este repositório | Supabase | `i3rwerhgkqqurapbrowuho1p` (app `pecsil--business--o-s`) |
| Forja | Compose do Coolify (`docker-compose.coolify.yml`) | `jusales3270/forja-pecsil` | Postgres próprio, banco **`forja_recuperado_20260911`**; MinIO | `f7dr7wdj87pbupkbfezrnnw5` |
| Transmissor da NF-e | App do Coolify, Dockerfile, Base Directory `/services/transmissor-nfe`, porta 3100 | este repositório (programa separado, GPL-3.0) | nenhum (não guarda nada) | `zqolizieqokegi4w9fihwxlo` (app `transmissor-nfe`) |
| Supabase | docker-compose manual, **fora** do Coolify | — | Postgres (`public`), Storage (buckets `empresa-documentos`, `rh-documents`…) | — |

Sobras no Coolify, todas paradas (não apagar sem decidir): o app do Business OS duplicado
`h4a3oomyalwvla9gftkrsw3o`, um app antigo da Forja `42cwu3qfy3lgmaozqayhfuyu` (Dockerfile, de
10/09) e 6 serviços (`supabase-kwify…`, `supabase-qxscp…`, `supabase-z0xcw…`, `supabase-d2czn…`,
`supabase` `q1lrw…` e `service-kha8x…`). O Supabase que responde **não** é nenhum deles. O Coolify
tem dois servidores cadastrados: `innovait-server` (192.168.0.89, onde rodam os apps) e
`localhost`. Proxy: Traefik, portas 80 e 443, certificado pelo Let's Encrypt.

O banco `forja`, no mesmo Postgres da Forja, está **fora de uso**. A Forja aponta para
`forja_recuperado_20260911`; toda migração da Forja em produção entra por SQL no terminal do
contêiner Postgres, com `-d forja_recuperado_20260911` (não existe `_prisma_migrations` lá).

## 4. Variáveis de ambiente (só os nomes)

Ficam no Coolify, em cada app. No Mac de desenvolvimento ficam no `.env.local`, que nunca vai para o
Git. **Nenhum segredo com o prefixo `NEXT_PUBLIC_`**: esse prefixo manda o valor para o navegador.

**Business OS**

| Variável | Para quê | Segredo? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Endereço do Supabase visto pelo navegador: `https://home.pecsil.com.br/sb` | não |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública do Supabase (protegida pelo RLS) | não |
| `SUPABASE_INTERNAL_URL` | Supabase pela rede interna (servidor) | não |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço (passa por cima do RLS) | **sim** |
| `FORJA_API_URL`, `FORJA_API_HOST` | Como chegar na Forja (`http://coolify-proxy`, `forja.pecsil`) | não |
| `FORJA_SERVICE_CODE`, `FORJA_SERVICE_PIN` | Conta de integração `pecsil-os` na Forja | **sim** |
| `FORJA_SYNC_SECRET` | Tarefa "Sincronizar OS do Forja" | **sim** |
| `FISCAL_DFE_SECRET` | Tarefa "Notas recebidas da SEFAZ" | **sim** |
| `DOCUMENTOS_LEITURA_SECRET` | Tarefa de leitura de documentos | **sim** |
| `MAIL_SYNC_SECRET` | Sincronização do e-mail do Comercial | **sim** |
| `TRANSMISSOR_URL`, `TRANSMISSOR_TIPO` | Onde está o transmissor da NF-e e qual implementação | não |
| `TRANSMISSOR_SECRET` | Cabeçalho `x-transmissor-secret` (o mesmo no transmissor) | **sim** |
| `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID` | App do Microsoft 365 (C-14, ainda não ligado) | não |
| `MS_GRAPH_CLIENT_SECRET` | Idem | **sim** |
| `CLOUDFLARE_ACCOUNT_ID` | Conta do Clef (modelo de decisão) | não |
| `CLOUDFLARE_AI_TOKEN` | Token só de Workers AI | **sim** |
| `TYPESAFE_API_KEY` | Jev (modelo antigo, substituído pelo Clef) | **sim** |
| `INITIAL_OWNER_NAME` | Nome do primeiro proprietário (instalação) | não |
| `NEXT_PUBLIC_LOGIN_VIDEO_URL` | Vídeo da tela de login | não |
| `NEXT_PUBLIC_APP_VERSION`, `SOURCE_COMMIT` | Versão mostrada no "Atualizar" (o Coolify preenche o commit) | não |

Só de scripts de migração antigos (Supabase Cloud → servidor), que não rodam mais:
`COMPRAS_CLOUD_URL`, `COMPRAS_CLOUD_KEY`, `PORTARIA_CLOUD_URL`, `PORTARIA_CLOUD_KEY`.

Preenchidas no Coolify em 17/10: as 15 da tabela que não são do e-mail, do Jev nem da instalação
(`MAIL_SYNC_SECRET` e `MS_GRAPH_*` entram com o C-14; `SOURCE_COMMIT` o próprio Coolify preenche).

**Forja:** `DATABASE_URL` (aponta para `forja_recuperado_20260911`), `JWT_SECRET` (**nunca vazio**:
vazio, vale a chave padrão do código aberto, e um token de administrador forjado entra; aconteceu
em 18/09/2026), `REDIS_URL`, `SERVICE_FQDN_FRONTEND`, `SERVICE_URL_FRONTEND`. **Vazias no Coolify
em 17/10:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `MINIO_ACCESS_KEY`,
`MINIO_SECRET_KEY` e os nomes dos buckets e a URL do MinIO. Se o compose cai num valor padrão para
elas, a senha do banco e do MinIO da Forja é a padrão do código (ver seção 8). Lista completa no
`DEPLOY.md` da Forja.

**Transmissor:** `TRANSMISSOR_SECRET` (o mesmo do Business OS). Ver [FISCAL-NFE.md](FISCAL-NFE.md).

**No Mac do proprietário:** token da API do Coolify em `~/.config/coolify/token`. Um 401
"Unauthenticated." sai igual para token errado, inventado ou ausente: comparar o arquivo com o
token criado antes de concluir que foi revogado.

## 5. Tarefas agendadas (Coolify, dentro do contêiner do Business OS)

| Tarefa | Comando | Frequência | O que faz |
|---|---|---|---|
| Sincronizar OS do Forja | `node scripts/sync-os-cron.mjs` | a cada 10 min (`*/10 * * * *`) | Espelho das OS e dos artigos da Forja |
| Notas recebidas da SEFAZ | `node scripts/fiscal-dfe-cron.mjs` | a cada 15 min (`*/15 * * * *`) | Distribuição de documentos da SEFAZ (respeita a espera da SEFAZ) |
| Leitura de documentos | `node scripts/leitura-documentos-cron.mjs` | a cada 5 min (`*/5 * * * *`) | Texto e OCR dos documentos guardados (Segundo Cérebro) |
| E-mail do Comercial | ver [CONEXAO-EMAIL-MICROSOFT.md](CONEXAO-EMAIL-MICROSOFT.md) | a cada 5 min | Só depois do Microsoft 365 (C-14) |

Cada script chama uma rota local com o segredo da tarefa e sai com erro se a rodada falhar, para a
falha aparecer no histórico da tarefa no Coolify. Criar tarefa pela API com um comando longo e cheio
de aspas dá erro 500: por isso cada tarefa é um script.

## 6. Banco e mudanças de estrutura

- **Migrações do Business OS:** `supabase/migrations/AAAAMMDDNNNN_nome.sql`, aplicadas uma a uma
  no Postgres do Supabase (por `/pg/query` com a chave de serviço, numa transação), **antes** do
  Deploy do código que depende delas. Não há aplicação automática no Deploy.
- **Fuso:** o papel `authenticator` está em `America/Sao_Paulo` (a plataforma vê a data de
  Brasília); conexões diretas por `/pg/query` seguem em UTC.
- **Cargas do sistema antigo** (`scripts/import-*.mjs --apply`): já foram feitas e **não se repetem**
  (Portaria, Compras, Financeiro, materiais do almoxarifado).
- **Forja:** SQL no terminal do contêiner Postgres, sempre com `-d forja_recuperado_20260911`.

## 7. Recuperação — o que fazer em cada pane

### 7.1 A plataforma não abre (HTTPS)

1. Testar de fora: `curl -I http://home.pecsil.com.br` e `curl -I https://home.pecsil.com.br`.
   - **80 responde e 443 não conecta:** é a porta 443 (já aconteceu várias vezes). Não é o código.
     Em 17/10/2026 a 443 ficou fechada de 23h22 em diante, antes e depois de um Deploy, com o
     Traefik rodando, a 443 publicada e nenhum reinício pendente no Coolify: a suspeita passa a ser
     o roteador ou a operadora. Pela internet, o Coolify responde em `http://181.224.8.145:8001`
     (sem HTTPS; usar o token por ali só em emergência e trocá-lo depois).
   - **443 responde "no available server" (503):** o Traefik está de pé, mas o aplicativo caiu. Ver
     no painel do Coolify se o app está "running" e o log do último Deploy.
2. **Não** usar "Restart proxy" no Coolify sem necessidade: em 11–12/10/2026 isso deixou o painel em
   "no available server". Resolveu desligando e ligando o servidor, com um toque **curto** no botão
   (desligamento seguro). O Ubuntu subiu normal.

### 7.2 Um Deploy quebrou o app

1. No Coolify, app do Business OS → Deployments → fazer o Deploy de novo do commit anterior.
2. Se o problema é a migração (erro de banco), nenhuma migração é desfeita sozinha: falar com quem
   aplicou; cada arquivo em `supabase/migrations` diz o que cria.

### 7.3 O banco do Supabase

- **Backup externo testado: não existe ainda** (item da recomendação de infraestrutura, a ser
  feito). O Coolify não administra nenhum banco (conferido em 17/10), então também não faz backup:
  nem do Supabase, nem do Postgres da Forja, que vive dentro do compose. Até lá, uma perda de disco
  do servidor perde os dois bancos.
- A restauração, quando o backup existir, entra aqui, com o passo a passo testado.

### 7.4 Acesso ao terminal do servidor

- Em 12/10/2026 o SSH (de fora e de dentro) recusou a senha que o proprietário tinha. **Hoje não há
  acesso ao terminal que funcione.** Recuperar uma senha válida com quem instalou o servidor, ou
  pelo modo de recuperação do Ubuntu, e guardá-la num cofre de senhas (B-03).
- Sem o terminal, ficam travados: fechar as portas do Supabase (B-01), a VPN (B-05) e a troca das
  chaves (B-03).

### 7.5 A Forja

- Recuperação do banco da Forja: `RECUPERACAO_COOLIFY.md` no repositório da Forja.
- Se o Deploy da Forja falhar por imagem do MinIO (401 no `quay.io`), o compose usa
  `pull_policy: if_not_present`, que aproveita a imagem já baixada.

## 8. Lacunas conhecidas

| Lacuna | Risco | Item do roadmap |
|---|---|---|
| Portas do Supabase (5432, 6543, 8000, 8443) abertas na internet, em HTTP | Banco inteiro protegido só pela senha e pela chave de serviço | B-01 |
| Sem acesso ao terminal (senha do SSH) | Nada se corrige no servidor | B-01, B-03 |
| Chaves que já trafegaram em HTTP ou ficaram num commit antigo | Precisam ser trocadas depois de fechar o perímetro | B-03 |
| Porta 443 instável | A plataforma some para quem está fora | B-06 |
| Coolify público, inclusive em HTTP pela porta 8001 | Painel de administração exposto; senha e token passam sem criptografia | B-05 |
| Senha do Postgres e chaves do MinIO da Forja vazias no Coolify | Podem estar no valor padrão do código | conferir no compose da Forja |
| Sobras paradas no Coolify (2 apps, 6 serviços) | Confusão numa recuperação | limpeza com OK do proprietário |
| Sem backup externo testado | Perda total numa pane de disco | — |
| Sem monitoramento com alerta | Ninguém é avisado quando cai | B-04 |
| Build no próprio servidor | O Deploy pesa na máquina da produção | B-07 |

Ver também: [infra/README.md](../infra/README.md) (perímetro do Supabase),
[PENDENCIA-INFRA-SUPABASE.md](PENDENCIA-INFRA-SUPABASE.md),
[IMPLANTACAO-SUPABASE-PECSIL.md](IMPLANTACAO-SUPABASE-PECSIL.md), [FISCAL-NFE.md](FISCAL-NFE.md).
