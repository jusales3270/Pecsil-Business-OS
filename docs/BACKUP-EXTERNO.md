# Backup externo (T-02 = B-02)

Uma cópia diária do banco da plataforma, do banco da Forja e dos arquivos da plataforma, guardada
**fora da fábrica**, no mesmo projeto Supabase da nuvem do [vigia](VIGIA-EXTERNO.md). Antes disso,
nenhum backup saía do servidor: uma pane de disco perdia tudo ([PLANO-TI.md](PLANO-TI.md) §10).

## As três garantias

1. **Criptografado antes de sair.** O backup leva tudo: CPF, salários, CID, documentos do RH e as
   fotos de cadastro da Portaria. Cada arquivo é criptografado no servidor com o `age`, usando a
   **chave pública** da PecSil. A **chave privada** fica só com o proprietário. A nuvem guarda um
   arquivo que ela mesma não consegue ler. Sem a chave privada, ninguém abre o backup, nem a PecSil:
   ela precisa ficar guardada em dois lugares fora do servidor.
2. **O servidor só grava.** O serviço entra na nuvem com um usuário que só tem permissão de inserir
   no bucket `backups`: não lista, não sobrescreve e não apaga. No banco da fábrica, ele usa o papel
   `backup_leitura`, que lê tudo e não altera nada. Se o servidor for invadido, as cópias antigas
   continuam lá. Quem apaga as cópias vencidas é a nuvem.
3. **A restauração é testada.** Ver "Restaurar" abaixo. O backup só conta como entregue depois de uma
   restauração real feita do começo ao fim.

**Fora do backup:** os desenhos da Forja, que serão guardados na plataforma, no módulo da Fundição
(decisão do proprietário de 18/10). O bucket deles entra em `BACKUP_EXCLUIR_BUCKETS`.

## Retenção

| Período | O que fica |
|---|---|
| Últimos 8 dias | Uma cópia por dia |
| Até 5 semanas | A cópia de domingo |
| Sempre | Os 30 arquivos mais recentes, mesmo se o backup tiver parado |

Tamanho medido em 18/10: o backup do banco da plataforma ficou com 22,9 MB criptografado, e os
arquivos têm 40 MB. O plano gratuito (1 GB, até 50 MB por arquivo) basta. O serviço divide em partes de 45 MB o que passar disso.

## Aviso

Cada backup completo avisa o vigia (alvo `backup-pecsil`). Se passarem **26 h** sem aviso, o vigia
abre um incidente ("o backup diário não chegou") e manda o alerta como em qualquer queda.

## Instalação

**Na nuvem** (projeto do vigia):

1. Rodar `infra/vigia/002_backup.sql` no SQL Editor, depois do `001_vigia.sql`.
2. Em *Authentication › Users*, criar o usuário do backup (por exemplo `backup@pecsil.com.br`, senha
   forte) e copiar o id dele.
3. No SQL Editor:

```sql
insert into vigia_config (chave, valor) values
  ('backup_user_id', '<id do usuário do passo 2>'),
  ('projeto_url', 'https://<projeto>.supabase.co')
on conflict (chave) do update set valor = excluded.valor;
-- chave de serviço do PRÓPRIO projeto do vigia, para a limpeza das cópias vencidas
select vault.create_secret('<service_role do projeto do vigia>', 'vigia_service_key');
select vigia_novo_token('backup-pecsil');  -- copiar: vai em BACKUP_TOKEN
```

**A chave do backup** (no Mac do proprietário, uma vez só):

```bash
brew install age
age-keygen -o pecsil-backup-chave.txt
```

A linha `# public key: age1…` vai em `BACKUP_AGE_DESTINATARIO`. O arquivo `pecsil-backup-chave.txt`
é a chave privada: guardar num pendrive e no cofre de senhas, **nunca no servidor nem na nuvem**.

**No banco da fábrica:** feito em 18/10. A migração `202610180007_backup_leitura.sql` foi aplicada,
e a senha foi definida como verificador SCRAM por `scripts/ti-backup-senha.mjs --aplicar`. A senha
está no `.env.local` (`BACKUP_DB_PASSWORD`), para copiar para a variável do Coolify. O usuário do
pooler é `backup_leitura.your-tenant-id`.

**No Coolify**, criar um app a partir deste repositório:
- Base Directory: `/services/backup`;
- Build: Dockerfile;
- sem domínio, porque o serviço não recebe acesso de fora.

