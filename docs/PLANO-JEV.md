# Plano de uso do Jev no PecSil Business OS

> **A ordem de construção está em [`ROADMAP.md`](ROADMAP.md)** (fonte única desde 16/10/2026). Este documento guarda o desenho, as decisões e os critérios de aceite.

> Documento de referência. Cada etapa só começa quando a anterior cumprir o
> critério de aceite, e nenhuma etapa muda de escopo sem decisão registrada
> aqui (seção 6).
>
> Criado em 25/09/2026 · Dono: proprietário da PecSil · Execução: Claude

> **Troca de modelo: Clef no lugar do Jev** (decidida em 03/10/2026, registrada em
> 10/10/2026). O modelo chamado passa a ser o **Clef**, da Cloudflare: `clef-flash` para
> decisões rápidas e `clef` para as mais difíceis. A API dele é compatível com a do Jev,
> com os mesmos três tipos de pergunta (`noul`, `choice`, `score`) e confiança em cada
> resposta. **Etapas, portões e regras deste documento continuam valendo; muda só o
> modelo.** Onde o texto diz "Jev", leia "modelo de decisão (hoje o Clef)". Os ajustes da
> Etapa 0 estão na seção 3, e o registro na seção 7.

---

## 1. O que é o Jev e o que ele não é

O **Jev** é o modelo System One da TypeSafe. Ele recebe um texto curto (o
"estado") e responde a perguntas **tipadas**, sempre com uma medida de confiança.
Só existem três tipos de pergunta (contrato em https://docs.typesafe.ai/api.md,
já usado em `scripts/jev.mjs`):

| Tipo | Devolve | Exemplo |
|---|---|---|
| `noul` | valor de 0 a 1: o quanto a afirmação é verdadeira | "Estes dois nomes são a mesma empresa?" |
| `choice` | uma opção de uma lista, com a probabilidade de cada uma | "Este gasto é de produção, manutenção ou administrativo?" |
| `score` | uma nota numa escala ordenada | "Qual a urgência: baixa, média ou alta?" |

**O que ele NÃO faz:** extrair valores de um texto (quantidade, data, número de
pedido), escrever texto, nem decidir sozinho. Quando uma etapa precisar extrair
algo, a extração é feita por **regra local**, e o Jev só julga.

---

## 2. Regras que valem para todas as etapas

Estas regras não se negociam por etapa. Elas complementam a convenção
"Jev fala em azul" do `CLAUDE.md`.

1. **O Jev sugere; uma pessoa confirma.** Nenhuma escrita definitiva no banco
   (unificar cadastro, conciliar, classificar) acontece só com o julgamento do
   Jev. A exceção é marcar uma **sugestão** como pendente de conferência.
2. **Três faixas de confiança, por etapa:**
   - **alta** (≥ limite superior): a sugestão aparece pronta para confirmar com um clique;
   - **média**: a sugestão vai para a **fila de conferência**;
   - **baixa** (< limite inferior): descartada, e o caso segue o fluxo manual de hoje.

   Os limites de cada etapa ficam na tabela `jev_uses` (seção 3) e são
   recalibrados com a taxa de acerto medida.
3. **Na tela, o que vem do Jev é marcado como tal:** selo azul "Sugestão do Jev"
   com a confiança em porcentagem. Nunca é apresentado como dado apurado.
4. **Enviar só o mínimo.** Cada etapa define o que vai no "estado", e nada além
   disso é enviado.
5. **Nunca enviar:** CPF, PIS, CTPS, RG, CID, diagnóstico, observação clínica,
   salário, dado bancário de pessoa física, nome de colaborador junto de dado de
   saúde, nem o conteúdo da caixa do diretor. Um **filtro de saída**
   (`lib/jev/guard.ts`) bloqueia o envio quando encontra padrão de CPF ou PIS (11
   dígitos), código CID (`[A-Z]\d{2}(\.\d)?`), e-mail pessoal ou telefone. O
   bloqueio vira registro, não erro silencioso.
6. **Nunca usar em decisão com peso legal:** aprovar férias ou ausência, dar SST
   como conforme, aprovar pagamento, desligar colaborador.
7. **Tudo auditado.** Cada consulta grava em `jev_judgments` o que foi perguntado
   (resumo, sem o dado bruto quando for sensível), a resposta, a confiança, o
   modelo, a latência e **o que a pessoa decidiu depois**. É assim que se mede a
   taxa de acerto.
8. **Falha do serviço não trava a operação.** Se a TypeSafe estiver fora do ar ou
   lenta (tempo máximo de 8 s), a tela segue no fluxo manual e mostra "sugestão
   indisponível". Erro de rede ou de chave nunca aparece em azul (é do serviço,
   não do Jev).
9. **Cada etapa começa desligada.** Só o proprietário liga (seção 3), e sempre
   depois de uma **simulação** conferida.

---

## 3. Etapa 0: base comum (pré-requisito de todas)

**Objetivo:** montar uma vez a infraestrutura que as 9 etapas vão usar, para não
repetir cliente, auditoria e marcação na tela em cada módulo.

**Entregas:**

