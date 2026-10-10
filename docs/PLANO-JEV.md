# Plano de uso do Jev no PecSil Business OS

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

## 5. Ordem de execução

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
