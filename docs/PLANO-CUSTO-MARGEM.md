# Plano: custo real por OS e margem por cliente

> Documento de referência. Nenhuma etapa começa sem a anterior cumprir o critério
> de aceite, e nenhuma decisão da seção 3 muda sem registro na seção 8.
>
> Criado em 25/09/2026 · Dono: proprietário da PecSil · Execução: Claude
> Origem: estudo do case SP Alumínio (extrusora, ~R$ 90 mi/ano), em que o ganho veio
> de medir custo por produto e margem por cliente, e não de ferramenta.

## 1. Objetivo

Responder com número, e não com feeling:

- **Quanto custou de verdade cada OS** (cada molde, cada lote).
- **Quanto cada OS, cada cliente e cada artigo deixaram de margem.**
- **Onde está a perda:** paradas, setup, retrabalho, refugo, material.

A **OS é a unidade comum**: todo módulo que gera custo ou receita registra a qual OS
(ou a qual centro de custo, quando não for de uma OS) aquele fato pertence. Com isso,
a margem sai da camada analítica sem engenharia de dados posterior.

## 2. O que já existe (conferido em 25/09/2026)

**Forja** (`forja/backend/prisma/schema.prisma`):
- `oses`: cliente, artigo, quantidade, prazo, `preco_unitario`, `valor_total`,
  `po_cliente`, `numero_fiscal`, `status_fiscal`, `valor_recebido`, `data_nf` e
  `data_pagamento`. **O lado da receita da OS está completo.**
- OS → `lotes` → `op_lotes` → `processamentos_maquina` (máquina, operador,
  início, fim). **Dá para calcular horas de máquina por OS.**
- `paradas_maquina` com `motivos_parada` catalogados (código, planejada ou não).
- `inspecoes_op` e `medicoes_inspecao` (qualidade) e `apontamentos_peca`.
- `clientes`, `artigos`, `maquinas`, `etapas`.

**Business OS:**
- Trilha de eventos (`module_events`), cadastro mestre de fornecedores (69) e de
  clientes (vazio), regras de acesso no banco.
- `finance_titles` com `cost_center_id`, `chart_account_id`, `source_module` e
  `source_entity_id`. `compras` (266) e `cotacoes` (191) com `cost_center_id`.
- `finance_cost_centers` e `finance_chart_accounts` **vazios**. Financeiro com 1 título.

**O que falta, em uma linha:** a OS não existe no Business OS; nada nosso aponta
para ela; não há custo-hora, consumo de material, plano de contas nem centros de
custo; e o salário (necessário ao custo de mão de obra) não está em lugar nenhum.

## 3. Decisões de negócio (antes de qualquer código)

Estas decisões são da PecSil. O Claude prepara as opções e a simulação; o
proprietário decide e registra na seção 8.

| # | Decisão | Por que trava | Quem decide |
|---|---|---|---|
| D1 | **Plano de contas e centros de custo** da PecSil (estrutura e nomes) | Sem eles, nenhum custo tem onde ser classificado | Proprietário + contabilidade |
| D2 | **Modelo de custo-hora de máquina:** o que entra (depreciação, energia, manutenção, ferramental) e como se calcula por máquina ou por etapa | Horas do Forja sem custo não viram dinheiro | Proprietário + Produção |
| D3 | **Custo de mão de obra:** onde fica o salário (RH ou Financeiro, o "item 3" pendente), quem vê e como vira custo-hora por centro | Sem isso, o maior custo da OS fica fora | Proprietário |
| D4 | **Rateio do indireto:** administração, fundição, qualidade e manutenção, e por qual critério (hora-máquina, peso, receita) | Decide se a margem é bruta ou de contribuição | Proprietário + contabilidade |
| D5 | **Custo de material:** como medir o que cada OS consome (requisição de estoque, peso de fundição, lista do artigo) | Material é custo direto | Proprietário + Produção + Compras |
| D6 | **Regra de lançamento:** a partir de qual data nenhuma compra, requisição ou título entra sem OS ou centro de custo | É a disciplina que fez o case funcionar | Proprietário |
| D7 | **Tratamento do histórico:** recuperar OS e centro de custo das 266 compras e 191 cotações existentes, ou começar a medir da data da D6 | Esforço × valor do histórico | Proprietário |