| Peça | O que é |
|---|---|
| `lib/jev/client.ts` (server-only) | Cliente da TypeSafe: `perguntar({ uso, estado, perguntas })`. Aplica o guard, o tempo máximo, 1 nova tentativa em erro 5xx, grava em `jev_judgments` e devolve a resposta tipada. A chave vem de `TYPESAFE_API_KEY`, nunca com `NEXT_PUBLIC_`. |
| `lib/jev/guard.ts` | Filtro de saída da regra 5, com testes (`tests/jev-guard.test.mjs`). |
| Migração `jev_uses` | Um registro por uso (`cadastros.unificacao`, `epi.catalogo`…): `enabled`, `limite_alto`, `limite_baixo`, `modelo`. Só o proprietário lê e altera. |
| Migração `jev_judgments` | Auditoria: `uso`, `entidade`, `entidade_id`, `estado_resumo`, `resposta jsonb`, `confianca`, `latencia_ms`, `tokens`, `decisao_humana` (aceita / recusada / corrigida / ignorada), `decidido_por`, `decidido_em`. Lido por quem tem a função do módulo correspondente. |
| Função de acesso `fundacao.jev` | Quem pode ver e decidir a fila de conferência (níveis ver e operar). Cada item da fila também exige a função do módulo de origem: conferir sugestão de cadastro pede `fundacao.cadastros`, e assim por diante. |
| Componente `JevSuggestion` (Design System) | Selo azul "Sugestão do Jev · 87%", botões Aceitar e Recusar, e um "por quê?" com a pergunta feita. Claro e escuro. |
| Tela **Fundação › Sugestões do Jev** | A fila de conferência de todos os usos, com filtro por uso e a taxa de acerto de cada um. |
| Painel de uso (proprietário) | Liga e desliga cada uso, ajusta os limites e mostra consultas por dia, acerto e tempo médio. |
| Variável no Coolify | `TYPESAFE_API_KEY` configurada na aplicação `i3rwerhgkqqurapbrowuho1p`. |
| `scripts/jev-simular.mjs` | Roda um uso sobre os dados reais **sem gravar sugestão**, gera o relatório de conferência em `~/Downloads` (mesmo molde das importações do RH). |

**Com o Clef (10/10/2026), a Etapa 0 é construída já com ele:**

- **Cliente:** chama o Workers AI da Cloudflare
  (`/accounts/<CLOUDFLARE_ACCOUNT_ID>/ai/run/@cf/cloudflare/clef-flash` ou `…/clef`).
  - Chaves `CLOUDFLARE_ACCOUNT_ID` e um token **só de Workers AI**, guardados no
    `.env.local` e no Coolify, nunca com `NEXT_PUBLIC_`.
  - O modelo de cada uso fica em `jev_uses.modelo`. Os nomes das peças podem virar
    neutros na construção (ex.: `lib/decisao/`); o papel de cada uma não muda.
- **Selo na tela:** "Sugestão do Clef · 87%", seguindo a mesma regra de exibição do
  `CLAUDE.md`.
- **Variáveis no Coolify:** as da Cloudflare, no lugar de `TYPESAFE_API_KEY`.
- **Antes de ligar qualquer uso:** simulação em português com casos reais da PecSil
  (fornecedores parecidos, gastos, pedidos de material) pelo `jev-simular`, com
  relatório conferido pelo proprietário. Os números publicados são da própria Cloudflare
  e precisam ser confirmados aqui.
- **Usuário fora do plano:** o Segundo Cérebro
  ([`PLANO-SEGUNDO-CEREBRO.md`](./PLANO-SEGUNDO-CEREBRO.md)) usa esta mesma base na
  triagem de arquivos e no mapeamento de colunas de planilhas.

**Critério de aceite:**
- testes do guard com CPF, CID e e-mail bloqueados;
- consulta de ponta a ponta registrada em `jev_judgments`;
- com o serviço do modelo fora do ar (simulado), a tela segue no fluxo manual sem erro;
- a matriz de acesso (`scripts/access-matrix-check.mjs`) cobre `jev_uses` e `jev_judgments`;
- telas em 1440 e 390, claro e escuro.

---

## 4. As 9 etapas

Formato de cada etapa: **objetivo · dados · pergunta ao Jev · o que se envia ·
fluxo · limites iniciais · aceite · depende de**.

### Etapa 1: Unificação de fornecedores e clientes

- **Objetivo:** achar cadastros duplicados ("ARGETEX LTDA" e "Argetex Ind. Com.")
  e sugerir a unificação. A função de unificar já existe.
- **Dados:** `suppliers` (69 hoje), `customers`, `merge_suppliers`, `merge_customers`,
  tela Fundação › Cadastros (`app/components/master-data.tsx`).
- **Pré-filtro local (sem Jev):** gerar só pares candidatos por similaridade de
  nome normalizado (trigram ≥ 0,3, ou mesma raiz de CNPJ). Isso evita perguntar
  2.346 pares.
- **Pergunta:** `noul:mesma_empresa = "Os dois nomes se referem à mesma empresa?"`
- **Envia:** os dois nomes. **Não envia:** CNPJ, e-mail, endereço.
- **Fluxo:** simulação → relatório com os pares e a confiança → conferência do
  proprietário → uso ligado → cada par aparece na fila com "Unificar" (chama
  `merge_suppliers`) ou "São diferentes" (o par fica marcado e não volta a ser
  perguntado).
