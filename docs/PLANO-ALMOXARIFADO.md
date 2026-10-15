# Plano: catálogo de materiais e estoque no Almoxarifado

> Documento de referência. Nenhuma etapa começa sem a anterior cumprir o critério de
> aceite, e nenhuma decisão da seção 5 muda sem registro na seção 10.
>
> Criado em 15/10/2026 · Dono: proprietário da PecSil · Execução: Claude
> Origem: as quatro exportações do cadastro de itens do GRV (Matéria-prima, Embalagem,
> Produto intermediário e Material de uso e consumo), baixadas em 15/10.

## 1. Objetivo

Hoje o Almoxarifado recebe notas e encaminha solicitações, mas não sabe **o que** entrou
nem **quanto** existe. Este plano dá três coisas a ele:

- um **catálogo de materiais** com o código do GRV. Solicitação, cotação, compra e
  recebimento passam a apontar para o mesmo item, sem redigitar;
- um **estoque** com saldo e custo médio, só para os materiais que valem o controle.
  Entra pelo recebimento e sai por requisição com OS ou centro;
- a base que já foi combinada em outros dois planos:
  - a **lista de materiais** do produto ([PLANO-ORCAMENTO.md](PLANO-ORCAMENTO.md), E7);
  - o **consumo de material por OS** ([PLANO-CUSTO-MARGEM.md](PLANO-CUSTO-MARGEM.md),
    etapa 6 e decisão D5).

## 2. Como é hoje (conferido em 15/10/2026)

**Na plataforma, todo item é texto livre.** Nada tem código, NCM ou ligação com um cadastro.

| Onde | Tabela | Como o item entra |
|---|---|---|
| Solicitação do Almoxarifado ou da Fundição | `material_request_items.produto` | digitado ("Ex.: Broca HSS 10 mm") |
| Cotação (Kaylane) | `cotacao_produtos.produto` | digitado, com sugestão pelo histórico do navegador (`lib/compras/sugestoes-core.ts`) |
| Compra registrada | `compras.produto` | copiado da cotação ou da nota |
| Recebimento (Henrique) | `receipt_items.descricao` | lido da NF-e. O **código do fornecedor (cProd) e o CFOP são lidos e descartados** |
| EPI do RH | `rh_ppe_items` | cadastro próprio, sem ligação com compras |
| Painel do ICMS | `fiscal_icms_entries` | uma linha por nota, sem itens |

**O que não existe:**
- catálogo de materiais;
- saldo e custo médio;
- requisição de saída e baixa;
- inventário;
- estoque mínimo.

O custo das compras sai por nota no Financeiro, e o centro de custo da cotação
(`cost_center_id`) quase sempre fica vazio.

**No GRV**, cada material tem família, grupo, código interno, unidade, NCM, plano de contas,
custo e saldo. Os 5-xx são os produtos vendidos, que já estão na plataforma vindos da Forja.

## 3. O que as exportações trazem

São 9.340 itens com códigos únicos, sem repetição entre os quatro arquivos. O formato do código
é `família-grupo-sequência`, como em `2-07-00589`.

| Arquivo | Itens | Grupos principais | Com saldo > 0 |
|---|---|---|---|
| Matéria-prima (2-xx) | 2.427 | fixadores 852, bronze (blanks) 612, aços 521, ferro fundido 184, Dameron 88, inox 81, ligas 35, pó para metalização 25 | 1.285 |
| Embalagem (3-xx) | 1.900 | caixas de madeira por artigo 1.848, fitas, filme, papelão, selo | 1.121 |
| Produto intermediário (7-xx) | 1.032 | brocas, fresas, pastilhas, machos, abrasivos, resinas e tintas, lubrificantes, gases, filtros | 374 |
| Uso e consumo (8-xx e 9-xx) | 3.981 | pintura e obra 1.015, elétrico 974, produção 800, EPI 230, escritório, limpeza, copa, uniformes | 1.921 |

