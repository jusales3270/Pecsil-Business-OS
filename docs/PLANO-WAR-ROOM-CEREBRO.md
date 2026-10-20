# War Room e o grafo do Segundo Cérebro: desenho do sistema

**Status:** W1–W4 decididas pelo proprietário em 19/10/2026. G1 aplicada em produção em 19/10 (5.022 nós, 5.749 ligações); a tarefa do Coolify foi criada desligada e liga depois do deploy. G2 (módulo War Room) construída; migração das visões aplicada em 19/10; teste no navegador 15/16 + 5/5 (visões e registros).
**Origem:** pedido do proprietário em 19/10/2026, com a referência visual de um *graph view*.

> "Sistema de grafos com índices e com as funções de isolar por termos, funções e demais ligações
> […] a SARA principal poderá chamar determinadas informações mostrando somente os grafos que têm
> ligações […] um organismo interconectado, em que uma ramificação leva a outra, mostrando que
> certas coisas dependem diretamente de outras […] teremos mais um módulo (war room), em que esse
> segundo cérebro será um dos submenus."

Relação com o que já existe:
- É a camada de ligações que o [PLANO-SEGUNDO-CEREBRO](PLANO-SEGUNDO-CEREBRO.md) previu. Ele
  definiu que os arquivos entram uma vez no banco e que o cérebro é derivado, reconstruível e mora
  no próprio Postgres, sem banco de grafo separado. O que muda é o alcance: agora entram também os
  **dados dos módulos**, e não só os documentos.
- A SARA principal (a *mindmaster*, com o conselho) é a que vai **mostrar** os subgrafos. Ela tem
  plano próprio, ainda não escrito (PLANO-SARA, S6 e a seção das duas camadas).

---

## 1. Princípios

1. **Nasce dos dados que já existem.** Fornecedor, cliente, material, compra, cotação, título, OS
   e documento já se ligam pelo cadastro: as 370 compras e as 235 cotações apontam para o
   fornecedor, os 16.729 títulos para o fornecedor ou o cliente, e as 38 OS e os 3.902 produtos
   para o cliente. O cérebro só torna essas ligações visíveis e navegáveis.
2. **Ligação por regra primeiro.** Toda ligação diz de onde veio: regra, pessoa ou modelo. Uma
   ligação sugerida por modelo nasce como **proposta** e só vale depois que uma pessoa confirma,
   como manda o Plano do Jev.
3. **Derivado e reconstruível.** O grafo é montado a partir das tabelas dos módulos. Pode ser
   apagado e refeito a qualquer hora, sem perder nada. A verdade continua nos módulos.
4. **A mesma permissão das telas.** Cada pessoa só vê os nós que a credencial dela permite ver na
   plataforma. Ligação entre um nó visível e um nó invisível não aparece. A SARA principal mostra
   o grafo com as permissões de quem conversa com ela.
5. **Cada nó leva ao registro.** Clicar num nó mostra a ficha e abre a tela do registro de origem.
6. **Sem dado sensível.** CPF, PIS, salário, dado de saúde, biometria, XML e segredos nunca viram
   nó nem atributo. Colaborador só aparece para quem tem a permissão do RH.
   - O financeiro antigo lança a folha **pessoa por pessoa**, com o colaborador cadastrado como
     "fornecedor". São salário, adiantamento, 13º, férias, rescisão e pensão alimentícia, para cerca
     de 85 pessoas.
   - Do mesmo jeito estão a remuneração dos sócios (retirada e pró-labore) e a comissão de vendas.
   - Por isso, todos os títulos dessas contas ficam fora do grafo, por regra (`cerebro_contas_pessoais`):
     os ramos "Gastos com funcionários" (Adm, Usinagem e Fundição) com todas as subcontas, retirada e
     aporte de sócios, pró-labore e o IR dele, comissão de vendas e a tarifa da folha. São 97 contas.
7. **Nada sai da empresa.** O grafo é montado e consultado no servidor da PecSil. A busca pelo
   sentido usa o modelo local que já roda na busca de documentos.

---

## 2. O modelo do grafo

### 2.1 Dois níveis

Um grafo com cada lançamento como nó passaria de 30 mil pontos e viraria um borrão. Por isso o
grafo tem **dois níveis**:

| Nível | O que é | Exemplos | Aparece |
|---|---|---|---|
| **Entidades** | O que tem nome e dura: cadastros, conceitos e estruturas | fornecedor, cliente, material, produto, conta do plano, setor, pessoa, equipamento de TI, sistema, processo, documento | Sempre: é o "organismo" |
| **Fatos** | O que acontece: os registros de cada dia | compra, cotação, título, OS, nota, chamado, queda | Somados dentro das ligações (quantidade, total, primeira e última data); viram nós quando a pessoa **expande** uma ligação |

Exemplo real do banco: entre o fornecedor COMIL e o item "Resina COMIL F.U Set CCS 10 Parte I"
existe **uma** ligação "vendeu". Ela guarda 3 compras, R$ 11.573,10, o último preço (R$ 18,37) e
a última compra (18/08/2026). Ao expandir, aparecem as 3 compras como nós, cada uma levando à OC
no Compras.

O mesmo item aparece também como "… TB 210 KG - 210 kg", em mais 1 compra de R$ 3.857,70. Por
isso a normalização dos nomes de item faz parte da etapa G1: espaços, caixa e unidade repetida.
Quando dois nomes forem só parecidos, a fusão é **proposta** e alguém do Compras confirma.

### 2.2 Tipos de nó (primeira versão)

| Tipo | Origem | Volume hoje | Quem vê |
|---|---|---|---|
| Fornecedor | `suppliers` | 760 (678 com títulos) | Compras, Financeiro a pagar, Cadastros |
| Cliente | `customers` | 38 | Comercial, Financeiro a receber, Cadastros |
| Item comprado | nome do produto nas compras e cotações, normalizado | 327 | Compras |
| Material | `materials` (só os que têm ligação) | 8.315 ativos no catálogo | Almoxarifado, Compras |
| Produto (peça) | `products` | 3.902 | Comercial, Produção |
| Conta do plano | `finance_chart_accounts` | 318 | Financeiro |
| Setor | os módulos | 10 | Todos |
| Pessoa (usuário) | `profiles`, só nome e papel | 14 ativas | War Room |
| Documento | `company_documents` | 10 | Permissão do setor do documento |
| Equipamento e sistema de TI | `ti_ativos` e os sistemas (Business OS, Forja, GRV) | começa agora | TI |
| Processo | as cadeias de [PROCESSOS-PECSIL](PROCESSOS-PECSIL.md) e, depois, as rotinas do modo entrevista | 3 cadeias | War Room |

O "item comprado" é uma ponte. Quando alguém liga o histórico ao catálogo de materiais (a
ferramenta "Ligar histórico", do A-01), ele se funde ao material, e as ligações passam para o
material.

### 2.3 Tipos de ligação

Cada ligação tem um **sentido**, que vira a seta no desenho, e uma **família**:

| Família | Ligações | Para que serve |
|---|---|---|
| Transação (somada) | fornecedor —vendeu→ item · fornecedor —cotou→ item · cliente —encomendou→ produto · fornecedor —recebeu→ conta do plano · cliente —pagou→ (atributos) | "Quem me vende o quê, a que preço, desde quando" |
| Dependência | item —abastece→ setor (Fundição, Usinagem) · sistema —sustenta→ setor · equipamento —sustenta→ sistema · setor —depende_de→ setor (as cadeias) · produto —depende_de→ material (quando houver estrutura) | "O que para se isto parar": a leitura de cima para baixo e de baixo para cima |
| Responsabilidade | pessoa —decide→ setor ou decisão (o quadro "Quem decide o quê") · pessoa —aprova→ alçada | "Quem resolve" |
| Menção | documento —cita→ fornecedor, nota, OC, OS, cliente (as ligações de documentos que já existem) | "Onde está o papel" |
| Estrutura | conta —pertence_a→ conta pai · material —pertence_a→ grupo | Hierarquias |

Exemplos da cadeia de dependência que o desenho mostra:
- servidor → Business OS e Forja → Produção, Compras, Financeiro… Se o servidor cai, tudo isso cai
  junto; quem vê é a TI.