- **Limites iniciais:** alto 0,90 · baixo 0,50.
- **Aceite:** na simulação, pelo menos 90% de acerto na faixa alta, conferido à
  mão; nenhuma unificação sem clique humano; a unificação gera evento na trilha.
- **Depende de:** Etapa 0.

### Etapa 2: Catálogo de EPI

- **Objetivo:** dizer se um EPI escrito de outro jeito é um item que já está no
  catálogo, na importação e no cadastro manual. Resolve os itens sem CA ("Luva
  nitrílica" × "LUVA NITRÍLICA PVC KALIPSO CA 11769").
- **Dados:** `rh_ppe_items` (34), `rh_ppe_deliveries`, `scripts/import-rh-epi.mjs`.
- **Pré-filtro local:** os 5 itens do catálogo mais parecidos com o nome novo.
- **Pergunta:** `choice:item = "Qual item do catálogo é este EPI?"`, com as 5
  opções mais `nenhum:é outro item`.
- **Envia:** o nome do item e os nomes das 5 opções. **Não envia:** colaborador,
  CPF, data.
- **Fluxo:** na simulação da importação, o relatório passa a mostrar a sugestão
  de correspondência; na tela do catálogo, "Unificar com…" pede confirmação. O CA
  nunca é inventado: unificar mantém o CA do item de destino.
- **Limites iniciais:** alto 0,85 · baixo 0,40.
- **Aceite:** os 3 itens sem CA de hoje com sugestão conferida; nenhuma troca de
  CA sem confirmação.
- **Depende de:** Etapa 0.

### Etapa 3: Classificação de gastos (Financeiro)

- **Objetivo:** sugerir a conta contábil e o centro de custo de um título a pagar
  a partir da descrição.
- **Dados:** `finance_titles` (`description`, `chart_account_id`, `cost_center_id`),
  `finance_chart_accounts`, `finance_cost_centers`. **Hoje há 1 título**: a etapa
  só é útil com o Financeiro em uso.
- **Pergunta:** em dois passos, para não mandar listas longas:
  1. `choice:grupo` entre os grupos de primeiro nível do plano de contas;
  2. `choice:conta` entre as contas do grupo escolhido. O mesmo para o centro de custo.
- **Envia:** a descrição do título e o nome do fornecedor. **Não envia:** valor,
  dado bancário, CNPJ.
- **Fluxo:** ao lançar um título sem classificação, o campo mostra a sugestão
  (`JevSuggestion`); ao salvar, grava o que a pessoa escolheu e registra se ela
  aceitou.
- **Aprendizado local antes do Jev:** quando o mesmo fornecedor já teve 3 ou mais
  títulos com a mesma classificação, a sugestão vem da história e o Jev não é
  consultado.
- **Limites iniciais:** alto 0,80 · baixo 0,45.
- **Aceite:** com pelo menos 50 títulos reais, acerto de 80% ou mais na faixa alta.
- **Depende de:** Etapa 0 e o Financeiro em uso real.

### Etapa 4: Conciliação bancária assistida

- **Objetivo:** sugerir qual título corresponde a cada lançamento do extrato.
- **Dados:** `finance_bank_entries` (`description`, `amount`, `booking_date`),
  `finance_titles`, `finance_reconciliations`.
- **Pré-filtro local (obrigatório):** candidatos com o **mesmo valor** (ou
  soma de parcelas) e data em até ±10 dias. O Jev só desempata entre os candidatos.
- **Pergunta:** `choice:titulo = "Qual título corresponde a este lançamento?"`,
  com até 5 candidatos mais `nenhum`.
- **Envia:** o histórico do extrato e a descrição e o fornecedor de cada candidato.
  **Não envia:** número de conta, agência, CPF, valor além do que já casou.
- **Fluxo:** a tela de conciliação mostra a sugestão; conciliar exige clique.
  **Nunca concilia sozinho.**
- **Limites iniciais:** alto 0,85 · baixo 0,50.
- **Aceite:** em um mês de extrato real, acerto de 90% ou mais na faixa alta e
  nenhuma conciliação automática.
- **Depende de:** Etapa 0, importação de extrato em uso e a Etapa 3 (títulos bem classificados).

### Etapa 5: Pedidos por e-mail no funil (Comercial)

- **Objetivo:** além da classificação do e-mail (etapa 4 do CRM), julgar a
  **urgência** e se o e-mail é um **pedido novo ou a continuação** de um card aberto.
- **Dados:** `mail_messages`, `mail_classifications`, `crm_cards`,
  `crm_card_messages`.
- **Perguntas:**
  - `score:urgencia = "Qual a urgência deste pedido?" | baixa, média, alta`;
  - `choice:card = "Este e-mail continua qual conversa?"`, com os cards abertos do
    mesmo cliente mais `novo`.
- **Extração (sem Jev):** item e quantidade são lidos por regra local (padrões de
  número + unidade) e aparecem como "a conferir". O Jev não extrai valores.
- **Envia:** assunto e corpo **limpos**: sem assinatura, com telefones, e-mails
  e sequências de 8 ou mais dígitos mascarados, só da caixa comercial@.
  **Nunca** da caixa do diretor.
- **Fluxo:** o card nasce na Triagem com a urgência sugerida e, quando for
  continuação, aparece "anexar ao card X?".
- **Limites iniciais:** alto 0,80 · baixo 0,50.
- **Aceite:** em 100 e-mails reais conferidos, acerto de 85% ou mais na
  continuação e nenhum card juntado sem clique.
- **Depende de:** Etapa 0, conexão com o Microsoft 365 (`docs/CONEXAO-EMAIL-MICROSOFT.md`)
  e etapa 4 do CRM.

### Etapa 6: Respostas à cobrança

- **Objetivo:** classificar a resposta do cliente a um aviso de cobrança.
- **Dados:** régua de cobrança (etapa 6 do CRM), `finance_titles` a receber,
  `mail_messages`.
- **Pergunta:** `choice:resposta = "O que o cliente respondeu?"`:
  `ja_pagou:diz que já pagou` · `promessa:promete pagar em uma data` ·
  `contestacao:contesta o valor ou a cobrança` · `pedido_boleto:pede segunda via` ·
  `outro`.
- **Envia:** o texto da resposta, limpo como na Etapa 5. **Não envia:** valor,
  dado bancário.
- **Fluxo:** o título ganha um selo com a sugestão.
  - "Já pagou" abre a conciliação (Etapa 4) para conferir.
  - "Promessa" pede à pessoa a data prometida; a data não é extraída pelo Jev.
  - "Contestação" suspende a régua até alguém tratar.
- **Limites iniciais:** alto 0,80 · baixo 0,50.
- **Aceite:** em 50 respostas reais, acerto de 85% ou mais; nenhum título
  baixado ou suspenso sem clique.
- **Depende de:** Etapa 0, etapa 6 do CRM e títulos a receber em uso.

### Etapa 7: Equivalência de itens em cotações (Compras)

- **Objetivo:** reconhecer quando fornecedores diferentes cotaram o mesmo produto
  com descrições diferentes, para comparar preço justo.
- **Dados:** `cotacoes` (191 hoje; `produto`, `unidade`, `valor_unit`, `supplier_id`).
- **Pré-filtro local:** mesma unidade e similaridade de descrição ≥ 0,3.
- **Pergunta:** `noul:mesmo_item = "As duas descrições são o mesmo produto?"`
- **Envia:** as duas descrições e as unidades. **Não envia:** preço, fornecedor.
- **Fluxo:** na tela de cotação, "Itens equivalentes" agrupa as sugestões
  confirmadas e mostra o menor preço por unidade. O agrupamento só vale depois de
  confirmado.
- **Limites iniciais:** alto 0,85 · baixo 0,50.
- **Aceite:** nas 191 cotações, relatório de grupos conferido pelo comprador com
  90% ou mais de acerto na faixa alta.
- **Depende de:** Etapa 0 (e ajuda a Etapa 1: fornecedor unificado).

### Etapa 8: Motivos de parada e defeito (Produção)

- **Objetivo:** dar causa confiável às paradas para gerar Pareto e indicadores.
- **Dados:** paradas vêm do **Forja** (`lib/forja/client.ts`), não do nosso banco.
  **Correção (25/09/2026):** o Forja **já tem motivos catalogados**
  (`motivos_parada`: código, nome, planejada ou não), e cada parada aponta para um
  deles. O Jev **não** reclassifica o que já tem motivo; atua só em dois casos:
  1. paradas registradas no motivo genérico ("outro") com texto em `observacoes`:
     sugerir o motivo do catálogo;
  2. agrupar os motivos do catálogo na taxonomia de causa-raiz, se ela for mais ampla
     que o catálogo (ex.: vários motivos elétricos → "elétrica").

  A sugestão fica numa tabela nossa, `producao_motivo_classificacao` (id da parada
  no Forja, motivo sugerido, confiança, confirmado_por), sem alterar o Forja.
- **Decisão necessária antes de começar:** se a taxonomia de causa-raiz é o próprio
  catálogo do Forja ou uma camada acima dele, definida com a Produção.
- **Pergunta:** `choice:motivo = "Qual o motivo desta parada?"` entre os motivos
  ativos do catálogo do Forja.
- **Envia:** o texto da observação e a máquina/setor. **Não envia:** nome do operador.
- **Fluxo:** classificação em lote (histórico) com relatório → conferência pelo
  líder de produção → gráficos passam a usar a categoria confirmada; os novos
  registros entram na fila.
- **Limites iniciais:** alto 0,80 · baixo 0,45.
- **Aceite:** amostra de 100 motivos conferida com 85% ou mais de acerto; o Pareto
  mostra quanto é "confirmado" e quanto é "sugerido".
- **Depende de:** Etapa 0, taxonomia aprovada e confirmação do campo de motivo no Forja.

### Etapa 9: Encaminhar perguntas (SARA e Busca corporativa)

- **Objetivo:** entender uma pergunta em linguagem natural e levar a pessoa ao
  módulo e à tela certos ("quanto devo à Argetex?" vai para Financeiro › Contas a pagar).
- **Dados:** catálogo de módulos e funcionalidades (`modules/access-catalog.ts`),
  Busca corporativa, e a SARA quando existir (roadmap).
- **Pergunta:** `choice:destino = "Qual área responde a esta pergunta?"` entre as
  funcionalidades **que a pessoa tem permissão de ver**. A lista é montada a partir do
  acesso dela, então o Jev nunca sugere o que ela não pode abrir.
- **Envia:** a pergunta como foi digitada, depois do guard. **Não envia:** dados
  de resposta; o Jev só escolhe o destino, e a busca real é feita pela plataforma
  com a RLS de sempre.
- **Fluxo:** na Busca corporativa, quando a busca por texto não encontra nada,
  aparece "Você quis dizer: Financeiro › Contas a pagar?" (sugestão do Jev).
- **Limites iniciais:** alto 0,75 · baixo 0,40.
- **Aceite:** em 50 perguntas reais, a área certa na primeira sugestão em 80%
  ou mais; nenhuma sugestão fora das permissões da pessoa (teste com a matriz de acesso).
- **Depende de:** Etapa 0; o uso completo depende da SARA.

---

### Etapa 10: Pedido do cliente → produto do orçamento (Comercial) · C-05 do roadmap

- **Objetivo:** ao ler o pedido de compra do cliente, desempatar qual produto do catálogo é cada
  linha quando a regra não decide sozinha.
- **Dados:** o texto do PDF do pedido (lido por regra local em `lib/comercial/pedido-cliente.ts`:
  item, código, descrição, quantidade, unidade, preço — com o "por 100" —, entrega e valor) e o
  catálogo `products` (3.902 peças).
- **Pré-filtro local (sem modelo):** 1) de-para exato do código do cliente (`products.nome_cliente`);
  2) artigo de 6 dígitos + tipo pelo prefixo (BM, BL, BP, BF, a confirmar pelo Comercial) + material
  (CI-882, NI-806); 3) palavras da descrição. O Clef só é consultado com mais de um candidato e sem
  de-para.