**Batem com o que a PecSil compra:**
- 77% das 360 compras e 76% dos 497 itens cotados na plataforma têm o item correspondente
  no GRV;
- mais de 200 já trazem o código do GRV no próprio texto;
- o que não casa é, em geral, peça de manutenção com o código do fornecedor
  (`S76278 ANEL ORING…`), barra descrita de forma abreviada ("Barra Nodular Ø95") ou serviço.

**O saldo do GRV não é confiável:**
- a soma dá cerca de R$ 21 milhões em estoque;
- há casos sem sentido, como 610 pacotes de café, 5.703 máscaras PFF2, 8.489 kg de pó de
  níquel (R$ 2,1 mi) e 232 t de ferro gusa;
- isso indica entrada sem baixa. O saldo inicial deve sair de contagem (M4).

**O cadastro tem problemas a corrigir na importação:**

| Problema | Itens | Tratamento |
|---|---|---|
| Unidade com várias grafias (PÇ, PC, UN para a mesma coisa; MT e M) | milhares | Tabela de unidades padronizada, mapeada na importação |
| Marcado como Ativo imobilizado | 442 em uso e consumo e 8 em outros | Fica fora do estoque (decisão A7) |
| Marcado como Produto acabado | 98 na matéria-prima | Conferir com o Rafael |
| Plano de contas trocado (ex.: caixas em "Despesas de viagem") | 55 caixas e outros | Listar para o Jefferson e o contador |
| Sem NCM | 844 | Importa e marca "falta NCM" |
| Custo zero | 749 | Importa sem custo; o custo médio nasce na primeira entrada |
| Compra pontual de obra ("Ampliação obra") | cerca de 1.276 | Só catálogo, sem saldo (decisão A2) |

## 4. O que já existe para aproveitar

- **Recebimento completo** (`almoxarifado_confirmar_recebimento`):
  - lê o XML;
  - confere a nota contra a OC;
  - cria a conta a pagar e a linha do ICMS;
  - trata a compra direta.

  Falta só gravar o material e a quantidade de cada item.
- **Solicitações** com status ligados à cotação e à compra.
- **Sugestão do Compras** (`SugestaoInput`): troca a fonte do histórico do navegador pelo
  catálogo.
- **Padrão de código por grupo** dos produtos (`product_groups` e
  `product_proximo_codigo`): o mesmo serve para material novo continuar a numeração do GRV.
- **Busca com lista** do orçamento (`lib/comercial/busca-produto.ts`): reaproveitada para
  achar o material pelo código ou pelo nome.
- **Treino** (como no orçamento) para o Henrique e a Kaylane praticarem sem mexer no saldo real.

## 5. Decisões do proprietário (antes do código)

| # | Decisão | Recomendação |
|---|---|---|
| A1 | **O que importar:** os 9.340 itens ou só os que têm saldo ou foram comprados | Importar todos. Quem não tem saldo, custo nem compra na plataforma entra **inativo**: não aparece na busca do dia a dia, mas pode ser reativado |
| A2 | **Quais grupos controlam saldo** | Controlam: matéria-prima inteira, produto intermediário, embalagem, EPI e o grupo Produção do uso e consumo. Só catálogo: obra, elétrico, escritório, limpeza, copa, uniformes e veicular. Fica configurável por grupo |
| A3 | **Saldo inicial:** contagem física ou saldo do GRV | Contagem, começando pelos itens de maior valor (bronze, ligas, pós, resinas). O saldo do GRV só serve de referência na contagem |
| A4 | **Custo do estoque:** médio ponderado ou último preço | Médio ponderado, que é o que o Fiscal usa. O último preço aparece ao lado |
| A5 | **Saída do estoque:** quem registra e com o quê | O Henrique registra a requisição de saída no balcão, com OS (Forja) ou centro (Fundição, Usinagem, Administrativo). É isso que alimenta o custo por OS |
| A6 | **Material novo:** quem cadastra e como nasce o código | Compras e Almoxarifado cadastram; o código sai do grupo continuando o GRV (próximo número informado na virada), como nos produtos |
| A7 | **Ativo imobilizado** (cerca de 450 itens) | Fora do almoxarifado: ficam inativos no catálogo até existir o Patrimônio |
| A8 | **EPI:** unir o cadastro do RH com o do Almoxarifado | Unir: o EPI do RH aponta para o material, e a entrega ao funcionário dá baixa no estoque. O CA continua controlado pelo RH |
| A9 | **Reposição:** estoque mínimo gera o quê | Aviso e **solicitação sugerida** para o Henrique confirmar, nunca compra automática |
| A10 | **Local físico** (prateleira, sala, almoxarifado da Fundição × da Usinagem) | Um local por empresa no começo, com o campo pronto para vários. Confirmar com o Henrique se a Fundição tem estoque separado |