- fornecedor único → item → setor: o ferro-molibdênio, por exemplo, só foi comprado de um
  fornecedor desde julho (4 compras). O desenho deixa à vista quando um setor depende de um
  fornecedor só.

### 2.4 Atributos e procedência

- **Nó:** tipo, nome, termos (palavras-chave e funções: "matéria-prima", "fundição", "crítico"),
  setor, números-resumo (total comprado, quantidade de ligações), quem pode ver, de onde veio
  (tabela e id) e a tela que abre.
- **Ligação:** tipo, família, sentido, peso (quantidade ou valor), primeira e última data,
  números-resumo, procedência (regra, pessoa ou modelo), confiança, situação (valendo ou proposta)
  e até 50 ids dos registros de origem, para expandir.

---

## 3. Como fica no banco

**Tabelas:**
- `cerebro_nos`: o nó. Chave natural `(organizacao, tipo, origem_tabela, origem_id)`, para refazer
  sem duplicar.
- `cerebro_ligacoes`: origem, destino, tipo e família, com os atributos acima. Chave natural
  `(origem, destino, tipo)`.
- `cerebro_visoes`: visões salvas ("dependências da Fundição", "fornecedores únicos"), com filtros,
  posição e zoom.
- `cerebro_execucoes`: cada montagem, com o que mudou, para auditoria.

**Índices:**

| Para | Índice |
|---|---|
| Buscar por termo (com e sem acento, parcial) | trigramas (`pg_trgm`) e texto (`portugues_sem_acento`) no nome e nos termos, a mesma base da busca de documentos |
| Isolar por tipo, setor e função | `(organizacao, tipo)`, `(organizacao, setor)` e GIN nos termos |
| Andar no grafo nos dois sentidos | `(origem, tipo)` e `(destino, tipo)` nas ligações |
| Período | primeira e última data da ligação |
| Pelo sentido ("fornecedores parecidos com…") | vetor (`vector` e HNSW) do resumo do nó, com o modelo local; fica para a etapa G5 |

**Funções** (todas com a sessão de quem pergunta, como as consultas da SARA):

| Função | Responde |
|---|---|
| `cerebro_buscar(termo, tipos)` | Os nós que casam com o termo |
| `cerebro_vizinhanca(no, profundidade 1–3, filtros)` | O nó e as ligações até N passos, isolando por tipo de nó, tipo de ligação, termo, setor e período |
| `cerebro_caminho(a, b)` | O caminho mais curto entre dois nós ("como a COMIL chega na OS 123?") |
| `cerebro_dependencias(no, montante \| jusante)` | Do que este nó depende, e o que depende dele, só nas ligações de dependência |
| `cerebro_visao(filtros)` | O grafo de visão geral (só as entidades), já com a posição de cada nó |

**Montagem:**
- Uma função por domínio (`cerebro_montar_compras`, `_financeiro`, `_clientes`, `_documentos`,
  `_ti`, `_processos`) grava os nós e as ligações sem duplicar.
- Uma tarefa agendada roda a cada 10 minutos, só com o que mudou desde a última vez.
- "Refazer tudo" é um botão. Com os volumes de hoje, a montagem completa deve levar segundos; isso é medido na etapa G1.

**Posição dos nós:** calculada no servidor, a cada montagem (ForceAtlas2, o mesmo algoritmo do
desenho de referência). Com isso o grafo abre já arrumado e não "dança" toda vez que alguém entra.

---

## 4. O módulo War Room

Módulo novo, **War Room**. O Segundo Cérebro é um dos submenus, e entram outros depois:

| Submenu | O que é | Quando |
|---|---|---|
| **Segundo Cérebro** | O grafo inteiro, interativo | Etapa G2 |
| Conselho | A SARA principal com o conselho de agentes (CFO, operações, técnico, comercial), conversando com o proprietário, o Ricardo, o Domingo e os demais credenciados | Com o plano da SARA principal |
| Visões salvas | Os grafos guardados para a reunião ("dependências da Fundição", "fornecedor único") | Etapa G2 |

**A tela do Segundo Cérebro**, que segue a referência:
- **Centro:** o grafo, desenhado por WebGL para aguentar milhares de nós. Cor por grupo (tipo ou
  setor, como os "grupos" da referência), tamanho pelo número de ligações ou pelo valor, setas no
  sentido da dependência e um botão "Animar".