- **Pergunta:** `choice:produto = "Qual produto do catálogo é a peça pedida?"` com até 5 candidatos e
  "nenhum destes".
- **Envia:** a descrição da linha (código da peça no cliente) e as descrições dos candidatos.
  **Não envia:** preço, quantidade, nome do cliente, número do pedido, CNPJ.
- **Fluxo:** a tela mostra a sugestão da regra (com o motivo) e, à parte, "Sugestão do Clef · %"; a
  pessoa escolhe; ao adicionar, o código do cliente vira o de-para do produto e a decisão sobre a
  sugestão é gravada (aceita/corrigida).
- **Limites iniciais:** alto 0,85 · baixo 0,50.
- **Aceite:** em 50 linhas reais, 90% ou mais de acerto na faixa alta; nenhuma linha adicionada sem
  confirmação.
- **Começa desligada:** registrada em `ai_uses` (`comercial.pedido_produto`) desligada em 17/10/2026;
  só o proprietário liga, depois da simulação (`scripts/decisao-simular.mjs`) conferida.
- **Depende de:** Etapa 0. Sem o Clef, a regra sozinha já entrega a leitura e os candidatos.

## 5. Ordem de execução

> Desde 16/10/2026 a ordem entre os itens é decidida em [`ROADMAP.md`](ROADMAP.md). O que segue fica só como dependências internas e portões deste plano.


