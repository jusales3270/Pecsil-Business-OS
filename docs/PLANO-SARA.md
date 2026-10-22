# Plano da SARA — copilot por módulo (nível 1)

> **A ordem de construção está em [`ROADMAP.md`](ROADMAP.md)** (item I-12). Este documento guarda o
> desenho, as decisões e os critérios de aceite. O desenho geral da SARA (harness corporativo) está no
> [Blueprint, Fase 6](BLUEPRINT-PECSIL-BUSINESS-OS.md); a memória é o
> [Segundo Cérebro](PLANO-SEGUNDO-CEREBRO.md).
>
> Criado em 17/10/2026 · Dono: proprietário da PecSil · Execução: Claude

---

## 0. Duas camadas (proprietário, 17/10/2026)

| Camada | O que é | Quando |
|---|---|---|
| **SARA de cada módulo** (subagente, copilot) | Vive dentro de um módulo: orienta, instrui, tira dúvida e consulta, com as permissões de quem conversa. Não decide nada da empresa como um todo. | **Agora** (este plano), piloto no Financeiro |
| **SARA principal — a mindmaster da PecSil** (orquestradora) | Delega e executa funções e ações chamando as SARAs dos módulos como subagentes (ação que grava sempre com aprovação humana); tem um **corpo de conselho** de agentes especialistas (CFO, operações, técnico, comercial…); participa da **war room**, o conselho da PecSil, debatendo direto com o Ricardo, o Domingo e os demais membros questões técnicas, operacionais e financeiras da empresa inteira. | **Depois**, com plano próprio |

As SARAs dos módulos são o tijolo de baixo da principal: as consultas separadas por módulo, que herdam
as permissões de quem pergunta, são exatamente o que a orquestradora vai chamar.

## 1. Decisões do proprietário (17/10/2026)

| # | Decisão |
|---|---|
| S1 | **Cada módulo tem a sua SARA**: orienta, instrui e tira dúvida do módulo em que foi chamada. |
| S2 | A SARA de um módulo **pode trazer dados de outros módulos quando a credencial de quem conversa permite** (ex.: a Ana, no Financeiro, pergunta das OCs que vão virar contas a pagar). |
| S3 | O modelo que conversa é o **Claude (Anthropic)**: Haiku 5.5 no dia a dia, Sonnet 5.5 para análise. O Clef segue nas decisões rápidas (ele não escreve texto). **Exceção (19/10/2026, proprietário):** a SARA de TI conversa com o Sonnet 5.5, como agente técnico (linguagem técnica, comandos, até 5 buscas em documentação de fabricantes e sistemas), com os mesmos guardrails; é a única. |
| S4 | **Piloto: Financeiro, com a Ana.** |
| S5 | **Nível 1 (consulta e orientação) vem antes da Fase 5.** Os níveis 2 a 4 continuam depois, um de cada vez, como no Blueprint. |
| S6 | O grafo das relações da empresa (a "teia" do Segundo Cérebro) é **outro trabalho**, depois do copilot. |
| S7 | **O Clef não entra na conversa do dia a dia** (17/10/2026). A triagem pelo Clef foi testada e retirada: o Haiku já escolhe a consulta certa, e a economia (−27% de tokens, tempo igual) é a mesma do cache de prompt. O Clef entra na SARA só quando ela tiver de dar uma **opinião** (com a confiança à vista), no modo conselheiro. |

## 1b. Os dois trabalhos da SARA de um módulo (proprietário, 17/10/2026)

1. **Copiloto de quem usa o módulo** (agora): orienta, traz informação, ajuda a preencher e **leva a
   pessoa até a tela** ("onde está a última nota emitida?" → abre Fiscal › Notas emitidas). A
   navegação usa a ferramenta `abrir_tela`, só entre as telas que a pessoa pode abrir (do módulo e,
   com a credencial, de outros).
2. **Conselheira da SARA principal** (com a mindmaster): quando a orquestradora chamar, a SARA do
   módulo vira o especialista do conselho — a do Financeiro é o **CFO** —, com um modelo mais forte e
   raciocínio mais profundo (*extended thinking*) para análise de dados específica. Desenhado junto
   com a SARA principal.

