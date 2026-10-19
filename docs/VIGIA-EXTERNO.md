# Vigia externo (T-03)

O vigia avisa quando a fábrica cai e guarda o histórico das quedas, com início, fim e causa
provável. Ele roda **fora do servidor da fábrica**, num projeto Supabase na nuvem, porque o monitor
não pode ficar no servidor que vigia ([PLANO-TI.md](PLANO-TI.md) §3.1).

## Como funciona

| Peça | Onde roda | O que faz |
|---|---|---|
| Sinal de vida | Servidor da fábrica, tarefa do Coolify a cada minuto (`scripts/ti-sinal-cron.mjs`) | Avisa que está de pé e leva o tempo ligado do servidor, a carga, a memória e o disco livres, e se a plataforma, o banco e a Forja respondem por dentro |
| Testes de fora | Supabase da nuvem, a cada minuto (pg_cron + pg_net) | Internet da fábrica (`http://181.224.8.145/`, qualquer resposta vale) e plataforma pela 443 (`https://home.pecsil.com.br/api/version`) |
| Regra da causa | Supabase da nuvem (`infra/vigia/001_vigia.sql`) | Cruza o sinal com os testes de fora e decide a causa provável, por regra e sem modelo |
| Alerta | API oficial do WhatsApp (Meta Cloud API) | "Caiu" e "voltou" para os números cadastrados. Sem canal configurado, o alerta fica registrado como `sem_canal` |

**Causa provável (regra):**

| O que o vigia vê | Causa |
|---|---|
| Parou o sinal e a internet da fábrica não responde de fora | Sem contato com a fábrica: energia, servidor ou internet |
| Parou o sinal, mas a internet da fábrica responde | O servidor ou a plataforma travou |
| O sinal continua, mas a 443 falha | Acesso de fora pela porta 443 (HTTPS, proxy ou porta) |
| Na volta, o servidor está ligado há menos tempo que a queda | **O servidor reiniciou: queda de energia ou reinício** |
| Na volta, o servidor ficou ligado o tempo todo | Faltou contato: internet ou rede da fábrica |

O tempo ligado também é a prova do T-01: depois de configurar a BIOS para religar sozinha, uma queda
de energia aparece no histórico como "reiniciou durante a queda", sem ninguém ter ido à fábrica.

O alerta "caiu" sai depois de cerca de 3 minutos sem sinal (tolerância de 180 s) ou de 2 testes de
fora seguidos com falha. Assim, uma oscilação de segundos não vira alarme.

## Instalação

1. **Projeto na nuvem (proprietário):** criar um projeto no supabase.com, de preferência na região
   São Paulo; o plano gratuito basta. Ele **não é** o Supabase da fábrica.
2. **SQL:** no SQL Editor do projeto, colar e rodar `infra/vigia/001_vigia.sql`. Isso cria as
   tabelas, as funções, o agendamento de cada minuto e os 3 alvos. Pode rodar de novo sem problema.
3. **Token do servidor:** no SQL Editor, rodar `select vigia_novo_token('servidor-pecsil');` e
   copiar o resultado. O banco guarda só o hash, então o token não aparece de novo.
4. **Variáveis no Coolify** (aplicação do Business OS, sem `NEXT_PUBLIC_`):
   - `VIGIA_URL`: endereço do projeto, por exemplo `https://xxxx.supabase.co`;
   - `VIGIA_CHAVE`: chave pública do projeto (publishable ou anon);
   - `VIGIA_TOKEN`: o token do passo 3.
5. **Tarefa agendada no Coolify** (aplicação do Business OS): comando
   `node scripts/ti-sinal-cron.mjs`, frequência `* * * * *`.
6. **Painel para o módulo de TI (T-06):** no SQL Editor, rodar `infra/vigia/003_painel.sql`. Ele cria
   a função `vigia_painel`, que o Business OS chama com o mesmo `VIGIA_TOKEN` para mostrar a saúde e
   copiar as quedas. Sem telefone, sem token. A tarefa do sinal de vida passa a copiar as quedas
   para a plataforma a cada minuto, com as variáveis `SUPABASE_INTERNAL_URL` e
   `SUPABASE_SERVICE_ROLE_KEY` que o contêiner já tem.
7. **Conferir:** no SQL Editor, `select id, estado, ultimo_sinal from vigia_alvos;`. Em até 2
   minutos, os três ficam `ok`. Lembrete: a 443 estava fora em 18/10, então a plataforma externa
   pode aparecer `fora`, e isso é um achado real do B-06.

## WhatsApp (quando o chip dedicado existir)

1. Número dedicado, sem uso no aplicativo do WhatsApp, cadastrado numa conta do **Meta Business**
   (WhatsApp Business Platform, Cloud API).
2. Modelo de mensagem aprovado pela Meta, categoria utilidade, com um parâmetro no corpo, por
   exemplo `Alerta de TI: {{1}}`.
3. No SQL Editor do projeto do vigia:

```sql
select vault.create_secret('<token permanente da Meta>', 'vigia_whatsapp_token');
insert into vigia_config (chave, valor) values
  ('whatsapp_phone_id', '<Phone number ID da Meta>'),
  ('whatsapp_template', '<nome do modelo aprovado>')
on conflict (chave) do update set valor = excluded.valor;
insert into vigia_destinos (numero, nome) values ('55DDDNUMERO', 'Supervisor de TI');
```

A partir daí, os alertas novos saem pelo WhatsApp. Os que ficaram `sem_canal` não são reenviados,
porque já perderam o momento.

## Consultas úteis (SQL Editor)

```sql
-- Histórico de quedas
select alvo, vigia_hora(inicio) inicio, vigia_hora(fim) fim,
       vigia_duracao(extract(epoch from coalesce(fim, now()) - inicio)) duracao, causa
from vigia_incidentes order by inicio desc limit 50;
-- Alertas
select tipo, situacao, texto, erro from vigia_alertas order by criado_em desc limit 20;
```

O módulo de TI no Business OS (T-06) vai mostrar esse histórico na plataforma.

## Teste

`tests/ti-vigia.test.mjs` cobre o sinal (números do servidor, testes por dentro, envio e recusa) e
as garantias do SQL: só a função de sinal é pública, todas as tabelas têm RLS, nenhum token fica
guardado em claro e o token do WhatsApp fica só no Vault.

O SQL foi testado em 18/10/2026, 12 de 12, num Postgres do Supabase descartável (pg_cron e pg_net
de verdade), com:
- a queda só da 443;
- a queda total;
- a volta com reinício e a volta sem reinício;
- o envio pela API do WhatsApp simulada.

O caminho completo também foi testado: script → PostgREST → função (token certo grava, token errado
recebe 401 e a leitura da tabela pela API pública volta vazia).