A ordem segue a prontidão dos dados e o risco:

| Ordem | Etapa | Por que nesta posição | Pronta para começar? |
|---|---|---|---|
| 0 | Base comum | pré-requisito | sim |
| 1 | Unificação de cadastros | dado real (69 fornecedores), risco baixo, limpa a base de tudo | sim, após a 0 |
| 2 | Catálogo de EPI | dado real (34 itens), resolve os itens sem CA | sim, após a 0 |
| 3 | Equivalência em cotações (etapa 7) | dado real (191 cotações), aproveita a unificação | sim, após a 1 |
| 4 | Motivos de parada (etapa 8) | valor alto para a Produção | **parcial**: o catálogo já existe no Forja; falta decidir a taxonomia de causa-raiz |
| 5 | Classificação de gastos (etapa 3) | ganho grande no Financeiro | **não**: Financeiro em uso (hoje 1 título) |
| 6 | Conciliação (etapa 4) | depende da classificação | **não**: extratos importados |
| 7 | Pedidos por e-mail (etapa 5) | depende do CRM | **não**: Microsoft 365 |
| 8 | Respostas à cobrança (etapa 6) | depende do CRM e do Financeiro | **não**: régua de cobrança |
| 9 | Encaminhar perguntas (etapa 9) | depende da SARA para o uso completo | parcial: na Busca |

**Portão entre etapas:** uma etapa só começa quando a anterior da ordem cumprir
o critério de aceite **e** estiver ligada em produção há pelo menos 1 semana sem
incidente.

---

## 6. Como executar cada etapa (roteiro fixo)

1. Relê este documento e confere se as dependências da etapa estão cumpridas.
2. Plano detalhado da etapa (arquivos, migração, telas), aprovado pelo proprietário.
3. Implementação com testes (guard, pré-filtro, limites).
4. **Simulação** com `scripts/jev-simular.mjs` sobre os dados reais, com
   relatório em `~/Downloads`. **Nenhuma sugestão é gravada.**
