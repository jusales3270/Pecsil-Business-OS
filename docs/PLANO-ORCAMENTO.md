# Plano: Orçamento → OS → faturamento → NF-e (desligar o GRV)

> **A ordem de construção está em [`ROADMAP.md`](ROADMAP.md)** (fonte única desde 16/10/2026). Este documento guarda o desenho, as decisões e os critérios de aceite.

> Documento de referência. Nenhuma etapa começa sem a anterior cumprir o critério de
> aceite, e nenhuma decisão da seção 4 muda sem registro na seção 9.
>
> Criado em 13/10/2026 · Dono: proprietário da Pecsil · Execução: Claude
> Origem: o PDF do Jefferson ("passo-a-passo-emissão-nfe"), o áudio do Rafael
> ("Orçamento comercial") e as respostas do Jefferson no WhatsApp (13/10).

## 1. Objetivo

Tirar do GRV a cadeia que vai do pedido do cliente até a nota, para poder desligá-lo:

- o **orçamento** que o Rafael monta passa a nascer na plataforma (no Comercial);
- o orçamento aprovado **abre a OS** na Forja, sem digitar duas vezes;
- a **nota nasce do orçamento**, faturada em quantas vezes for preciso, mas **nunca acima
  do orçado**;
- o **orçamento mostra as notas** que entregaram cada item.

## 2. Como é hoje (GRV + Forja)

| # | Etapa | Quem | Onde |
|---|---|---|---|
| 1 | Pedido do cliente com desenho (e-mail, WhatsApp ou portal do cliente) | Rafael | e-mail |
| 2 | Estrutura (lista de materiais, serviço de terceiros, processo produtivo), clonada do histórico ou criada do zero; uma de usinagem e outra de fundição | Rafael | GRV, M13 |
| 3 | Material (família, grupo, unidade, NCM, dados de exportação) vinculado à estrutura, o que gera o **código interno** | Rafael | GRV, P15 |
| 4 | Preço: Rafael com o Domingos (às vezes o Ricardo), pelo histórico e pela tabela por tipo de peça | Rafael e Domingos | planilhas |
| 5 | Cotação ao cliente em Excel ou PDF (a Parglass exige modelo próprio) | Rafael | Excel |
| 6 | **Orçamento** com itens pelo código interno, anexos (pedido do cliente e cotação) e anotações; aprovado, fica "Ganhou" | Rafael | GRV, P88 |
| 7 | OS gerada pelo orçamento; a mesma OS é lançada de novo na Forja (código GRV) | Rafael | GRV e Forja |
| 8 | Entrada de produção, que libera a peça para faturar | Rafael | GRV, OS |
| 9 | Assistente de faturamento: orçamento, pedido do cliente e quantidade a faturar | Jefferson | GRV, V41 |
| 10 | NF-e preenchida pelo orçamento (CFOP, NCM, pedido nas informações adicionais, plano de contas, baixa de estoque) | Jefferson | GRV, V31 |

## 3. O que já existe na plataforma (conferido em 13/10/2026)

**Para aproveitar:**
- **Comercial:** funil (Kanban, com a etapa "Proposta enviada" e ganho/perdido com motivo), clientes e e-mail. Falta a etapa da conexão Microsoft 365.
- **Clientes:** cadastro com os dados fiscais (migração 202610130004). Escolher o cliente preenche o destinatário da nota.
- **Forja:** espelho das OS a cada 10 min (`production_orders` e `production_order_financials`), só de leitura. A Forja tem artigos, desenhos, roteiro de operações, lotes e apontamentos, e `POST /os` e `POST /artigos` existem. A conta de integração hoje só lê.
- **Documentos:** anexos ligados a qualquer registro (`company_documents` e `<DocumentosLigados>`).
- **Fiscal:** emissão de NF-e no treino (`fiscal_nfe`, validação pelo esquema oficial, DANFE, cancelamento, carta de correção, inutilização).
- **Financeiro:** o par "previsão → título real" do Compras (`trg_compra_previsao` e `almoxarifado_confirmar_recebimento`) e a aba de previsões do contas a receber.