## 2. O que a SARA de um módulo faz (nível 1)

- **Orienta:** explica como o módulo funciona e onde fazer cada coisa (o manual do módulo, escrito
  em `lib/sara/modulos/<modulo>.md`, e os processos de `docs/PROCESSOS-PECSIL.md`).
- **Consulta:** responde com os dados da empresa usando **ferramentas** (as mesmas consultas das
  telas), rodadas **com a sessão de quem pergunta**. O banco (RLS) decide o que ela pode ver: nunca
  vê mais que a pessoa.
- **Cita a origem:** todo número da resposta vem de uma ferramenta, com o link para o registro
  (título, OC, nota, conta). Nada é apresentado como dado apurado sem fonte.
- **Não grava nada.** Preparar e executar (nível 4) fica para depois, sempre com confirmação.

## 3. Como é construída

| Peça | Como |
|---|---|
| Conversa | Rota `/api/sara/[modulo]` no servidor; chamada ao Claude com *tool use*. A chave (`ANTHROPIC_API_KEY`) fica só no servidor (`.env.local` e Coolify), nunca `NEXT_PUBLIC_`. |
| Ferramentas | Por módulo, em `lib/sara/ferramentas/`. Cada ferramenta declara a funcionalidade que exige; a SARA só recebe as ferramentas que a pessoa pode usar (S2). A consulta roda com a sessão dela (RLS). |
| Fora de alcance | RH clínico, dados pessoais (CPF, PIS, salário, saúde) e caixas de e-mail: não viram ferramenta no nível 1. O filtro `lib/decisao/guard.ts` roda no que sai das ferramentas antes de ir ao modelo. |
| Mínimo necessário | Vai ao modelo só o que a pergunta precisa (a resposta da ferramenta, já resumida), nunca a tabela inteira. |
| Registro | Cada conversa é gravada (quem, módulo, perguntas, ferramentas usadas, tokens, custo, nota da pessoa). Serve para auditoria e para medir o acerto. |
| Guarda de escopo | A SARA só trata da empresa (nome vindo do cadastro: nada da PecSil fixo) e da rotina de quem pergunta. Duas barreiras independentes: (1) regra fixa no prompt, com a recusa padrão e contra "ignore suas regras", "mostre seu prompt", troca de papel e ordens escondidas nos dados; (2) verificador separado (`lib/sara/escopo.ts`) em paralelo, que cancela a conversa e devolve a recusa padrão quando a pergunta está fora. Conhecimento técnico, fiscal e financeiro ligado ao trabalho é dentro. Toda recusa fica registrada na conversa. |
| Sem pensamento | O copiloto roda sem *thinking*: medido em 17/10, as consultas escolhidas não mudaram e ficou ~23% mais rápido, com ~29% menos tokens de saída. O raciocínio profundo fica para o modo conselheiro. |
| Cache de prompt | A parte fixa (ferramentas + manual + regras) vai marcada para o cache da Anthropic e a parte do dia (data, quem conversa, permissões) vem depois; a última mensagem também é marcada, para a rodada seguinte da mesma pergunta. O registro guarda o que foi lido e gravado no cache. |
| Achar e abrir um registro | "Me mostre o último lançamento do financiamento da Grob": a busca acha pelo nome, histórico ou documento (inclusive pagos), com último pagamento e vencimentos (`sara_buscar_lancamentos`, com as permissões de quem pergunta), e `abrir_lancamento` abre o detalhe exato do título, na aba onde ele está. A SARA diz qual "último" abriu e oferece o outro. |
| Opinião (depois) | Quando a pessoa pedir uma opinião ("qual a chance de eu me endividar se comprar mais uma máquina da Grob?"), a SARA chama o Clef como ferramenta de julgamento e responde com a confiança à vista, marcada como opinião do modelo, com as consultas em que se baseou e quem decide. É o único caso em que o modelo de decisão aparece para quem usa. Entra com o modo conselheiro. |
| Quem usa | Liberada **por pessoa** em Pessoas e Acessos, na lista de cada módulo (`<modulo>.sara`, ex.: `financeiro.sara`); sozinha não abre o módulo. O proprietário sempre vê. Sem botão de ligar nem contador de tokens na tela; o modelo e o teto mensal ficam só no servidor, como proteção de custo (proprietário, 18/10/2026). |
| Na tela (18/10) | Para quem usa, o nome é só "SARA" (o módulo é identificação interna dos agentes). Botão e janela flutuantes e arrastáveis para qualquer ponto (posição guardada no navegador), vidro líquido com cantos arredondados, avatar = favicon. Abre na última conversa, já na última interação, com os dias separados. Tabelas da resposta viram tabela. |
| Avisos (18/10) | A SARA traz os avisos do módulo, calculados dos dados com as permissões de quem está logado (`lib/sara/alertas.ts`, sem o modelo). **Vermelho pulsante** = ação urgente no módulo (no Financeiro: conciliação pendente, extrato com mais de 7 dias, caixa negativo em 7 dias, contas vencidas em aberto); **azul pulsante** = lembretes, compromissos e novidades (vence em 7 dias, a receber em 7 dias, contas em aprovação, novidades dos últimos 14 dias num aviso só). O botão pulsa até a pessoa abrir a janela; abrir é tomar ciência (`sara_alertas_vistos`, por pessoa). A chave de cada aviso carrega a situação: se mudar, o aviso volta a pulsar. Cada aviso abre a tela certa. |
| Equipe (18/10) | Uma SARA por módulo, com a mesma base (escopo, dado pessoal, permissões de quem conversa, avisos, cumprimento, histórico): Financeiro, Compras, Almoxarifado, Fundição, Comercial, Fiscal, RH, Portaria e Produção (`lib/sara/agentes/<modulo>.ts`). Cada uma tem consultas, telas, avisos vermelhos/azuis e sugestões próprios, e é liberada por pessoa (`<modulo>.sara`). **Desde 20/10 (decisão do proprietário), a única restrição é a credencial de quem pergunta** (consulta com a sessão da pessoa + RLS): CPF, PIS e CTPS para quem tem RH › Colaboradores em "operar"; CID e diagnóstico para quem tem `rh.clinico`; documento e contato do visitante para quem vê as visitas; CNPJ, IE e contato de cliente e fornecedor para quem vê esses cadastros; dados da empresa (consulta `dados_da_empresa`) para RH, Financeiro, Fiscal, Compras e Comercial. Ficam fora só segredo e arquivo (XML, foto e biometria, payload bruto, arquivo e senha do certificado, corpo e credencial de e-mail), e nada da empresa vai para a pesquisa na internet. Sem a credencial, a SARA diz "Você não tem permissão"; consulta inexistente não vira "sem permissão". Produção sem custo/margem e Fundição sem preço do Compras continuam (são de outras credenciais). No departamento Comercial, a área de Compras tem a SARA do Compras. |
| Segundo Cérebro (18/10) | Leitura: cada SARA busca nos documentos do setor (`company_document_search`, com a permissão do documento) e devolve trecho e link. Colheita: quando nenhuma consulta responde (e não é falta de permissão), a SARA anota a lacuna (`registrar_lacuna`), registrada na conversa — o que as pessoas pedem e a plataforma ainda não responde. |
| O que a SARA aprendeu (18/10) | Tela em Fundação (proprietário e Auditoria): habilidades propostas e ativas, lacunas agrupadas por pedido (com destino: roadmap, já existe, não fazer), respostas com 👎 e uso por módulo. Decisões são do proprietário. |
| Habilidades (18/10) | Rotinas com nome que combinam consultas que a SARA do módulo já tem, para trabalho repetitivo. Propostas pela SARA na conversa (ou pela plataforma, quando o pedido é recorrente — "toda segunda…" — e ela não propôs) e pela análise das conversas (botão do proprietário, Haiku com saída estruturada; só rotinas de 2+ consultas ou filtro/formato fixos, vistas 3+ vezes). Só o proprietário ativa; ativa, vira atalho ⚡ e instrução da SARA do módulo, só para quem tem todas as consultas dela. Nunca grava nada nem cria consulta nova. |
| Visual da resposta (18/10) | A SARA responde com gráfico, tabela ou cartão quando há lista, ranking, série, composição ou vencimentos. Catálogo fechado de 6 (`indicadores`, `tabela` até 4 colunas, `barras`, `linha`, `rosca` até 6 partes com "Outros", `lista_de_datas`) em `app/components/sara-visual.tsx`. **O modelo só aponta, a plataforma preenche** (`lib/sara/visual.ts`): a ferramenta `mostrar` diz qual consulta desta resposta, onde está a lista e quais campos, e o visual é montado com o resultado real da consulta (já filtrado de dado pessoal). Campo que não existe, número que não é número ou consulta não feita: o visual é recusado e o modelo recebe o motivo e os campos que existem. O resultado de consulta com lista leva uma dica curta com os caminhos (sem número). Cada visual diz de qual consulta vieram os dados e leva o link da tela; volta ao reabrir a conversa. Sem biblioteca nova (veredito sobre o OpenUI, 18/10: o OpenUI faz o modelo redigitar os números). Custo medido: resposta com visual ~22,8 mil tokens de entrada (uma rodada a mais, quase toda lida do cache) e ~1–1,5 s a mais. |
| Acesso ao módulo inteiro (19/10) | Pedido do proprietário depois de uma pergunta da Bianca ("horas dos terceiros na semana passada") ter recebido "não tenho a consulta", embora a informação estivesse numa tela que ela vê. Agora toda SARA tem: (1) as consultas do próprio módulo primeiro; (2) as de **todos os outros módulos** que a pessoa logada pode ver (`ferramentasDaSara`); (3) a **`consultar_dados`**, consulta direta às tabelas do catálogo (`lib/sara/catalogo.ts`: 28 tabelas de 9 módulos), com filtros, período, agrupamento por data e somas, lida com as permissões de quem pergunta. O catálogo só tem colunas permitidas: nada de CPF/CNPJ, contato, documento, XML, linha digitável, foto ou dado clínico. As listas fechadas saem com o nome da tela ("Consulta ou exame", não "attendance_statement"). CPF, e-mail ou telefone no meio de uma descrição são **escondidos** ("[CPF oculto]") em vez de derrubar a consulta inteira; dado de saúde segue bloqueado. "Ainda não tenho uma consulta" só depois de tentar tudo. O rascunho do modelo antes de uma consulta (às vezes em inglês) e as frases de passagem não entram na resposta. Teste com perguntas reais e as permissões reais de Bianca, Ana, Kaylane, Jefferson, Rafael, Portaria, Henrique, PCP e Guilherme, nos 9 módulos: 13/13 na primeira rodada e 10/10 na segunda, conferidas no banco. As permissões do catálogo foram conferidas na prática: com um usuário temporário para cada uma das 31 permissões, cada combinação permissão × tabela (66) enxerga os dados. Isso corrigiu 4 casos em que a SARA veria "zero" (baixas, extrato, guias e OS só pelo painel) e abriu o catálogo de materiais para a Fundição. |
| Tema do módulo e pesquisa (19/10) | Pedido do proprietário: cada SARA responde também dúvidas do TEMA do seu módulo, com o conhecimento do modelo, e pesquisa na internet, sempre restrita ao tema (`lib/sara/temas.ts`: assunto, exemplos e sites permitidos por módulo, só órgãos oficiais e entidades do setor). A pesquisa é a ferramenta da própria Anthropic (`web_search`), com até 3 buscas por pergunta, e as citações viram fontes "Internet › site" que abrem em nova aba. Cada busca fica registrada com o termo. Regras: (1) número ou fato da empresa vem sempre da plataforma; (2) prazo, percentual, alíquota, valor ou exigência de lei ou norma: pesquisar ANTES, porque de memória o Haiku errou a rescisão e o aviso prévio; (3) regra vigente, sem jurisprudência antiga, e por isso o RH pesquisa só em lei e governo; (4) toda conta passa pela ferramenta `calcular`, determinística (o Haiku escreveu 35 em vez de 45); (5) dúvida de outro tema vai à SARA certa, salvo a parte que toca a rotina da pessoa; (6) fora da empresa, recusa padrão. O verificador de escopo recebe o tema do módulo. O comentário do modelo sobre o próprio raciocínio é removido do texto. Testado com o modelo real: lei e números 8/8 (rescisão 10 dias, aviso prévio 45, FGTS 40%, ICMS SP→MG 12%, cancelamento de NF-e 24 h), tema e guardrails 13/13, dados dos 9 módulos 10/10. |
| Hora e conversa | Cumprimento (bom dia / boa tarde / boa noite) pela hora do servidor no fuso de São Paulo, com o primeiro nome de quem está logado, montado pela plataforma (`lib/sara/tempo.ts`). Conversa nova → cumprimenta; continuação → não; retomada (outro dia ou 3 h parada) → "Retomando a nossa conversa de ontem." A SARA recebe a hora atual e a da última mensagem. |
| Na tela | Botão "SARA" no módulo, abre um painel ao lado. A resposta é marcada como da SARA (IA), com as fontes clicáveis; nunca se confunde com dado da plataforma. |

