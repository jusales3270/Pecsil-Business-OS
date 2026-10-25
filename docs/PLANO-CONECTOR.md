# Plano do conector universal

Prioridade máxima do proprietário (22/10/2026): "o mais importante de todos". Trazer para a plataforma os dados de
qualquer ERP, sistema antigo ou arquivo solto, começando pelo **GRV** da Pecsil. Ele também é o molde do produto
para outras indústrias (sem tenants nem white label por enquanto).

## 1. Decisões tomadas

| # | Decisão | Resposta |
|---|---|---|
| 1 | Como ler | **Em degraus**, sempre o mais confiável que a fonte permitir: 1) API do sistema; 2) banco do sistema, **só leitura** (traz o histórico inteiro); 3) arquivos e exportações (o coletor e o Segundo Cérebro); 4) computer use, só como último recurso e de preferência só para GERAR a exportação. |
| 2 | MCP | Só como porta de **entrada** de fontes que já têm MCP (Microsoft 365, Google). A plataforma não vira servidor MCP para outras IAs (E6 descartada em 22/10). |
| 3 | Onde o conector roda | **Na Pecsil, no próprio servidor da plataforma.** O `innovait-server` (192.168.0.89) fica na rede da empresa, a mesma do servidor do GRV: o conector roda como serviço no Coolify, como o transmissor de NF-e, e alcança o GRV pela rede local, sem nada instalado nos computadores. Em empresa cujo servidor da plataforma estiver fora da rede dela, o **mesmo serviço** roda num computador de lá, como agente que só faz chamadas de dentro para fora. |
| 4 | Dado bruto | Entra **uma vez só** na área de chegada, com a origem, a data e o sha256 de cada registro; registro igual não entra de novo, registro alterado vira nova versão. |
| 5 | De-para | A **regra** sugere primeiro (CNPJ, CPF, código); a IA, depois, só sugere; quem **aprova é a área** dona do cadastro (decisão é da área, não do proprietário). |

## 2. Regras que não mudam

- **Só leitura na fonte.** O conector usa um usuário do banco só com leitura, pedido à TI. Além disso, ele mesmo
  recusa qualquer comando que não seja consulta (um único `SELECT`/`WITH`, sem `;` no meio).
- **Credencial por fonte.** Cada fonte tem um segredo próprio, mostrado uma vez só na criação; o banco guarda só o
  hash. O conector manda o segredo a cada chamada; segredo errado, 404 (como se a rota não existisse).
- **A senha do banco de origem nunca vem para a plataforma.** Ela fica só nas variáveis do serviço conector.
- **A área de chegada não é o cadastro.** Nada do GRV muda fornecedor, cliente ou material sozinho: o que sai da
  área de chegada passa pelo de-para aprovado e pelas funções de sempre dos módulos.
- **Só o proprietário** vê e configura os conectores (Fundação › Conectores), como o WhatsApp.
- **Dado pessoal** (CPF, salário, saúde) que vier de um sistema antigo fica na área de chegada com o mesmo cuidado
  do RH: só o proprietário lê; nada vai a serviço externo de IA.

## 3. Partes

- **Área de chegada** (`conector_fontes`, `conector_lotes`, `conector_registros`): as fontes, cada remessa e cada
  registro bruto (objeto de origem, chave, conteúdo, sha256, versão, primeira e última vez visto).
- **Rota de entrada** (`/api/conector/v1/…`): o conector pergunta o que fazer (`tarefa`), manda a descoberta do
  esquema (tabelas, colunas e contagem) e manda os registros em lotes.
- **Serviço conector** (`services/conector`): Node, um processo por fonte. Drivers de banco (PostgreSQL, SQL Server,
  Firebird, MySQL), a **descoberta** do esquema, a extração em páginas, a **sondagem de portas** (descobrir qual banco
  responde num servidor) e a trava de só leitura.
- **De-para genérico** (`conector_depara`): registro de origem → fornecedor, cliente, material, produto ou
  colaborador da plataforma, sugerido por regra e aprovado pela área.
- **Tela Fundação › Conectores** (só o proprietário): fontes, situação, segredo (uma vez), descoberta, objetos a
  extrair (consulta e chave), últimas remessas e a fila do de-para.

## 4. Etapas

| # | Etapa | Entrega | Portão |
|---|---|---|---|
| C1 | Área de chegada e serviço | Tabelas, rota de entrada, serviço conector com drivers, descoberta, sondagem e trava de só leitura; tela Fundação › Conectores; testado com um banco de teste | — |
| C2 | De-para | Sugestão por regra (CNPJ/CPF/código), fila na tela e a decisão da área (função no banco) | C1 |
| C3 | GRV | Saber qual banco o GRV usa e o IP (Cesar); usuário só leitura; o conector no Coolify; sondagem, descoberta e o mapa das tabelas (clientes, orçamentos, OS, notas, estoque) | C1; resposta do Cesar |
| C4 | Uso | Cargas pelo de-para aprovado (destrava C-01, C-13, A-03, A-10); extração incremental agendada; a SARA e os eventos lendo a área de chegada | C2, C3 |
| C5 | Produto | Agente instalável (Windows) para empresa cujo servidor da plataforma está fora da rede dela | — |

## 5. Pendências

- **Cesar (TI):** qual banco o GRV usa (Firebird, SQL Server, PostgreSQL, MySQL…), o IP do servidor do GRV e um
  usuário só leitura. Sem isso, a C3 não começa. (Alternativa, só com o OK do proprietário e do Cesar: a sondagem
  de portas de banco na rede 192.168.0.x a partir do servidor da plataforma.)
- **Proprietário:** o Deploy do serviço conector no Coolify quando a C3 começar.

## 6. Registro

| Data | O que mudou | Quem |
|---|---|---|
| 25/10/2026 | Plano escrito. O conector roda no servidor da plataforma, que está na rede da Pecsil (mesma do GRV). C1 e C2 começam sem o GRV; a C3 espera o Cesar | Proprietário ("faça isso") |
| 22/10/2026 | Conector universal vira prioridade máxima; desenho em degraus; E6 (MCP para fora) descartada | Proprietário |