5. O proprietário (ou o responsável da área) confere o relatório e marca os acertos.
6. Ajuste dos limites com base no acerto medido e registro aqui (seção 7).
7. Uso ligado em produção **desligado por padrão**; o proprietário liga no painel.
8. Verificação: matriz de acesso, telas em 1440 e 390 nos dois temas, e o teste
   com a TypeSafe fora do ar.
9. Commit, merge e deploy só com pedido explícito.
10. Uma semana depois: revisar a taxa de acerto em `jev_judgments` e decidir se a
    próxima etapa pode começar.

**Mudança de escopo:** qualquer desvio (novo dado enviado, nova pergunta,
automação sem clique) é registrado na seção 7 com data e quem decidiu, antes de
ser feito.

---

## 7. Registro de decisões e calibração

| Data | Etapa | Decisão | Quem |
|---|---|---|---|
| 25/09/2026 | todas | Plano criado; ordem e regras aprovadas para execução | Proprietário |
| 25/09/2026 | 8 | Motivos de parada já são catalogados no Forja; a etapa passa a tratar só paradas no motivo genérico com observação e o agrupamento por causa-raiz | Claude, conferido no schema do Forja |
| 03/10/2026 | todas | O modelo passa a ser o **Clef** (Cloudflare) no lugar do Jev; etapas, portões e regras ficam iguais | Proprietário |
| 10/10/2026 | 0 | A Etapa 0 (base comum) é construída já com o Clef e passa a servir também ao Segundo Cérebro (triagem de arquivos e mapeamento de colunas). Antes de ligar, simulação em português com casos reais | Proprietário |
| 10/10/2026 | 0 | Etapa 0 construída com nomes neutros: `lib/decisao/` (guard, core, client), tabelas `ai_uses` e `ai_judgments`, funcionalidade `fundacao.sugestoes`, tela Fundação › Sugestões da IA, componente `SugestaoModelo`, `scripts/clef.mjs` e `scripts/decisao-simular.mjs`. Nenhum uso real ligado; só o uso `fundacao.teste` do proprietário | Claude, plano aprovado pelo proprietário |
| 10/10/2026 | 1 | Simulação de demonstração com 30 pares de nomes de fornecedores: só com o nome o Clef fica cauteloso (27 de 30 em confiança média; acerta os casos claros). A Etapa 1 precisa mandar mais contexto que o nome (CNPJ quando houver, cidade, o que foi comprado) | Claude, relatório em ~/Downloads |
| 17/10/2026 | 10 (C-05) | Uso novo registrado desligado: Clef só desempata o produto de cada linha do pedido do cliente entre candidatos da regra; vai só descrição. A leitura do pedido e o de-para são por regra. Ligar depende de simulação conferida | Proprietário autorizou construir; ligar é decisão dele |
| 17/10/2026 | SARA (I-12) | Uso novo de IA registrado: o modelo de **conversa** da SARA é o Claude (Anthropic: Haiku 5.5 no dia a dia, Sonnet 5.5 para análise), com as ferramentas da plataforma rodando com a sessão de quem pergunta; o Clef segue nas decisões tipadas. Vai ao modelo só o que a pergunta precisa; o filtro de dado pessoal roda antes; cada SARA nasce desligada, com teto de uso. Desenho em PLANO-SARA.md | Proprietário |
| 17/10/2026 | SARA (I-12) | Uso novo de IA registrado: **triagem da SARA pelo Clef** (`financeiro.sara_triagem`, `clef-flash`, limites 0,80/0,40). Antes do Haiku, o Clef escolhe numa lista fechada a consulta que responde (só entre as que a pessoa pode usar) e, nas contas, a situação; a plataforma roda a consulta e o Haiku já recebe o resultado (uma rodada a menos). Vai ao Clef só a frase da pergunta, depois do filtro de dado pessoal; 3 s de limite, sem nova tentativa. O Clef não escreve nada nem fornece número: os números vêm da consulta. A triagem **não aparece na tela** (proprietário, 17/10: é rotina interna, não muda nada para quem usa); fica na auditoria. Cada triagem é conferida automaticamente (aceita / corrigida / ignorada) em `ai_judgments`, sem virar pendência na fila. Nasce ligado por decisão do proprietário: só roda com a SARA do módulo ligada | Proprietário |
| 17/10/2026 | SARA (I-12) | **Triagem pelo Clef retirada** (proprietário). Medida no navegador: −27% de tokens e tempo igual, a mesma economia que o cache de prompt do Claude dá sem outro modelo, e o Haiku já escolhia a consulta certa sozinho. Uso `financeiro.sara_triagem` e funções apagados (migração 202610170014). O Clef volta à SARA só para **opinião** com a confiança à vista ("qual a chance de eu me endividar se comprar mais uma máquina?"), junto com o modo conselheiro | Proprietário |
| 17/10/2026 | SARA (I-12) | Uso novo de IA registrado: **verificador de escopo da SARA** (Claude Haiku 5.5, sem pensamento, resposta de uma palavra: DENTRO ou FORA). Roda em paralelo a cada pergunta, só com a frase da pessoa e o começo da última resposta; se der FORA, a conversa é cancelada e vai a recusa padrão ("Não estou autorizada a tratar de assuntos fora do contexto da <empresa> e das suas permissões…"), registrada na conversa. Se ele falhar, a regra fixa do prompt continua valendo. Calibrado em 25 perguntas (12 fora, 13 dentro, incluindo fronteiras como FINAME e DARF × GPS): 0 erro, ~0,8 s, ~500 tokens | Proprietário |
| 18/10/2026 | SARA (I-12) | **SARA estendida a todos os módulos** (Compras, Almoxarifado, Fundição, Comercial, Fiscal, RH, Portaria, Produção), com o mesmo modelo (Claude Haiku 5.5, sem pensamento, cache), o mesmo verificador de escopo e o mesmo filtro de dado pessoal; as consultas escolhem as colunas uma a uma (nunca CPF, PIS, salário, saúde, biometria, XML ou segredo). Os avisos dos módulos são calculados dos dados, sem modelo. Busca nos documentos do setor com a permissão do documento. Cada SARA é liberada por pessoa pelo proprietário | Proprietário |
| 18/10/2026 | SARA (I-12) | **Visual da resposta** (ferramenta `mostrar`, no mesmo Claude Haiku 5.5 da conversa; nenhum modelo novo). O modelo escolhe o componente e aponta a consulta e os campos; os números do gráfico/tabela são preenchidos pela plataforma com o resultado da consulta, nunca digitados pelo modelo, e cada visual mostra "Dados da consulta: …" com o link da tela. Nada novo vai ao serviço externo: o modelo já recebia o resultado da consulta | Proprietário |
| 19/10/2026 | SARA (I-12) | Uso novo de IA registrado: **pesquisa na internet da SARA** (ferramenta `web_search` da Anthropic, no mesmo Claude Haiku 5.5). Só no tema do módulo e só nos sites listados em `lib/sara/temas.ts` (órgãos oficiais e entidades do setor), até 3 buscas por pergunta. A busca leva só o assunto, nunca nome de pessoa, CPF, CNPJ ou dado da empresa: a regra está no prompt e cada termo buscado fica registrado na conversa, para auditoria. A resposta cita a fonte; o que vem da internet aparece como "Internet › site", separado do dado da plataforma. Prazo, alíquota ou valor de lei se pesquisa antes de responder, e toda conta passa por uma calculadora determinística | Proprietário |
| 19/10/2026 | SARA (I-12) | **SARA de TI com o modelo mais capaz** (proprietário): só o módulo de TI, por ser técnico, conversa com o Claude **Sonnet 5.5** (as outras seguem no Haiku 5.5); respostas até 4.000 tokens, linguagem técnica com passos e comandos, até 5 buscas por pergunta. A pesquisa da TI é a exceção da regra "só órgão oficial": lista fechada de documentação de fabricantes e sistemas (Microsoft, Linux, Docker, Coolify, Postgres, Supabase, rede, servidores, nobreak, impressoras, monitoramento, acesso remoto, CNC), mais CERT.br, NIC.br e governo. Os guardrails são os mesmos: verificador de escopo (Haiku) com o tema de TI, recusa padrão, só as consultas e permissões de quem conversa, filtro de dado pessoal; nunca pede nem repete senha, token, chave ou certificado; não inventa configuração do ambiente. Custo maior por token: o teto mensal de tokens do módulo continua valendo | Proprietário |
| 22/10/2026 | SARA (I-13) | **A SARA prepara ações** (pedir material, chamado de TI, anotar na Biblioteca; e, no aviso de pedido rejeitado, "Refazer o pedido"). Nenhum modelo novo: o mesmo Claude da conversa só prepara; a pessoa decide no cartão Permitir / Não permitir e a execução roda com a credencial dela, pela mesma função do banco da tela. O aviso com ação pronta não chama modelo | Proprietário |
| 22/10/2026 | SARA (I-14) | Uso novo de IA registrado: **foto na pergunta** (o mesmo Claude da conversa passa a ver imagem). A foto é reduzida no celular, vai só naquela pergunta e não é guardada (a conversa grava só a marca 📷). Serve para ler código e texto de etiqueta e procurar no catálogo | Proprietário |
| 22/10/2026 | SARA (I-14) | Uso novo de IA registrado: **voz da SARA** pelo **Whisper (`@cf/openai/whisper-large-v3-turbo`) na Cloudflare**, mesma conta e token só de Workers AI do Clef. Escolhido no lugar do Fish Audio porque a Cloudflare não treina nem guarda o conteúdo (política oficial conferida em 22/10) e custa US$ 0,0005 por minuto (franquia diária de 10.000 neurons, cerca de 3h30 de áudio). O áudio não passa pelo filtro `guard.ts` (que é de texto); não é guardado em lugar nenhum; o texto transcrito vira a pergunta normal. Transcrição não é julgamento: não sai em azul | Proprietário |
| 22/10/2026 | SARA (I-15) | Uso novo de IA registrado: **guias da SARA rodando sozinhas** (agenda ou acontecimento). É o mesmo Claude da conversa, com as mesmas regras e o mesmo teto do mês, rodando sem ninguém na conversa, com a sessão de quem criou a guia. O resumo do acontecimento (texto do `module_events`) vai no pedido. Nenhum dado passa pelo Clef. O resultado é resposta da SARA (IA), marcada como tal, não dado apurado | Proprietário |
| 23/10/2026 | SARA central (I-19) | Uso novo de IA registrado: **voz ao vivo da SARA central pelo Grok Voice (xAI, `grok-voice-3.0`, voz "luna", pt-BR)**, decisão do proprietário. O Grok é só a VOZ e o ritmo da conversa; o cérebro continua sendo a SARA central (Claude, as SARAs das áreas, o verificador e as permissões), chamada pela função `consultar_sara_central`. Os números conferidos são falados exatamente como vieram (`force_message`). Vão à xAI o áudio da conversa e o texto da resposta conferida. A xAI não treina com os dados da API, mas guarda as requisições por 30 dias, a menos que o **Zero Data Retention** seja ligado no painel da xAI (recomendado; decisão do proprietário). Chave `XAI_API_KEY` só no servidor; o navegador usa token temporário de 5 minutos. Custo: US$ 0,08 por minuto + US$ 0,004 por mensagem de texto | Proprietário |
| 23/10/2026 | SARA central (I-19, J2) | Uso novo de IA registrado: **Bom dia da SARA**. De segunda a sábado, às 7h, o Claude Haiku escreve um resumo do dia para cada pessoa com a SARA liberada, só com os fatos que a plataforma colheu com a sessão dela (avisos dos módulos, decisões e ações pendentes, guias). Todo número do texto é conferido com esses fatos; se algum não bater, ou se o modelo falhar, sai o texto montado pela plataforma. Vão ao modelo os títulos e detalhes desses avisos (os mesmos que a pessoa vê). Nenhum dado passa pelo Clef. Custo no teto do mês do módulo; passou do teto, sai só o texto da plataforma | Proprietário |
| 23/10/2026 | SARA central (I-19, J3) | Uso novo de IA registrado: **vigia da SARA central**. Uma vez por dia (de segunda a sábado, a partir das 6h30) ou quando o proprietário pede na War Room, o Claude Sonnet lê os sinais da empresa (títulos e detalhes dos avisos de cada módulo e dos Parados, colhidos com a sessão do proprietário) e devolve os gargalos, com os sinais que os provam, o impacto, a confiança e até 3 ações de contenção. Todo número é conferido com os sinais; o achado com número sem fonte é descartado. Cada achado vai como "Decisão para você" a quem decide na área (sara_responsaveis), só se a pessoa enxerga os sinais com a sessão dela, marcado como análise da IA com a confiança. Nada é gravado nas áreas e nada é decidido pela IA. Nenhum dado passa pelo Clef. Custo no teto da SARA central | Proprietário |
| 23/10/2026 | SARA central (I-19, J4) | Uso novo de IA registrado: **relatório de crescimento da SARA central**, toda segunda-feira (ou quando o proprietário pede na War Room). Duas chamadas ao Claude Sonnet: (1) **pesquisa na internet aberta** (busca do próprio Claude), com SÓ o assunto da empresa (`ASSUNTO_DA_EMPRESA`: setor e região, sem nome, CNPJ, cliente, fornecedor ou valor) — o modelo não recebe nada além disso, então nada da empresa pode sair na busca; (2) **síntese sem internet**, com o retrato da semana (consultas das SARAs com a sessão do proprietário, sem dado de colaborador), os gargalos da vigia, o relatório anterior e a pesquisa (tratada como informação, não instrução). Número dos dados conferido; link só dos resultados da busca; a conta de cada investimento (prazo de retorno, VPL, TIR, pessimista) é da plataforma. Tudo marcado como opinião da IA, com a confiança. Nenhum dado passa pelo Clef. Custo no teto da SARA central | Proprietário |
| 23/10/2026 | SARA central (I-19, Documentos) | Uso novo de IA registrado: **documentos em PDF da SARA central** (relatório interno e carta para cliente, fornecedor ou prospect). O Claude (Sonnet, a central) escreve o conteúdo a partir do que as SARAs das áreas devolveram; a plataforma confere cada número, preenche o gráfico com os dados da área e gera o PDF no servidor, sem serviço externo. O relatório marca os insights como análise da IA, com a confiança; a carta externa sai sem marca de IA, porque o proprietário aprova a prévia (decisão de 23/10). O envio é interno (plataforma) e só com o Permitir; e-mail e WhatsApp ficam para quando houver os recursos. Nenhum dado passa pelo Clef | Proprietário |
| 23/10/2026 | SARA central (I-19, voz) | Uso novo de IA registrado: **mensagem de voz para WhatsApp pela API de texto para fala do Grok** (xAI `/v1/tts`, voz "luna", pt-BR), decisão do proprietário: o TTS serve SÓ para gravar a mensagem que vai por WhatsApp; a voz da SARA na plataforma e nas futuras ligações telefônicas continua sendo o Grok Realtime. Vai à xAI o texto da mensagem (conferido número a número com o que as áreas devolveram). O áudio fica no bucket privado. O envio pelo WhatsApp depende do número dedicado (B-04). Junto, a **personalidade da SARA** (assistente britânica; o fundador verificado pela sessão é tratado como "Senhor"), que não muda o que vai a nenhum serviço | Proprietário |