## 4. Etapas

Formato: objetivo · entregas · aceite · depende de.

### Etapa 1: Cadastros financeiros (D1)
- **Objetivo:** plano de contas e centros de custo reais no banco.
- **Entregas:** importação ou cadastro do plano de contas e dos centros aprovados;
  tela de manutenção (Fundação › Cadastros); centros ligados a departamentos e máquinas.
- **Aceite:** nenhuma conta ou centro fictício; todo departamento com centro; a
  matriz de acesso cobre os cadastros.
- **Depende de:** D1.

### Etapa 2: A OS no Business OS
- **Objetivo:** a OS do Forja vira referência compartilhada, sem duplicar o Forja.
- **Entregas:**
  - tabela `production_orders` espelho (id do Forja, código GRV, cliente, artigo,
    quantidade, prazo, status, preço, valor, PO e NF), sincronizada pelo cliente
    que já existe (`lib/forja/client.ts`), com evento na trilha a cada mudança;
  - o Forja continua a fonte da verdade da produção; o espelho é só leitura e referência.
- **Aceite:** toda OS aberta no Forja aparece no espelho em até 15 min; nenhum campo
  editável do lado do Business OS; divergência entre Forja e espelho gera alerta.
- **Depende de:** nada novo no Forja. A rota `GET /os` já existe
  (`forja/backend/src/routes/os.ts`, autenticada) e devolve a OS completa, com
  cliente e artigo; a conta de integração que o Business OS já usa serve. Ela não
  filtra por data de atualização, então a primeira versão sincroniza a lista
  inteira. Se o volume crescer, pedir ao Forja um filtro `atualizadoDesde`.

### Etapa 3: Cliente único
- **Objetivo:** o cliente do Forja e o `customers` do Business OS são o mesmo registro.
- **Entregas:** vínculo `customers` ↔ cliente do Forja; importação inicial com
  conferência (unificação assistida, possível uso da etapa 1 do plano do Jev); a OS
  espelhada aponta para `customers`.
- **Aceite:** 100% das OS do espelho com cliente vinculado; nenhuma duplicata.
- **Depende de:** Etapa 2.

### Etapa 4: O fio da OS nos módulos que geram custo e receita (D6)
- **Objetivo:** cada lançamento diz de qual OS (ou centro) ele é.
- **Entregas:**
  - `order_id` (referência à OS) e `cost_center_id` obrigatórios, um ou outro, em
    `cotacoes`, `compras` e `finance_titles`, e depois em requisições de Estoque;
  - telas de Compras e Financeiro pedindo OS ou centro, com busca por código GRV;
  - título a receber gerado a partir da NF da OS, com `source_entity_id` = OS;
  - regra no banco: sem OS e sem centro, não grava (a partir da data da D6).
- **Aceite:** a partir da data da D6, 100% dos novos lançamentos com OS ou centro
  (consulta no banco); os usuários treinados.
- **Depende de:** Etapas 1 e 2, D6.

### Etapa 5: Custo-hora (D2, D3)
- **Objetivo:** cada hora de máquina e de pessoa tem valor.
- **Entregas:**
  - tabela de custo-hora por máquina (ou etapa), com vigência mensal, calculada pelo
    modelo da D2, e memória de cálculo visível;
  - custo-hora de mão de obra por centro, a partir do salário conforme a D3, com
    acesso restrito (o salário individual nunca aparece na análise; só o custo-hora do centro).
- **Aceite:** custo-hora de todas as máquinas ativas do Forja; memória de cálculo
  conferida pelo proprietário; a matriz de acesso prova que o salário individual não
  vaza para quem vê a análise.
- **Depende de:** D2, D3, Etapa 1.

### Etapa 6: Consumo de material por OS (D5)
- **Objetivo:** o material de cada OS entra no custo.
- **Entregas:** o módulo de Estoque (Fase 4 do blueprint) com entrada por compra,
  saída por requisição **com OS**, e custo médio; ou, se a D5 decidir, um cálculo
  pela lista de materiais do artigo mais o peso de fundição.
- **Aceite:** para um mês fechado, o material de pelo menos 90% das OS concluídas
  está apropriado, conferido por amostragem.
