# Serviço conector

Parte do conector universal do Pecsil Business OS ([docs/PLANO-CONECTOR.md](../../docs/PLANO-CONECTOR.md)).
Roda perto da fonte, lê **só com usuário de leitura** e manda para a área de chegada da plataforma a
descoberta do esquema (tabelas, colunas, linhas) e os registros dos objetos configurados em
Fundação › Conectores.

Na Pecsil ele roda no próprio servidor da plataforma (`innovait-server`, 192.168.0.89), que está na rede do GRV,
como um app do Coolify sem domínio, igual ao transmissor de NF-e.

## Antes de ligar

1. **Qual banco e onde.** Com a TI (Cesar): o tipo do banco do GRV e o IP do servidor. Para ver o que responde:

   ```bash
   node conector.mjs sondar 192.168.0.X
   ```

   Ele testa as portas padrão (3050 Firebird, 1433 SQL Server, 5432 PostgreSQL, 3306 MySQL, 1521 Oracle…).
2. **Usuário só de leitura**, criado pela TI no banco do GRV. No Firebird, por exemplo:
   `CREATE USER LEITOR PASSWORD '…'` e `GRANT SELECT ON <tabela> TO LEITOR` para cada tabela.
3. **A fonte na plataforma:** Fundação › Conectores › Adicionar fonte. O segredo aparece **uma vez só**.

## Variáveis

| Variável | O quê |
|---|---|
| `PLATAFORMA_URL` | Endereço da plataforma (na rede do Coolify: `http://pecsil-business-os:3000`) |
| `CONECTOR_FONTE`, `CONECTOR_SEGREDO` | Os dois mostrados na criação da fonte |
| `ORIGEM_TIPO` | `firebird`, `sqlserver`, `postgres` ou `mysql` |
| `ORIGEM_HOST`, `ORIGEM_PORTA` | O servidor do banco (a porta é opcional: usa a padrão do tipo) |
| `ORIGEM_BANCO` | O nome do banco; no Firebird, o caminho do arquivo no servidor (ex.: `C:\GRV\DADOS.FDB`) |
| `ORIGEM_USUARIO`, `ORIGEM_SENHA` | O usuário só de leitura |
| `ORIGEM_CHARSET` | Só Firebird; padrão `WIN1252` |
| `TAMANHO_LOTE` | Registros por remessa (50 a 1.000; padrão 500) |
| `PORTA_SAUDE` | Porta do `/saude` (padrão 3200) |

A senha do banco fica **só aqui**; ela nunca vai para a plataforma e é apagada das mensagens de erro.

## Como roda

```bash
node conector.mjs            # laço: tarefa → descoberta (se pedida) → objetos em lotes → espera o intervalo
node conector.mjs uma-vez    # uma rodada e sai (para testar)
```

- **Só leitura em duas camadas:** o usuário do banco e a própria trava do conector (uma consulta só, começando por
  SELECT ou WITH, sem `;` no meio e sem comando que grava). No PostgreSQL e no MySQL a sessão abre como só leitura;
  no Firebird cada consulta roda numa transação só de leitura; no SQL Server ele pede `ApplicationIntent=ReadOnly`.
- **Paginação** no dialeto de cada banco (a consulta vira tabela derivada). No SQL Server, a consulta do objeto vem
  sem `ORDER BY`.
- **Valores:** data em ISO; texto sem os espaços de enchimento do CHAR; número grande como texto; binário e BLOB
  só marcados (`[binário N bytes]`, `[blob]`), sem ir para a plataforma nesta etapa.
- **Erro de rede:** tenta de novo 3 vezes; o erro vai para a plataforma (sem senha nem segredo) e aparece na tela.

## Testes

```bash
npm test
```

## Dependências

Versões fixas (`pg`, `mysql2`, `mssql`, `node-firebird`), escolhidas entre as publicadas há pelo menos duas
semanas. O `npm audit` aponta um alerta na `@azure/msal-node`, que vem do `mssql`. Ele só afeta o login
interativo da Azure (Azure AD), que o conector não usa: ele entra com usuário e senha do banco.