**O que não existe:**
- orçamento de venda, itens de venda e PDF de proposta;
- cadastro de produtos (código interno, NCM, unidade, desenho);
- lista de materiais;
- entrada de produção;
- estoque e saldo a faturar;
- conta a receber gerada pela nota;
- CNPJ em qualquer um dos 38 clientes.

## 4. Decisões do proprietário (antes do código)

| # | Decisão | Recomendação |
|---|---|---|
| O1 | **OS na Forja:** a plataforma cria a OS e o artigo na Forja quando o orçamento é aprovado (pede uma mudança na Forja: a conta de integração passa a poder criar), ou o Rafael segue lançando na Forja e a plataforma só liga | Criar automático. Acaba com a digitação dupla, e a Forja continua dona da produção |
| O2 | **Numeração:** o orçamento e a OS continuam a numeração do GRV (próximo número informado na virada) | Continuar |
| O3 | **Entrada de produção:** manual pelo Rafael, como hoje, ou automática pelos lotes concluídos na Forja | **Decidido:** manual (seção 9) |
| O4 | **Previsão a receber** quando o orçamento é ganho, e a receber real quando a nota é autorizada | Sim, como no Compras |
| O5 | **Lista de materiais e calculadora de caixa** precisam estar prontas antes de desligar o GRV? | Sim, mas numa etapa própria (E7), depois de o fluxo principal rodar |
| O6 | **Nota de exportação** (clientes do Chile e da Argentina) | Entra antes da virada; sem ela o GRV não desliga |

**Já decidido em 13/10:**
- o orçamento fica no **Comercial**; a OS e a entrada de produção na **Produção**; o faturamento e a NF-e no **Fiscal**;
- faturamento **fracionado**, com a soma das notas por item **nunca acima do pedido**;
- **cancelar a nota** devolve a quantidade para faturar;
- **o orçamento lista as notas** de cada item;
- a entrada de produção é do **Rafael**.

## 5. O que precisamos do GRV (exportações)

O Jefferson ou o Rafael exportam do GRV, em Excel, CSV ou PDF:

1. **Clientes:** razão social, CNPJ, IE, endereço, código IBGE, e-mail para nota e filiais. Isso resolve de vez o cadastro sem CNPJ.
2. **Materiais/produtos:** código interno, descrição, família, grupo, unidade, NCM, cliente, nº do desenho e revisão.
3. **Orçamentos em aberto com saldo a faturar:** orçamento, item, quantidade pedida, faturada e produzida, preço e pedido do cliente.
4. **Últimos números:** orçamento, OS e nota (série 1).
5. **Regras fiscais por operação:** CFOP, CST e alíquotas. É o material que o Jefferson já ia mandar.
6. **Os 28 modelos de cotação** do Rafael, incluindo o da Parglass.

## 6. Etapas

Formato: objetivo · entregas · aceite · depende de.

### E1: Produtos e clientes completos
- **Objetivo:** o código interno existe na plataforma, com tudo de que a nota precisa.
- **Entregas:**
  - **cadastro de produtos** no Comercial (consulta também na Produção e no Fiscal):
    código interno, descrição, cliente, família (forma, bloco, fundo, molde…), material
    (96A, E3…), unidade, NCM, origem, nº do desenho e revisão, idioma ou nomenclatura do
    cliente, dados de exportação e o vínculo com o artigo da Forja;
  - **"Clonar produto"**, o atalho que o Rafael mais usa;
  - importação dos produtos e dos clientes do GRV, com unificação dos duplicados (as duas
    Owens-Illinois e os apelidos da Forja).
- **Aceite:** 100% dos clientes ativos com CNPJ (ou identificação estrangeira); produtos
  importados conferidos por amostragem com o Rafael; nenhum duplicado.