## 6. O que precisamos do GRV e da equipe

1. **As quatro exportações do cadastro de itens.** Já temos as de 15/10. Pedir de novo só
   na virada, para pegar o que foi criado no meio do caminho.
2. **Movimentação dos últimos 12 meses** (entradas e saídas por item), se o GRV exportar.
   Serve para três coisas: separar o que se usa do que só está cadastrado, sugerir o estoque
   mínimo e montar a curva ABC da contagem.
3. **O próximo número de cada grupo** no GRV, para o código de material novo continuar dele.
4. **Do Henrique:** onde fica cada tipo de material e se existe estoque separado por setor (A10).
5. **Do Jefferson ou do contador:** a revisão da lista de plano de contas trocado e dos itens
   sem NCM. Ela sai pronta na M1.

## 7. Etapas

### M1: Catálogo de materiais
- **Objetivo:** os 9.340 itens do GRV na plataforma, pesquisáveis, com o código do GRV.
- **Entregas:**
  - **Tabelas:**
    - `materials` com código, nome, família, grupo e subgrupo, unidade de estoque e de
      compra, NCM, plano de contas, tipo fiscal, custo de referência do GRV, `controla_estoque`
      (pelo grupo, A2), ativo e origem;
    - `material_groups` com família, grupo, prefixo, próximo número e `controla_estoque`;
    - tabela de unidades padronizadas.
  - **Importação** a partir das quatro planilhas:
    - um script com simulação primeiro e gravação uma única vez (`--apply`), nunca repetida;
    - relatório das pendências (sem NCM, custo zero, plano trocado, unidade mapeada).
  - **Tela Almoxarifado › Materiais:**
    - busca pelo código ou pelo nome, filtros por família e grupo;
    - cadastro e edição, com o código pelo grupo (A6);
    - inativar e reativar.
  - **Permissão nova** `almoxarifado.materiais` (ver e operar). O Compras tem leitura.
- **Aceite:** a contagem por família e por grupo bate com as planilhas. Uma busca por dez
  itens reais que a Kaylane comprou nesta semana acha todos.
- **Depende de:** A1, A2, A6 e A7.

### M2: Material ligado no fluxo de compra
- **Objetivo:** do pedido à nota, o mesmo material. O texto livre continua permitido, mas
  fica marcado "sem material".
- **Entregas:**
  - **Solicitação, cotação e compra direta:** o campo do item vira busca no catálogo, como
    no orçamento. Um `material_id` opcional entra em `material_request_items`,
    `cotacao_produtos`, `compras` e `receipt_items`, e a solicitação passa o material para a
    cotação.
  - **Recebimento:**
    - cada item da nota é ligado a um material;
    - **de-para por fornecedor:** o código do fornecedor (cProd) fica gravado, e na próxima
      nota do mesmo fornecedor a ligação já vem pronta;
    - o CFOP e a quantidade convertida para a unidade de estoque também ficam gravados.
  - **Ligação retroativa:** as 360 compras e os 497 itens cotados que já existem recebem o
    material sugerido pelo código no texto e pelo nome. Quem confirma é a pessoa, na tela.