- **Esquerda, filtros:**
  - busca por termo;
  - grupos e cores;
  - tipos de nó e de ligação;
  - setor, período e profundidade;
  - "só dependências";
  - forças do desenho (centro, repulsão, ligação, distância), como na referência.
- **Direita, ficha do nó escolhido:** os números, as ligações agrupadas por tipo, os documentos e o
  botão para abrir o registro na tela dele.
- **Ações:**
  - **isolar**: mostrar só este nó e as ligações dele;
  - **caminho entre dois nós**;
  - **o que depende disto** e **do que isto depende**;
  - **expandir** uma ligação somada nos registros;
  - **salvar a visão**.
- **No celular:** uma lista navegável (nó → ligações → nó), porque o desenho não cabe numa tela de
  400 px.

**Biblioteca do desenho** (escolha técnica): começou com **sigma.js** e **graphology** (2D). Desde 19/10/2026
usa **3d-force-graph** com **three.js** (3D), em versões exatas travadas. A troca e o motivo estão na seção 11.

---

## 5. A SARA mostrando o grafo

- **Ferramenta nova, `mostrar_grafo`:** a SARA escolhe a função (vizinhança, caminho ou
  dependências) e os filtros. A plataforma roda a função com as permissões de quem conversa e
  desenha **só o subgrafo** na conversa, com o mesmo componente da tela. É o mesmo princípio do
  `mostrar` de hoje: o modelo aponta e a plataforma preenche, então nenhum nó é inventado.
- A SARA principal usa isso na war room ("Mostre do que a Fundição depende"). As SARAs dos módulos
  ganham as fichas como consulta ("quem me vende resina e a que preço?") a partir da etapa G3.

---

## 6. Etapas

| Etapa | Entrega | Depende de |
|---|---|---|
| **G1** | Tabelas, índices, funções e permissões; montagem de Compras, Financeiro e Clientes (fornecedor, cliente, item comprado, material, conta do plano, setor). Teste com os números reais do banco | OK deste plano (W1–W4) |
| **G2** | Módulo War Room com o Segundo Cérebro (grafo, filtros, isolar, ficha, caminho, dependências, visões salvas) | G1 |
| **G3** | Fichas na tela do fornecedor, do cliente e do material, e as consultas da SARA (ficha e histórico de preço) | G1 |
| **G4** | Mais domínios: documentos, TI (equipamento → sistema → setor), pessoas e decisões ("Quem decide o quê"), processos (as cadeias), Produção (OS e peças) | G1 |
| **G5** | Busca pelo sentido nos nós e ligações **propostas** pelo modelo, que uma pessoa confirma | G4; uso de IA registrado no Plano do Jev |
| **G6** | `mostrar_grafo` na SARA principal (war room) | G2; plano da SARA principal |
| **G7** | As rotinas do modo entrevista entram como nós de processo | Modo entrevista |

---

## 7. Lacunas dos dados

O grafo mostra as lacunas também: ligação que deveria existir e não existe é informação.

- **Prazo de entrega:** não dá para medir ainda. Só 1 das 235 cotações tem prazo de entrega (o
  campo "prazo" é a condição de pagamento), e nenhum recebimento foi lançado no Almoxarifado. A
  ligação "prometido × entregue" começa quando o recebimento entrar em uso.
- **Material:** nenhuma das 370 compras está ligada ao catálogo, e são 327 nomes digitados. Até
  alguém usar "Ligar histórico", o grafo trabalha com o item comprado.
- **Detalhe das compras:** só desde 10/07/2026. Antes disso, o que existe é o total pago por
  fornecedor, que vem dos títulos desde 2002.
- **Centros de custo:** a tabela está vazia (0). Por enquanto, a ligação "para onde vai o gasto"
  usa a conta do plano.

---

## 8. Decisões do proprietário (19/10/2026)