| Variável | Valor |
|---|---|
| `BACKUP_PG_URL_PECSIL` | `postgres://backup_leitura.your-tenant-id:<BACKUP_DB_PASSWORD>@192.168.0.89:5432/postgres` |
| `BACKUP_PG_URL_FORJA` | opcional: banco da Forja (o app precisa estar na rede da Forja no Coolify) |
| `BACKUP_ARQUIVOS_URL`, `BACKUP_ARQUIVOS_CHAVE` | Supabase da fábrica por dentro e chave de serviço, para os arquivos |
| `BACKUP_EXCLUIR_BUCKETS` | buckets fora do backup (os desenhos) |
| `BACKUP_AGE_DESTINATARIO` | chave pública `age1…` |
| `VIGIA_URL`, `VIGIA_CHAVE` | os mesmos do vigia |
| `BACKUP_EMAIL`, `BACKUP_SENHA` | o usuário do backup na nuvem |
| `BACKUP_TOKEN` | o token do `backup-pecsil` |
| `BACKUP_HORA` | opcional, padrão `02:30` (Brasília) |

**Conferir:** no terminal do app no Coolify, rodar `node backup.mjs --agora`. Depois, no SQL Editor
da nuvem:

```sql
select name, created_at from storage.objects where bucket_id = 'backups' order by created_at desc;
select estado, ultimo_sinal, ultimo_info from vigia_alvos where id = 'backup-pecsil';
```

## Restaurar

Precisa da chave privada e de um Postgres 17 de destino. Para teste, use um banco descartável,
nunca o de produção.

**Numa pane de verdade**, num Supabase novo e da mesma versão, que já cria as estruturas dele:

1. **Dados do negócio:** `-- --no-owner --schema=public`.
2. **Usuários e logins:** `-- --no-owner --data-only --schema=auth`, com o serviço de autenticação
   da mesma versão já rodando. Se a versão for outra: apagar o esquema `auth`, criar `auth` vazio e
   restaurar com `-- --no-owner --schema=auth`.
3. **Arquivos:** os registros com `-- --no-owner --data-only --schema=storage`; os arquivos com
   `--pasta`, reenviados ao Storage na mesma estrutura de pastas.

Restaurar o backup inteiro de uma vez num Supabase existente dá avisos de "já existe" nos esquemas
do próprio Supabase (auth, storage, realtime). São esperados. Os dados que importam são os dos
passos acima.

```bash
# banco (as partes, se houver, vão na ordem)
node services/backup/restaurar.mjs --chave pecsil-backup-chave.txt \
  --destino postgres://<usuário>:<senha>@<host>:5432/postgres \
  2026-10-19/0230-pecsil.dump.age -- --no-owner
# arquivos
node services/backup/restaurar.mjs --chave pecsil-backup-chave.txt --pasta ./arquivos 2026-10-19/0230-arquivos.tar.gz.age
```

O arquivo vem da nuvem pelo painel do Supabase (*Storage › backups*), com o usuário do proprietário.
O usuário do backup não consegue baixar.

## Teste com o banco real (18/10/2026)

Feito depois de aplicar o papel `backup_leitura` em produção:
- **Backup:** `pg_dump` pelo pooler com o papel novo, sem nenhum erro. Ficou com **22,9 MB já
  criptografado** e levou 17 s.
- **Restauração:** num Postgres 17 do Supabase descartável, com uma chave de teste.
- **Conferência linha a linha** contra a produção: as **165 tabelas** (public, auth e storage)
  voltaram iguais, 132.639 linhas.
  - As 161 tabelas de `public` e `storage` (OS, títulos, colaboradores, cotações, arquivos…) voltaram
    de primeira.
  - As 4 do `auth` voltaram ao restaurar o esquema `auth` inteiro num esquema vazio: 15 usuários,
    748 sessões, 7.692 registros de acesso. A imagem crua tinha uma estrutura de `auth` mais antiga.
- **Chave errada:** não abre o backup.
- **Limpeza:** o backup real e as chaves de teste foram apagados depois do teste.

O teste revelou e corrigiu um defeito do `restaurar.mjs`: na restauração parcial (`--schema`), o
script ficava parado esperando o `age`.

## Testes (18/10/2026)

- `tests/ti-backup.test.mjs`: configuração, horário de Brasília, nomes, partes, verificador SCRAM e
  as regras dos SQL.
- **De ponta a ponta, 11 de 11, só com dados de mentira**, num Postgres 17 do Supabase descartável:
  - a migração aplica como `postgres`;
  - o papel lê tudo, passando o RLS, e não grava;
  - o serviço roda no contêiner de verdade;
  - tudo chega criptografado e sem CPF legível;
  - os desenhos ficam de fora;
  - o aviso chega ao vigia;
  - o serviço não sobrescreve um backup que já existe;
  - a restauração do banco e dos arquivos volta igual;
  - a chave errada não abre o backup.
- **SQL da nuvem, 3 de 3 e retenção conferida:**
  - o usuário do backup grava;
  - os outros usuários não gravam;
  - o usuário do backup não lê, não apaga e não sobrescreve;
  - a limpeza mantém os mais recentes e os domingos.