- **Aceite:** num mês de recebimentos reais, pelo menos 80% dos itens chegam ligados a um
  material, e o de-para acerta sozinho a partir da segunda nota de cada fornecedor.
- **Depende de:** M1.

### M3: Estoque (saldo, custo médio, saída)
- **Objetivo:** saber quanto existe e quanto custa, nos grupos que controlam estoque.
- **Entregas:**
  - **`stock_movements`:** cada movimento aponta para o documento que o gerou.

    | Movimento | Origem |
    |---|---|
    | Entrada | Recebimento |
    | Saída | Requisição, com OS ou centro (A5) |
    | Ajuste | Com motivo |
    | Inventário | Contagem |
    | Devolução | Ao fornecedor |
  - **Saldo e custo médio** calculados no banco. O **saldo nunca fica negativo**: a trava é no
    banco, e não só na tela.
  - **Requisição de saída no balcão**, no celular ou tablet:
    - o material vem pela busca;
    - quantidade, OS da Forja ou centro, e quem retirou.
  - **Ficha do material:** o histórico de movimentos (kardex), o saldo e o custo médio.
  - **Recebimento:** confirmar a nota dá entrada nos itens ligados a material que controla
    estoque. Nota de serviço e item só de catálogo não mexem no saldo.
  - **Treino:** entradas e saídas de treino não mexem no saldo real.
- **Aceite:**
  - uma semana de recebimentos e saídas reais;
  - saldo e custo médio conferidos à mão em dez itens;
  - a matriz de acesso prova que quem só vê não movimenta.
- **Depende de:** M2, A4 e A5.

### M4: Inventário inicial
- **Objetivo:** abrir o saldo com contagem, não com o GRV.
- **Entregas:**
  - **Contagem** por grupo ou local, no tablet:
    - a lista vem com o saldo do GRV escondido;
    - quem conta digita a quantidade;
    - uma segunda contagem é feita quando a diferença passa de um limite.
  - **Relatório de diferenças** contra o GRV, com o valor de cada uma.
  - **Abertura do saldo** pelos movimentos de inventário, grupo por grupo, para não parar o
    almoxarifado inteiro.
- **Aceite:** todos os grupos que controlam estoque (A2) contados. A diferença contra o GRV
  fica documentada e é aprovada pelo proprietário antes da abertura.
- **Depende de:** M3 e A3.

### M5: EPI ligado ao estoque
- **Objetivo:** o EPI entregue pelo RH sai do estoque do Almoxarifado.
- **Entregas:**
  - cada item de `rh_ppe_items` aponta para o material, ligado pelo número do CA e pelo
    nome. Hoje só 10 dos 34 casam sozinhos; os outros são confirmados pelo RH;
  - a entrega ao funcionário gera a saída do estoque com o centro do funcionário;
  - o aviso de CA vencido continua no RH.
- **Aceite:** um mês de entregas de EPI com o saldo batendo com a contagem dos EPIs.
- **Depende de:** M3, M4 (pelo menos o grupo EPI) e A8.

### M6: Reposição
- **Objetivo:** não faltar o que para a produção.
- **Entregas:**
  - estoque mínimo e máximo por material, sugerido pelo consumo (exportação 2 ou pelos
    próprios movimentos depois de 3 meses);
  - painel "abaixo do mínimo" no Almoxarifado;
  - **solicitação sugerida** com os itens e as quantidades até o máximo. O Henrique confirma (A9).
- **Aceite:** um mês sem falta de material de curva A que o painel não tenha avisado antes.
- **Depende de:** M3 e A9.

### M7: Virada (o GRV deixa de controlar o estoque)
- **Objetivo:** a plataforma vira a fonte do estoque.
- **Entregas:**
  - importação do que foi cadastrado no GRV depois de 15/10;
  - numeração de material novo continuando a do GRV;
  - período combinado de uso em paralelo, com conferência semanal.
