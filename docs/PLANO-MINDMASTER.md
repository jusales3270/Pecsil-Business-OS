# Plano da SARA central — o "Jarvis" da PecSil (E7)

> Etapa E7 do plano "o que absorver da LIA/TOTVS" (ROADMAP I-19). Desenho das duas camadas: [PLANO-SARA §0](PLANO-SARA.md).
> Onde ela mora: War Room › Conselho ([PLANO-WAR-ROOM-CEREBRO §4](PLANO-WAR-ROOM-CEREBRO.md)).
>
> Criado em 23/10/2026 e revisto no mesmo dia pelo conceito do proprietário · Execução: Claude
> **Situação:** plano aprovado (decisões 1 a 6 abaixo). J1 no ar (Deploy 23/10). J2 e J3 no ar (Deploy 23/10). J4 pronta (migração aplicada, QA 22/22), falta o Deploy.

---

## 0. O conceito (proprietário, 23/10/2026)

> "A SARA não tem de só executar quando provocada, ela tem de ser de fato o cérebro da empresa como um
> todo. Se ela enxergar ações que estão fazendo com que a empresa esteja com gargalos estruturais,
> financeiros ou de pessoal, ela não só deve identificar como acionar o responsável e trazer essas
> informações e sugerir ações práticas de contenção, e até ideias práticas inovadoras que os gestores
> ainda não tenham visto, visando o crescimento da empresa, buscando novos recursos, estudando a
> concorrência e propondo investimentos pontuais com justificativas."

Veio do vídeo do agente pessoal que se antecipa ("Claude Duet"): o agente conhece o contexto e oferece
ajuda antes de ser pedido. A SARA central faz isso para a empresa inteira.

## 1. As três funções e o "Bom dia"

1. **Responde** (sob demanda, J1): a central divide a pergunta entre as SARAs dos módulos, que trabalham
   ao mesmo tempo e com a sessão de quem pergunta. O **verificador** confere cada número com o que elas
   devolveram e a resposta sai com as fontes e com quem decide.
2. **Vigia** (todo dia, J3):
   - varre os sensores de todos os módulos (os avisos calculados dos dados) e os Parados;
   - liga uma área à outra pelo grafo (Fundição atrasada → faturamento → caixa);
   - ordena por impacto (R$, prazo, pessoas afetadas).
   Cada **achado** vai ao responsável da área como "Decisão para você", com:
   - a evidência;
   - 1 a 3 ações de contenção, preparadas para o Permitir quando a ação existe;
   - as opções "Vou tratar", "Não é problema" e "Preciso de ajuda".
   Sem resposta, ela cobra. Resolvido, ela registra o efeito.
3. **Pensa** (toda semana, J4): relatório de crescimento para o proprietário e o conselho, com:
   - ideias práticas que saem dos dados;
   - novos recursos (fomento, crédito, editais, incentivos);
   - a concorrência (o que é público na internet);
   - investimentos pontuais, cada um com premissas, custo, retorno, prazo de retorno e risco.
   Tudo marcado como opinião da IA, com a confiança.
4. **Bom dia** (J2): às 7h, um resumo do dia para cada pessoa, com só o que ela pode ver: avisos, guias,
   decisões pendentes e achados da área.

## 2. Regras que não mudam

- **Credencial:**
  - o "Bom dia" e o achado entregue à área são montados com a sessão de quem recebe;
  - a visão da empresa inteira fica na War Room (só o proprietário por enquanto: W1).
- **Número só com fonte** (o verificador). **Opinião é opinião,** com a confiança à vista.
- **Nada grava sem Permitir. Decisão é da área:** a central recomenda, aciona e cobra; não decide.
- **Nenhum dado da empresa na internet:** a pesquisa leva só o assunto.
- **Sem ruído:**
  - cada achado tem chave de situação e não se repete enquanto nada mudar;
  - há limite de achados por pessoa por dia;
  - "Não é problema" baixa a prioridade daquele tipo de achado para a área.

## 3. Ferramentas

✅ já existe · 🆕 construir · 🔒 depende de recurso ou decisão.

- **Ver a empresa:**
  - 🆕 `perguntar_a_sara`, `sensores_da_empresa`, `parados`, `indicadores`, `linha_do_tempo`, `dependencias` / `caminho`;
  - ✅ `consultar_dados`, fluxo de 90 dias, documentos, dados da empresa, período, foto e anexo.
- **Raciocinar e conferir:**
  - 🆕 verificador de números (etapa da plataforma), `simular_cenario`, `avaliar_investimento` (prazo de retorno, VPL, TIR, cenário pessimista), `pareceres_do_conselho` (CFO, Operações, Compras, Comercial, Pessoas, TI);
  - ✅ `calcular`.