| # | Decisão | O que ficou |
|---|---|---|
| **W1** | Quem entra no War Room | **Por enquanto, só o proprietário.** A funcionalidade `warroom.cerebro` existe em Pessoas e Acessos, mas ninguém recebe. Quem mais entra fica para depois |
| **W2** | O que cada um vê dentro do grafo | **Quem tem o War Room vê tudo**, e por isso o acesso é restrito. Vale o RLS: `has_feature('warroom.cerebro')` |
| **W3** | Lançamento vira nó? | **Somado dentro da ligação, com expansão** |
| **W4** | Valores (R$) no grafo | **Aparecem para quem tem o War Room** |

A W2 vale para o War Room. As fichas nas telas dos módulos (G3) seguem a permissão de cada módulo,
pela coluna `exige` dos nós.

## 9. G1 construída (19/10/2026)

Migração `202610190002_cerebro_grafo.sql` e tarefa `scripts/cerebro-cron.mjs`, a cada 10 minutos.

Testada num Postgres descartável com a estrutura e os dados de origem da produção:

| Item | Resultado |
|---|---|
| Nós | **5.022**: 3.898 peças, 570 fornecedores, 359 itens, 155 contas, 38 clientes, 2 setores |
| Ligações | **5.749**: 3.898 peça do cliente, 822 lançado em, 359 abastece, 325 vendeu, 198 cotou, 147 pertence a |
| Montagem | 5 s na primeira vez; 0,6 a 2,5 s nas seguintes, só com a diferença; repetir sem mudança não altera nada |
| Histórico pago | Os 9.490 títulos arquivados ("Pago antes de 2026") **entram**: é o histórico do sistema antigo, desde 2002 |
| Pagamento a pessoa | 97 contas fora; nenhuma ligação nem nó aponta para elas |
| Permissão | Sem o War Room, a pessoa vê 0 nós, e os registros de origem e o "refazer" são recusados |
| Consultas | A busca "fundicao" acha o setor e as contas de matéria-prima da fundição; o caminho COMIL → Fundição sai em 2 passos; 71 itens abastecem a Fundição; a ligação COMIL → resina expande nas 4 compras, já com os dois nomes do item juntos |
| Visão geral | Inteira: 5.011 nós, 3,9 MB, 0,9 s. Sem as peças: 1.113 nós, 0,25 s. **A tela do G2 abre sem as peças e as carrega quando pedidas** |

## 10. G2 construída (19/10/2026)

O módulo **War Room** (`modules/warroom`) tem o submenu **Segundo Cérebro**:
- o desenho é feito por sigma.js 3.0.3 e graphology 0.26.0, em WebGL;
- o ForceAtlas2 0.10.1 roda num worker do navegador;
- a rota é `/api/warroom/cerebro`;
- as visões salvas usam a migração `202610190003_cerebro_visoes.sql`, que também traduz os registros (quantidade sem zeros decimais, situação em português).

**Mudança do desenho:** a posição dos nós é calculada **no navegador**, e não no servidor como a seção 3 previa. As forças (centro, repulsão, ligação) e o "Animar" mexem no desenho ao vivo, então o cálculo precisa estar ali. A posição inicial é estável (a mesma para o mesmo nó), e o grafo se arruma em poucos segundos quando abre.

**Teste no navegador, com usuários temporários e permissões reais (15/16):**
- quem não tem o War Room não vê o módulo, e a API recusa;
- abre com a legenda e as contagens (570 fornecedores, 359 itens) e mostra a hora da última montagem;
- a ficha da COMIL traz os números e as ligações agrupadas;
- a ligação COMIL → resina expande em 5 compras com valor;
- isolar a COMIL dá 17 pontos;
- o caminho COMIL → Fundição dá 3 pontos;
- do que a Fundição depende dá 71 pontos;
- carregar as peças leva o grafo a 3.898 peças;
- nenhum erro de JavaScript e nenhuma rolagem lateral, no claro, no escuro e no celular (onde a tela vira lista).

A falha que sobrou foi da verificação, e não da tela: a categoria do fornecedor vem em maiúsculas do próprio cadastro.

**Corrigido no teste:**
- as ligações quase sumiam no tema claro;
- a câmera não enquadrava os vizinhos do ponto escolhido;
- os valores da ficha apareciam em caixa alta e o campo de período ficava desalinhado (regras gerais da plataforma);
- a quantidade "210.000 kg" e a situação "settled" nos registros;
- a hora da última montagem sumia quando faltava a tabela das visões.