- **Também se liga a outros planos:**
  - a **lista de materiais** do produto ([PLANO-ORCAMENTO.md](PLANO-ORCAMENTO.md), E7) passa
    a apontar para os materiais (parafusos 2-01, pó 2-08, caixa 3-02);
  - o **custo por OS** ([PLANO-CUSTO-MARGEM.md](PLANO-CUSTO-MARGEM.md), etapa 6) passa a ler
    as saídas com OS.
- **Aceite:** um mês inteiro de entradas, saídas e inventário só pela plataforma.
- **Depende de:** M1 a M5.

## 8. Ordem e portões

| Ordem | Etapa | Travada por |
|---|---|---|
| 0 | Decisões A1 a A10 e itens 2 a 5 da seção 6 | proprietário, Henrique, Kaylane e Jefferson |
| 1 | M1 Catálogo | A1, A2, A6 e A7 |
| 2 | M2 Material no fluxo de compra | M1 |
| 3 | M3 Estoque | M2, A4 e A5 |
| 4 | M4 Inventário inicial | M3, A3 e agenda da contagem |
| 5 | M5 EPI | M3, M4 (grupo EPI) e A8 |
| 6 | M6 Reposição | M3 e A9 (em paralelo com M5) |
| 7 | M7 Virada | M1 a M5 |

**Portão:** cada etapa só termina com o aceite verificado no banco real e em produção, e
com quem vai usar testando com dado real:
- M1 e M2: Henrique e Kaylane;
- M3 e M4: Henrique;
- M5: RH.

## 9. Regras

1. **Importação uma vez só.** O `--apply` das planilhas roda uma única vez. Depois disso, o
   cadastro vive na plataforma, e uma nova exportação do GRV só acrescenta o que falta, nunca
   sobrescreve.
2. **O recebimento nunca trava por falta de material.** Item sem material entra como hoje
   (conta a pagar e ICMS) e fica na lista "ligar ao material".
3. **Saldo nunca negativo, e cada movimento tem documento:**
   - a trava do saldo é no banco;
   - todo movimento aponta para o recebimento, a requisição, o inventário ou o ajuste, com
     autor e motivo.
4. **O treino nunca mexe em saldo real.**
5. **Multiempresa:**
   - família, grupo, prefixo, unidades, os grupos que controlam estoque e os locais são
     configuração por empresa;
   - nada da PecSil fica fixo no código.
6. **Custo e plano de contas:** o estoque não muda a conta a pagar. Ela continua saindo da
   nota, como hoje; o custo médio é do estoque.
7. **Fornecedor e item no serviço externo:** se algum modelo de decisão (Clef) for usado para
   sugerir a ligação item × material, ele recebe só o nome do item, nunca dado pessoal. A
   sugestão aparece marcada como do modelo, com a confiança à vista.

## 9a. Andamento

**15/10/2026:**
- análise das quatro exportações e do cruzamento com as compras da plataforma (seção 3);
- plano escrito.

**16/10/2026, M1 em código** (falta aplicar a migração e gravar a carga):
- migração `202610160001_almoxarifado_materiais.sql` (grupos, materiais, busca, próximo código, permissão `almoxarifado.materiais`);
- `scripts/import-almoxarifado-materiais.mjs` (simulação conferida: 9.340 itens, 46 grupos, 8.315 ativos);
- tela Almoxarifado › Materiais;
- o catálogo vai para a Forja na sincronização (lista de materiais da OS).

## 10. Registro de decisões

| Data | Item | Decisão | Quem |
|---|---|---|---|
| 15/10/2026 | A1, A2, A6, A7 | Aprovadas como recomendadas: importar os 9.340 itens (inativos os sem saldo, custo e compra); estoque em matéria-prima, intermediário, embalagem, EPI e Produção; Compras e Almoxarifado cadastram, com código pelo grupo; ativo imobilizado fica fora | Proprietário |
| 15/10/2026 | Condição | Os materiais do catálogo aparecem para o Rafael compor a lista de materiais da OS do produto ganho (na Forja, enviada pela integração) | Proprietário |