- **Depende de:** exportações 1 e 2.

### E2: Orçamentos no Comercial
- **Objetivo:** o orçamento do GRV (P88) na plataforma.
- **Entregas:**
  - **cabeçalho:** número (continuando o GRV), cliente e filial, contato, data, validade,
    condição de pagamento, frete, pedido de compra do cliente e card do funil (o card anda
    junto: proposta, ganho, perdido);
  - **itens:** produto (código interno), nº do desenho, quantidade, preço unitário, prazo
    e nº do item no pedido do cliente (ex.: "Item 060");
  - **anexos obrigatórios para aprovar:** o pedido do cliente e a cotação enviada. É a
    regra do Jefferson;
  - **anotações** das mudanças (ex.: desconto de 890 para 830), com autor e data;
  - **"Clonar orçamento"** (amostra de 4 peças → pedido de 54);
  - **histórico de preço** do produto e do cliente no item (o que já foi cobrado), como
    apoio ao Rafael e ao Domingos;
  - estágios: rascunho → enviado → **ganho** (exige pedido do cliente) ou perdido (com motivo).
- **Aceite:** o Rafael monta na plataforma, sozinho, um orçamento real do dia, com o mesmo
  resultado do GRV.
- **Depende de:** E1.

### E3: OS e entrada de produção
- **Objetivo:** o orçamento ganho vira produção sem digitação dupla.
- **Entregas:**
  - ganho o orçamento, **cada item abre a sua OS na Forja** (com o artigo criado se não
    existir), com quantidade, prazo, pedido do cliente e preço, se O1 aprovar. O espelho
    traz de volta o andamento;
  - **entrada de produção** pelo Rafael, por item, com a sugestão dos lotes concluídos na
    Forja. É o que fica "disponível para faturar";
  - aviso ao Jefferson quando houver peça disponível.
- **Aceite:** um orçamento real ganho aparece na Forja sem ninguém digitar; a entrada de
  produção libera exatamente a quantidade informada.
- **Depende de:** E2, O1 e a mudança na Forja.

### E4: Faturamento no Fiscal (a nota nasce do orçamento)
- **Objetivo:** o assistente de faturamento (V41) e a nota (V31) na plataforma.
- **Entregas:**
  - **tela "A faturar"**: por cliente e orçamento, item a item, com:

    | Pedido | Produzido | Faturado | Disponível | Falta faturar |
    |---|---|---|---|---|
  - o Jefferson escolhe as quantidades e **a nota nasce preenchida**: destinatário pelo
    cliente, itens pelo produto (NCM, unidade, descrição), preço do orçamento, CFOP pela
    regra fiscal, pedido e item do cliente nas informações adicionais;
  - **o teto fica no banco**: uma função reserva a quantidade e recusa o que passar do
    disponível ou do que falta faturar, mesmo com duas notas ao mesmo tempo. Nota cancelada
    devolve;
  - **no orçamento**, cada item mostra as notas que o entregaram (número, data e quantidade);
  - **no treino**, a nota pode nascer de um orçamento real, mas **não consome saldo**: o
    Jefferson treina com pedidos de verdade sem mexer no que falta faturar.
- **Aceite:** num pedido de teste, três notas parciais fecham o total; a quarta é recusada;
  cancelar uma devolve a quantidade; o orçamento lista as três.
- **Depende de:** E3 e as regras fiscais do Jefferson (exportação 5).

### E5: Contas a receber
- **Objetivo:** a venda aparece no Financeiro sem lançamento à mão.
- **Entregas:** orçamento ganho gera uma **previsão a receber**; a nota autorizada
  (homologação ou produção, **nunca o treino**) gera o **título real** pelas duplicatas e
  abate a previsão. É o mesmo par do Compras.
- **Aceite:** para um pedido faturado em duas notas, o Financeiro mostra dois títulos reais
  e a previsão zerada.