- **Agir e acionar:**
  - 🆕 `registrar_achado`, `acionar_responsavel` (sobre as Decisões), `pedir_decisao`, `agendar_retorno`, `avisar` (com limite), `mostrar_grafo`;
  - ✅ as ações com Permitir, guias, telas, visual.
- **Olhar para fora:** 🆕 `pesquisar_na_internet` (aberta, só o assunto, com filtro que barra nome, CNPJ e valores da empresa) e `ler_pagina`.
- **Memória:** 🆕 `achados_anteriores`, `decisoes_respondidas`, `relatorios_anteriores`.
- **🔒 Recursos que faltam:**
  - WhatsApp (número dedicado, B-04);
  - e-mail e agenda do Microsoft 365 (C-14);
  - o conector universal (GRV), que é a prioridade máxima.
- **Ela NÃO terá:**
  - gravar direto no banco;
  - falar com fornecedor, cliente ou banco sem Permitir;
  - mandar dado da empresa para a internet;
  - decidir no lugar da área.

## 4. Etapas

| # | Etapa | Ferramentas | Situação |
|---|---|---|---|
| **J1** | Responde: orquestrador + subagentes em paralelo + verificador, em War Room › Conselho | `perguntar_a_sara`, verificador, `calcular`, `periodo` | **no ar** (Deploy 23/10): `lib/sara/central/`, laço com chamadas paralelas; holograma e voz ao vivo |
| J2 | Bom dia por pessoa, às 7h | avisos dos módulos (`alertasDo`), decisões, ações e guias da pessoa | **construída** (23/10): `lib/sara/central/bom-dia*.ts`, rota `/api/sara/bom-dia/rodar` na tarefa de 10 em 10 minutos; migração 202610230003 aplicada, QA 24/24; falta o Deploy |
| J3 | Vigia: achados, responsável acionado, cobrança e efeito; quadro na War Room | sinais (avisos + Parados), análise com verificador, Decisões, cobrança | **construída** (23/10): `lib/sara/central/vigia*.ts`, rotas `/api/sara/vigia/rodar` e `/api/sara/central/vigia`, quadro em Conselho; migração 202610230004 aplicada, QA 27/27; falta o Deploy |
| J4 | Conselho e crescimento semanal | pesquisa aberta só com o assunto, `avaliarInvestimento`, relatório anterior | **construída** (23/10): `lib/sara/central/crescimento*.ts`, rotas `/api/sara/crescimento/rodar` e `/api/sara/central/crescimento`, seção Crescimento no Conselho; migração 202610230005 aplicada, QA 22/22; falta o Deploy |
| J5 | Aprende com as respostas e o efeito | memória | na fila |

**Como a J1 funciona no código:**
- `SARA_CENTRAL` (`lib/sara/central/sara.ts`) entra em `SARAS` como a SARA do módulo `warroom`, com `central: true`. A janela é a mesma das outras.
- Em `prepararCom` (`lib/sara/sessao.ts`) ela recebe só `perguntar_a_sara` (com as áreas que a pessoa pode usar), `calcular` e `periodo`.
- Cada subagente roda a SARA do módulo com a mesma sessão, sem agir, navegar nem propor (`lib/sara/central/subagente.ts`).
- O laço (`lib/sara/laco.ts`) roda juntas as chamadas marcadas `paralela` e devolve o resultado de cada consulta.
- A rota confere os números (`lib/sara/central/verificador.ts`) e grava na conversa o uso de cada subagente.
- **Limite conhecido:** o custo da conversa da central conta só os tokens dela; o uso das SARAs das áreas, no Haiku, fica no registro da conversa (`subagentes`), mas não entra no painel de custo. É pequeno, porque o Haiku custa cerca de 20 vezes menos.

## 4b. Voz ao vivo: Grok Voice (23/10/2026)

O proprietário escolheu o **Grok Voice** (xAI, `grok-voice-3.0`) como o motor de fala da SARA central, com a voz **"luna"** em **pt-BR**. O diferencial: ela age enquanto fala.

- **A voz, não o cérebro.** O Grok escuta, fala, aceita interrupção e chama funções. Para qualquer dado da empresa, ele chama `consultar_sara_central`, que é a mesma rota da central (com as permissões, o verificador e o registro). Ele não responde com o conhecimento próprio.
- **Número exato.** A resposta conferida é falada palavra por palavra (`force_message`), sem o modelo reformular.
- **Agir enquanto fala.** As funções (consultar, minimizar, tela cheia, próximo ou anterior gráfico, fechar a apresentação) são executadas no instante em que chegam, com o áudio ainda tocando.
- **Segurança.** A chave `XAI_API_KEY` fica só no servidor. A rota `/api/sara/warroom/voz-ao-vivo` confere a permissão e se a voz existe, e pede um token temporário de 5 minutos. O navegador conecta direto ao Grok com esse token. Sem a chave configurada, o microfone volta ao Whisper.
- **Dados:** o áudio e a resposta conferida vão à xAI, que guarda por 30 dias, a menos que o Zero Data Retention esteja ligado (recomendado). Registrado no PLANO-JEV.
- **Código:**
  - `lib/sara/central/voz-ao-vivo.ts`: a sessão, as funções, a persona e as regras puras;
  - `modules/warroom/src/holograma/voz-ao-vivo.ts`: o motor no navegador.