---

## 11. Redesenho em 3D, G3 e G4 aplicadas (19/10/2026)

**Por que o redesenho.** O proprietário reprovou o desenho 2D: o painel lateral ficava sempre aberto, o grafo
"pulava" e era sensível demais ao toque, as ligações só apareciam ao clicar, e o visual lembrava o Windows XP.
O pedido foi um desenho de fato 3D, com as ligações pulsando como caminhos neurais e um "pulso magnético" a cada
informação nova ou consulta dos subagentes.

**Como ficou** (`modules/warroom/src/Cena3D.tsx` e `Cerebro.tsx`, estilos "neuro" em `patterns.css`):
- **Biblioteca:** 3d-force-graph 1.80.0, three 0.185.1 e d3-force-3d 3.0.6. Saíram o sigma, o graphology e o ForceAtlas2.
- **Tela:** a cena ocupa tudo. Filtros e visões abrem pelos botões da barra do topo, e a ficha flutua à direita.
  Há tela cheia, e no celular a tela continua sendo lista.
- **Desenho:**
  - **Ligações:** brilham e somam luz onde se cruzam. Com muitas linhas chegando ao mesmo ponto, a intensidade cai para não estourar em branco.
  - **Pontos:** os apagados ficam translúcidos.
  - **Nomes:** em HTML, poucos de cada vez, sem sobreposição.
- **Estabilidade:** o arranjo é calculado antes de aparecer e não se mexe depois. Os pontos não se arrastam e a câmera é amortecida.
  A seleção vence o mouse: passar o mouse só mostra o nome. A câmera centraliza na área que o painel deixa livre.
- **Segurar e arrastar** (pedido do proprietário, 19/10): o núcleo arrastado e os vizinhos diretos vêm junto e esticam as
  ligações; o resto fica congelado e, ao soltar, todos voltam ao lugar em meio segundo. Um "toque" que a biblioteca simula ao
  soltar derrubava o controle da câmera do three 0.185; esse evento simulado é barrado.
- **Pulso magnético:** `cerebro_pulsos(desde)` junta os eventos dos módulos, as consultas das SARAs (as ferramentas
  usadas) e as ligações novas ou alteradas. A tela consulta a cada 15 s. Cada pulso solta anéis de luz no setor e
  impulsos nas ligações, e aparece no painel de pulsos.

**Migração `202610190004_cerebro_g3_g4.sql`, APLICADA em 19/10/2026.**
- **G4:**
  - setores, sistemas (Business OS, Forja, GRV) e o servidor;
  - pessoas com aprova/opera, tiradas das permissões reais;
  - a Cadeia 1;
  - documentos;
  - cliente → peça encomendada (OS).
  - Montagem em 0,5 s: 5.061 nós e 5.841 ligações. Entraram as 14 pessoas reais, e nenhuma de teste nem das SARAs.
- **G3:**
  - `cerebro_ficha`, que filtra por área;
  - `cerebro_ficha_buscar` e `cerebro_historico_preco`;
  - o componente `FichaDoCerebro` em Cadastros, Comercial › Clientes, Compras › Fornecedores (aba "Histórico completo") e Almoxarifado › Materiais;
  - as consultas `ficha_fornecedor` e `historico_de_preco` (SARA do Compras) e `ficha_cliente` (SARA do Comercial).
- O limite da vizinhança subiu para 6 mil pontos, para caber as peças de um cliente grande.

**Teste no navegador** (usuários temporários com as permissões reais, todos apagados no fim):
- **Permissões por área:**
  - Compras vê o comprado da COMIL e não vê o pago à GROB;
  - Financeiro vê os R$ 9.258.760,35 pagos à GROB e não vê o preço de compra;
  - RH não vê ficha nenhuma.
- **Fichas nas telas:** aparecem no Compras, no Cadastros e no Comercial.
- **SARA do Compras:** usou `ficha_fornecedor` e `historico_de_preco`.
- **Pulso:** um evento de teste do Compras acendeu o setor e entrou no painel de pulsos.
- **Resultado:** 12/12, sem erro de JavaScript. `npm test` 455/455, com build.