- **Depende de:** E4 e O4.

### E6: Cotação para o cliente
- **Objetivo:** acabar com as planilhas de cotação.
- **Entregas:** a cotação gerada pelo orçamento em PDF (e Excel quando o cliente pedir),
  por modelo de cliente; o modelo da Parglass leva material, NCM, caixas, peças e peso
  aproximado. Envio pelo e-mail do Comercial, e a cotação enviada vira anexo do orçamento
  sozinha.
- **Aceite:** as cotações dos clientes principais saem iguais às do Excel de hoje.
- **Depende de:** E2 e os 28 modelos (exportação 6).

### E7: Lista de materiais e caixa
- **Objetivo:** a estrutura do GRV (lista de materiais e serviço de terceiros) na plataforma.
- **Entregas:**
  - **lista de materiais** por produto: parafusos, chavetas, pó de metalização e caixa,
    com quantidades. Clonada com o produto;
  - **calculadora de caixa**: as fórmulas da planilha do Rafael (diâmetro, corte,
    comprimento e peças por caixa) escolhem a caixa e a quantidade;
  - a OS leva a lista. Falta de material vira **solicitação de compra** no Almoxarifado.
- **Aceite:** a lista e a caixa de 5 produtos reais batem com as do GRV e da planilha.
- **Depende de:** E1. Pode andar em paralelo com E4 a E6.

### E8: Virada (desligar o GRV)
- **Objetivo:** a plataforma vira a única fonte.
- **Entregas:**
  - importação dos orçamentos em aberto com saldo a faturar (exportação 3);
  - numeração continuando a do GRV;
  - período combinado de uso em paralelo, com conferência diária entre GRV e plataforma.
- **Pré-requisitos fora deste plano:**
  - NF-e em **produção**: certificado A1, homologação conferida e OK do proprietário;
  - **nota de exportação** (O6).
- **Aceite:** uma semana inteira de pedidos, OS e notas só pela plataforma, sem voltar ao GRV.
- **Depende de:** E1 a E5 (E6 e E7 conforme O5) e os pré-requisitos acima.

## 7. Ordem e portões

> Desde 16/10/2026 a ordem entre os itens é decidida em [`ROADMAP.md`](ROADMAP.md). O que segue fica só como dependências internas e portões deste plano.


| Ordem | Etapa | Travada por |
|---|---|---|
| 0 | Decisões O1 a O6 e exportações do GRV | proprietário, Rafael e Jefferson |
| 1 | E1 Produtos e clientes | exportações 1 e 2 |
| 2 | E2 Orçamentos | E1 |
| 3 | E3 OS e entrada de produção | E2, O1 e Forja |
| 4 | E4 Faturamento | E3 e regras fiscais |
| 5 | E5 Contas a receber | E4 e O4 |
| 6 | E6 Cotação | E2 e modelos (em paralelo) |
| 7 | E7 Lista de materiais e caixa | E1 (em paralelo) |
| 8 | E8 Virada | E1 a E5, NF-e em produção e exportação |

**Portão:** cada etapa só termina com o aceite verificado no banco real e em produção, e
com quem vai usar (Rafael, Jefferson) testando com dado real.

## 8. Regras

1. **A Forja é a fonte da verdade da produção** ([PLANO-CUSTO-MARGEM.md](PLANO-CUSTO-MARGEM.md)).
   A plataforma cria a OS por ela, se O1 aprovar, e nunca edita o chão de fábrica.
2. **Nunca faturar acima do pedido.** O teto fica no banco, e não só na tela.
3. **O treino nunca mexe em saldo, título ou estoque real.**
4. **Multiempresa:** numeração, modelos de cotação, regras fiscais e famílias de produto
   são configuração por empresa, nunca fixos da Pecsil no código.
5. **Cada número rastreável:** a nota aponta para o item do orçamento, o item para a OS,
   e o título para a nota.