**Como a J2 funciona no código:**
- A tarefa de 10 em 10 minutos (`scripts/sync-os-cron.mjs`) chama `/api/sara/bom-dia/rodar`. Fora da janela (7h às 11h, de segunda a sábado), nada acontece, e o que ficou na fila não sai mais.
- Na janela, entra na fila (`sara_bom_dia`, uma linha por pessoa por dia) quem está ativo e tem a SARA de algum módulo, ou é o proprietário. A fila roda até 9 por vez, 3 em paralelo.
- Cada Bom dia é montado com a sessão da pessoa (`sessaoComo`, como as guias):
  - os avisos de cada módulo dela (`alertasDo`, os mesmos da janela da SARA);
  - as decisões sem resposta;
  - as ações esperando o Permitir;
  - o que as guias dela fizeram nas últimas 24 horas.
- Sem nenhum item, não manda nada. Com itens, o Haiku escreve com os fatos e o verificador confere os números. Se algum não bater, ou se o modelo falhar ou o teto do mês tiver passado, sai o texto da plataforma.
- O texto vira uma conversa da SARA da área com mais urgentes, e o aviso no sino abre essa conversa.
- Ainda não usa os achados da vigia (J3) nem os Parados: entram quando a J3 existir.

**Como a J3 funciona no código:**
- **Quando:** a tarefa de 10 em 10 minutos chama `/api/sara/vigia/rodar` antes do Bom dia. Na janela (6h30 às 10h, de segunda a sábado), roda uma vez por dia; o índice único de `sara_vigia_rodadas` garante isso. O proprietário também roda pelo botão em War Room › Conselho, no máximo uma vez a cada 20 minutos.
- **Sinais**, com a sessão da visão (o proprietário, W1):
  - os avisos de cada módulo (`alertasDo`, sem as novidades);
  - os Parados (`parados_listar`), agrupados por tipo; parado há 7 dias ou mais é urgente.
- **Achados abertos**, antes da análise:
  - a resposta de cada decisão atualiza a situação (Vou tratar, Preciso de ajuda, Não é problema);
  - quem não respondeu é lembrado a cada 2 dias, até 3 vezes;
  - o achado cujos sinais sumiram vira "resolvido", com o efeito anotado.
- **Análise:** o Sonnet lê os sinais e os achados abertos (`registrar_achados`, com `tool_choice` automático, porque o Sonnet 5.5 não aceita forçar a ferramenta). A plataforma confere sinais, módulo, contenções e cada número (`validarAchados`). O achado com número sem fonte é descartado, e os sinais urgentes dele viram achados da plataforma (`resgatarDescartados`). Sem o modelo, ou com o teto passado, cada sinal urgente vira um achado da própria área.
- **Sem repetir:**
  - o mesmo problema de um achado aberto (mesmo módulo e metade dos tipos de sinal em comum) só atualiza a evidência;
  - "Não é problema" deixa aquele tipo em silêncio para a área por 30 dias.
- **Entrega:** vai a quem decide na área (`sara_responsaveis`, carregado pelo ROADMAP §0) como "Decisão para você", no máximo 3 por pessoa por dia, só se a pessoa enxerga os mesmos sinais com a sessão dela. Sem ninguém com acesso, o achado fica no quadro como "sem responsável".
- **Custo:** os tokens da vigia entram no teto da SARA central (`sara_uso_mes('warroom')`).
- **Ainda não:**
  - as ações com Permitir prontas dentro do achado: a contenção é texto, e a ação pronta continua no aviso da SARA do módulo;
  - o grafo do Segundo Cérebro na correlação;
  - mudar quem decide pela tela (por enquanto, o cadastro inicial).

**Como a J4 funciona no código:**
- **Quando:** a tarefa de 10 em 10 minutos chama `/api/sara/crescimento/rodar`. Sai uma vez por semana, na segunda das 8h às 12h (índice único de `sara_relatorios`). O proprietário também gera pela War Room, no máximo um a cada 2 horas; esse avisa só quem pediu.
- **1. Retrato da semana**, com a sessão da visão (o proprietário): fluxo de 90 dias, receber e vencidas, funil, orçamentos, a faturar, clientes, compras realizadas, OS e notas emitidas. Nada do RH (dado de colaborador).
- **2. Pesquisa:** o Sonnet, com a busca na internet aberta (até 8 buscas), recebe SÓ `ASSUNTO_DA_EMPRESA` (setor e região, em `lib/sara/central/sara.ts`). Vale só o achado com o link de um resultado da busca.
- **3. Síntese, sem internet:**
  - entram o retrato, os gargalos da vigia, o relatório anterior (o que mudou) e a pesquisa;
  - `validarRelatorio` confere os números com o retrato e a pesquisa e aceita só links da busca;
  - nos investimentos, percentual é estimativa declarada e valor em reais tem de ser o custo, o ganho ou um dado;
  - `avaliarInvestimento` faz a conta: prazo de retorno, VPL e TIR a 15% ao ano em 60 meses, e o pessimista com o ganho 30% menor.