## 4. Etapas

| Etapa | O que entrega | Aceite |
|---|---|---|
| S-0 | Este plano; registro no roadmap, no Blueprint e no Plano do Jev | Feito em 17/10 |
| S-1 | Base comum: rota, chamada ao Claude, registro das conversas, liga/desliga e teto, painel na tela | Sem a chave: aparece "não configurada"; com a chave e desligada: não responde |
| S-2 | SARA do Financeiro: manual do módulo e ferramentas (contas a pagar e a receber, vencidos, fluxo de 90 dias, saldos e conciliação, alçadas) | 30 perguntas reais da Ana respondidas com fonte; nenhuma com dado que ela não vê |
| S-3 | Ferramentas de outros módulos que o Financeiro usa (Compras: OCs aprovadas e compras diretas; Fiscal: notas e guias), só para quem tem a credencial | A mesma pergunta, feita por quem não tem Compras, não traz dado de Compras |
| S-4 | Homologação com a Ana (uso real por 2 semanas) e ligar em produção | Nota média ≥ 4 de 5 e nenhuma resposta sem fonte |
| S-5 | Próximos módulos (Compras, Comercial…), um de cada vez, pelo mesmo molde | Cada um com o seu aceite |

## 5. Regras que não mudam

- A SARA herda as permissões de quem pergunta e nunca acessa o banco por fora das ferramentas.
- Toda resposta é rastreável até a origem do dado.
- Nada de ação que grava no nível 1. A partir do nível 4 (22/10/2026), só com o "Permitir" de quem pediu (seção 6).
- Uso novo de IA é registrado no Plano do Jev antes de entrar.
- Dado pessoal e de saúde não vai ao modelo.