6. **Custo e margem** ([PLANO-CUSTO-MARGEM.md](PLANO-CUSTO-MARGEM.md), etapa 8) entram no
   orçamento quando o custo existir: margem prevista antes de enviar a cotação.

## 8a. Andamento

**13/10/2026: construído o que não depende de exportação nem da Forja.** Em código, ainda
sem migração aplicada nem deploy:
- **E1, produtos:** `products` e `product_groups`, código interno no formato do GRV pelo grupo e
  "Clonar". Tela em Comercial › Vendas › Produtos.
- **E2, orçamentos:** `sales_quotes`, com itens, anotações e anexos (o pedido e a cotação são
  exigidos para ganhar); numeração continuando o GRV; clonar; histórico de preço. Ganho gera
  previsão a receber e move o card do funil. Tela em Comercial › Vendas › Orçamentos.
- **E3, só a entrada de produção:** `production_entries`, pelas funções, nunca acima do pedido.
  Tela em Produção › Entrada de produção. A OS na Forja espera a confirmação do Rafael (duas OS
  por item?) e o OK para mexer na Forja.
- **E4, no treino:** `fiscal_nfe_origens` com o teto no banco (pedido e produzido, linhas
  travadas, cancelada devolve, cada ambiente com o seu saldo). Tela em Fiscal › A faturar; a nota
  nasce do orçamento com xPed/nItemPed. O orçamento lista as notas de cada item.
- **Migrações:** `202610130005_comercial_orcamentos.sql` e `202610130006_faturamento_orcamento.sql`.

## 9. Registro de decisões

| Data | Item | Decisão | Quem |
|---|---|---|---|
| 13/10/2026 | Módulo | Orçamento no Comercial; OS e entrada de produção na Produção; faturamento e NF-e no Fiscal | Proprietário |
| 13/10/2026 | Faturamento | Fracionado, com a soma das notas por item nunca acima do pedido | Proprietário e Jefferson |
| 13/10/2026 | Cancelamento | Nota cancelada devolve a quantidade para faturar | Jefferson |
| 13/10/2026 | Rastreio | O orçamento lista as notas de cada item | Jefferson |
| 13/10/2026 | Entrada de produção | Feita pelo Rafael | Proprietário |
| 13/10/2026 | O1 | A plataforma cria a OS na Forja com o que o Rafael montou no orçamento (cliente, pedido, produto, desenho, material, quantidade, prazo, preço, anotações e a lista de materiais). O roteiro (processo produtivo) continua na Forja: o artigo clonado herda o roteiro da origem; o novo nasce do roteiro-padrão do tipo. A confirmar com o Rafael: duas OS por item (fundição e usinagem)? | Proprietário |
| 13/10/2026 | O2 | Numeração continuando a do GRV | Proprietário |
| 13/10/2026 | O3 | Entrada de produção continua manual (Rafael) | Proprietário |
| 13/10/2026 | O4 | Previsão a receber no orçamento ganho; título real na nota autorizada | Proprietário |
| 13/10/2026 | O5 | A lista de materiais e a calculadora de caixa entram antes da virada | Proprietário |
| 13/10/2026 | O6 | A nota de exportação entra antes da virada | Proprietário |
| 15/10/2026 | O1 (ajuste) | O orçamento ganho cria, por item, uma OS em **rascunho** na Forja (sem lotes nem OPs, fora do Tótem e do Painel). O Rafael completa na Forja o roteiro, os desenhos e a lista de materiais e libera para produção. Motivo: a Forja exige artigo com roteiro para abrir OS, e os 3.872 artigos importados não têm roteiro | Proprietário |
| 15/10/2026 | E7 (ajuste) | A lista de materiais fica na Forja, por artigo e por peça, escolhida no catálogo do Almoxarifado (docs/PLANO-ALMOXARIFADO.md). A OS copia a lista na liberação, já com o total | Proprietário |