- **Entrega:** o relatório fica em War Room › Conselho › Crescimento (as últimas 8 semanas), e o aviso no sino vai ao proprietário e a quem tem `warroom.sara`. A aprovação de qualquer item é da área (as Decisões), não do relatório.
- **Ainda não:** `simular_cenario` e os pareceres do conselho por papel (CFO, Operações…) ficam para depois.

## 4c. Documentos em PDF (pedido do proprietário, 23/10/2026)

A SARA central monta documentos sob pedido e envia a quem se destina. Exemplo: "levante os últimos 5 financiamentos quitados, compare preços e juros, faça um documento e envie para a Ana". **Só a central cria; as SARAs dos módulos só recebem.**

**Decisões do proprietário (23/10):**
- **Envio:** interno agora, pela plataforma. Para fora, por e-mail (M365, C-14) e WhatsApp (B-04) quando os recursos estiverem prontos; até lá, o PDF é baixado e encaminhado.
- **Marca de IA:** o documento externo (carta) sai sem marca de IA, porque o proprietário aprova a prévia. No relatório interno, os insights ficam marcados como análise da IA, com a confiança.

**Como funciona:**
1. A central faz o levantamento com as áreas (`perguntar_a_sara`) e as contas (`calcular`).
2. A central chama `criar_documento`:
   - relatório: sumário, seções com texto, tabela e gráfico, insights, recomendações e quem decide;
   - carta: oferta, convite ou comunicado, com destinatário, assunto, corpo e assinatura.
3. A plataforma confere cada número com o que as áreas e a calculadora devolveram (`textoParaConferir` + o verificador). Número sem fonte volta como erro para a central corrigir.
4. A plataforma gera o PDF A4 no servidor (`@react-pdf/renderer`) com:
   - o timbre: logo, razão social, CNPJ, endereço e contato do cadastro;
   - o número `DOC-AAAA-NNNN` e o rodapé "Página X de Y";
   - os gráficos de barras, linhas e rosca desenhados no próprio PDF.
   O arquivo fica no bucket privado `sara-documentos`.
5. **Prévia:** no holograma, com "Abrir o PDF".
6. **Envio:** `enviar_documento` é uma ação com Permitir. O cartão avisa se quem recebe não tem acesso a uma área do documento. Quem recebe:
   - é avisado no sino;
   - abre o PDF em "Documentos para você" (menu da conta);
   - pode perguntar à SARA do módulo dele (`documentos_recebidos`, só leitura).
7. **Registro:** War Room › Conselho › Documentos, com o que foi gerado, para quem foi e se abriram.

**Código:**
- `lib/sara/documentos/documento.ts`: regras puras;
- `lib/sara/documentos/pdf.ts`: motor do PDF;
- `lib/sara/central/documentos.ts`: as ferramentas;
- migração 202610230006;
- rotas `/api/sara/documentos` e `/api/sara/documentos/[id]/pdf`;
- telas `app/components/documentos-recebidos.tsx` e `modules/warroom/src/Documentos.tsx`.

**Lição:** com `lineHeight` herdado, o número da página some (defeito do `@react-pdf`); o espaçamento entre linhas fica no bloco do conteúdo.

**D2, quando houver os recursos:**
- orçamento e proposta a partir do orçamento cadastrado (preços só do registro);
- envio por e-mail (M365) e WhatsApp (número dedicado), sempre com a prévia e o Permitir.

## 5. Decisões do proprietário (aprovadas em 23/10/2026)

1. A central mora em War Room › Conselho; só o proprietário usa a visão da empresa inteira por enquanto (permissão `warroom.sara`).
2. Achados vão direto ao responsável da área pelo "quem decide o quê", e o proprietário acompanha tudo.
3. "Bom dia" às 7h, de segunda a sábado, para quem tem a SARA liberada.
4. Pesquisa de concorrência e de recursos na internet aberta, só com o assunto.
5. Sonnet 5.5 na central, na vigia e no crescimento; Haiku no "Bom dia". Teto da central em cerca de R$ 300 por mês (60 milhões de tokens), com aviso aos 80%.
6. Ordem: J1 → J2 → J3 → J4 → J5.