## 6. Nível 4: ações com autorização (22/10/2026)

O proprietário aprovou o plano do que absorver da LIA, o copiloto do WMS da TOTVS (nota de 22/10: cerca de 55/100). A primeira etapa (E1) tira a SARA do "só consulta". A regra do Blueprint ("nível N+1 só com o N em uso") está cumprida: a SARA nível 1 já está em uso.

- **A SARA prepara, a pessoa decide.** A ferramenta de ação confere a entrada e monta o resumo (`preparar`), sem gravar. Aparece o cartão **Permitir / Não permitir**. Ação de risco alto pede um segundo toque.
- **Mesma credencial, mesma função.** A execução roda com a sessão de quem permitiu e chama a mesma função do banco que a tela usa. A SARA não faz nada que a pessoa não pudesse fazer.
- **Proposta em `sara_acoes`.** Vale 15 minutos e só quem pediu decide. Cada ação feita ou recusada vai para o histórico (`sara.acao.executada` / `sara.acao.recusada`).
- **Primeiras ações** (baixo risco):
  - pedir material (Almoxarifado e Fundição);
  - abrir chamado de TI (qualquer SARA);
  - anotar na Biblioteca da Fundição.
  Aprovar título, conciliar e cancelar só entram com o "sim" da área.
- **E4, custo:** custo em R$ por resposta (tokens, com o desconto do cache), visível só ao proprietário e à Auditoria em "O que a SARA aprendeu". Quando o uso passa de 80% do teto do mês, o proprietário é avisado. Quem usa a SARA não vê contador.
- **Próximas etapas do plano:**
  - E2: foto, voz e leitor de código no celular;
  - E5: parâmetros usados, datas soltas e anexos;
  - E3: Guias criados pela área;
  - E6: servidor MCP;
  - E7: mindmaster.