- **Depende de:** D5, Etapa 4.

### Etapa 7: Custo e margem (camada analítica, Fase 5)
- **Objetivo:** a pergunta do case, respondida.
- **Entregas:**
  - cálculo do custo por OS: horas de máquina × custo-hora + horas de pessoa × custo-hora
    + material + compras diretas + rateio do indireto (D4);
  - margem por OS, cliente, artigo e mês; perda por parada, setup e refugo;
  - **dicionário de KPIs**: cada número com uma definição e uma fórmula só;
  - telas: custo de uma OS com a composição aberta; ranking de clientes e artigos por
    margem (curva ABC por margem, não por volume); OS com margem abaixo do mínimo.
- **Aceite:** para 3 OS escolhidas pelo proprietário, o custo calculado bate com a
  conta feita à mão (diferença abaixo de 5%); cada número é rastreável até o
  lançamento de origem.
- **Depende de:** Etapas 3 a 6, D4.

### Etapa 8: Decisão comercial com margem
- **Objetivo:** vender melhor, não mais.
- **Entregas:** no CRM, a margem histórica do cliente e do artigo aparece na cotação e
  no card; preço mínimo sugerido por OS (custo + margem-alvo); segmento e campanha no
  cliente, para medir a margem de cada nicho testado; lista de clientes antigos
  rentáveis para reativação.
- **Aceite:** toda proposta nova mostra a margem prevista antes do envio.
- **Depende de:** Etapa 7 e o CRM com histórico (etapas do Comercial).

### Etapa 9: SARA sobre custo e margem
- **Objetivo:** a SARA nos níveis 1 a 3 sobre esses números.
- **Entregas:**
  - nível 1: "quanto custou a OS X", "qual a margem do cliente Y no trimestre";
  - nível 2: "por que a margem do artigo Z caiu" (paradas, setup, material);
  - nível 3: "vale aceitar um pedido de N peças a este preço?", "o que ganho se reduzir
    o setup da máquina M em 20%".
- **Aceite:** respostas rastreáveis até o dado; permissão herdada de quem pergunta
  (quem não vê o custo não recebe o custo).
- **Depende de:** Etapa 7 e a Fase 6 do blueprint.

## 5. Ordem e portões

| Ordem | Etapa | Travada por |
|---|---|---|
| 0 | Decisões D1 a D7 | proprietário |
| 1 | Cadastros financeiros | D1 |
| 2 | OS no Business OS | nada: `GET /os` do Forja já existe |
| 3 | Cliente único | Etapa 2 |
| 4 | Fio da OS nos módulos | Etapas 1 e 2, D6 |
| 5 | Custo-hora | D2, D3 |
| 6 | Material por OS | D5, Estoque |
| 7 | Custo e margem | Etapas 3 a 6, D4 |
| 8 | Decisão comercial | Etapa 7, CRM |
| 9 | SARA | Etapa 7, Fase 6 |

As etapas 1, 2 e 3 podem andar em paralelo com as decisões D2 a D5. **Portão:** cada
etapa só termina com o critério de aceite verificado no banco real e em produção.

## 6. Regras

1. **O Forja é a fonte da verdade da produção.** O Business OS espelha e referencia; não edita OS.
2. **Um KPI, uma definição.** Fórmula no dicionário antes de aparecer em tela.
3. **Rastreável até a origem.** Todo custo aponta para o lançamento, a hora ou a requisição que o gerou.
4. **Salário individual nunca aparece na análise;** só o custo-hora do centro, com acesso restrito.
5. **Nada de número inventado.** Sem dado, a tela diz "sem dado" e aponta o que falta lançar.
6. **O Jev só entra onde o plano do Jev permite** (unificação de clientes, classificação de gasto).

## 7. Como executar cada etapa

Mesmo roteiro do [PLANO-JEV.md](PLANO-JEV.md) (seção 6): plano detalhado aprovado →
implementação com testes → simulação sobre os dados reais com relatório → conferência
do proprietário → ligado em produção → uma semana de uso antes do portão.

## 8. Registro de decisões

| Data | Item | Decisão | Quem |
|---|---|---|---|
| 25/09/2026 | Plano | Criado a partir do estudo do case SP Alumínio | Proprietário |
