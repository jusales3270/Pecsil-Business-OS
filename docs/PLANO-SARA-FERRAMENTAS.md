# Plano: SDK da Anthropic, planilha Excel e quadro de tarefas

Aprovado pelo proprietário em 10/11/2026. A ordem de construção segue o [ROADMAP](ROADMAP.md) (itens I-26 a I-30).

## Contexto
Em 10/11/2026 a Anthropic lançou no claude.ai o Meetings, Sheets, Whiteboards, Data e Connectors. São produtos do aplicativo, não da API, então o SDK não os traz prontos. O dono decidiu:
1. adotar o SDK oficial da Anthropic no motor da SARA;
2. construir na plataforma os equivalentes que fazem sentido: **planilha Excel** (Sheets) e **quadro de tarefas** (Whiteboards). No quadro, um plano falado ou escrito vira tarefas com responsável e prazo, e uma reunião gravada vira quadro (a parte do Meetings).

Data e Connectors já existem ou estão em construção: a SARA consultando as áreas e o conector universal (B-12).

**Decisões do dono (10/11):**
- Qualquer pessoa cria tarefa para qualquer outra. O nome de quem criou aparece, e quem recebe pode **devolver** com o motivo.
- As tarefas aparecem **para todos**: tela "Tarefas" na Fundação e "Minhas tarefas" no menu da conta. A diretoria vê tudo na War Room.
- **Gravar a reunião no navegador.** O áudio não é guardado, só o texto. O quadro é conferido antes de virar tarefa, e os presentes são avisados.

**O que foi levantado no código:**
- **API:** 10 chamadas diretas à API em 9 arquivos, todas sem streaming, com versão `2023-06-01`. Nova tentativa e modelo reserva são feitos à mão em `lib/sara/tentativas.ts`. Os testes trocam o `fetch` por um objeto falso, não por um `Response`.
- **PDF:** fixo em cerca de 10 pontos: CHECK do banco, `nomeDoArquivo`, `contentType`, rota `/pdf`, `enviarDocumento` do WhatsApp, `agendados.ts` e três telas. A rota `/arquivo` já escolhe o tipo pelo `tipo` do documento.
- **Tarefas:** não existe tabela genérica. As peças a reaproveitar são:
  - prazo e situação dos chamados de TI (`ti_chamados`, `ti_chamado_andamentos`);
  - cobrança e efeito da vigia (`envios`, `precisaCobrar`, `whatsapp_agendados`);
  - aviso no sino (`notify_profile`, só dentro de função `security definer`);
  - quem responde por área (`sara_responsaveis`);
  - ações com Permitir (`sara_acoes`);
  - transcrição Whisper na Cloudflare (`lib/sara/voz.ts`, até cerca de 1 min por pedaço; o `MediaRecorder` do `sara-painel.tsx` corta em 60 s).

## Entregas
Na ordem abaixo. Cada etapa tem QA e commit próprio. Migração em produção só com o "pode aplicar" do dono.

### Etapa 1 — SDK no motor da SARA (I-26)
- **Instalação:** `@anthropic-ai/sdk` com versão fixa no `package.json`.
- **Porta única:** `lib/sara/motor/anthropic.ts`. É o **único** arquivo que importa o SDK.
  - Expõe `chamarClaude(corpo, { chave, buscar?, timeoutMs, sinal })` e devolve a mensagem.
  - Cliente com `maxRetries: 0`: a nova tentativa e o modelo reserva continuam sendo do `tentativas.ts`, sem somar com os do SDK.
  - Converte os erros tipados do SDK (status, `retry-after`) no `falhaDaResposta` atual.
  - O nome das opções do cliente (fetch customizado, timeout) é conferido nas fontes oficiais antes de escrever.
- **Fornecedores:** o `Provedor` de `lib/sara/modelos.ts` fica como está. A porta única é o que garante que outro fornecedor possa entrar depois.
- **Troca das chamadas, da menor para a maior:**
  1. `escopo.ts`
  2. `conferir-saida.ts`
  3. `memoria-pessoa.ts`
  4. `habilidades.ts` (2 chamadas)
  5. `bom-dia.ts`
  6. `sentinela/extracao.ts`
  7. `vigia.ts`
  8. `crescimento.ts`
  9. `laco.ts`, por último: laço de ferramentas, `pause_turn`, imagem, web search, citações e cache.

  O comportamento de cada um (timeouts, falha silenciosa, `tool_choice`, `semPensar`) fica igual.
- **Versão da API:** o SDK manda uma versão mais nova. Antes da troca, conferir o guia de migração de versão. O código não envia `temperature`, `top_p` nem `top_k`.
  - A pesquisa do Sonnet (crescimento, laço da central) passa a `web_search_20260209`.
  - As SARAs no Haiku continuam com `web_search_20250305`, porque o tipo novo não vale para o Haiku 5.5.
- **Testes:** um ajudante `respostaClaude(corpo, status, headers)` que devolve um `Response` de verdade. Os testes que hoje leem `init.body` continuam conferindo o corpo enviado.
- **Custo:** os campos de uso (`usage`) não mudam, então `custo.ts` e `sara_registrar` ficam iguais.
- **Feito em 10/11/2026:** SDK 1.6.0 (de 05/11; a 1.8.0 saiu no mesmo dia e ficou para depois), versão de API `2026-10-21`.
  - As 10 chamadas foram trocadas, sem mudar o comportamento.
  - A porta aceita a forma curta de resposta dos testes, então eles continuam como estavam.
  - **A pesquisa segue no `web_search_20250305` por enquanto.** Trocar para o `_20260209` muda a forma da busca (filtragem com execução de código) e o custo; fica como passo medido à parte, para esta etapa não mudar nada de uma vez.

### Etapa 2 — Planilha Excel (I-27)
- **Banco:** tipo `planilha` em `sara_documentos`, no padrão da migração da voz (derruba e recria o CHECK). O texto do sino passa a variar pelo tipo.
- **Gerador próprio:** `lib/sara/documentos/xlsx.ts`, sem biblioteca nova, usando `node:zlib` como o leitor `lib/arquivos/xlsx.ts`.
  - Uma aba por tabela, cabeçalho em negrito, largura das colunas.
  - **Número continua número**, com formato de moeda, número ou percentual; data como data.
- **Ferramenta `criar_planilha` da central:** o modelo escolhe quais visuais ou consultas entram e o nome das abas; **as linhas vêm cruas da plataforma** (`Visual` antes de `doVisual`/`formatar`). Nenhum número é digitado pelo modelo.
  - Corrigir também o contexto: hoje `ctx.visuais` só tem os visuais das áreas. Os visuais que a própria central monta passam a entrar.
- **Ajustes onde o PDF está fixo:**
  - `nomeDoArquivo` e `contentType` em `guardarDocumento`, pelo tipo;
  - rota `/arquivo` (`TIPO`) e o filtro da lista da War Room;
  - `enviarDocumento` com mimetype por parâmetro, e o nome do arquivo em `enviar.ts` e `agendados.ts`;
  - telas `AcoesDocumento` ("Baixar a planilha", sem Imprimir), `Documentos`, prévia do holograma e `documentos-recebidos`.
- **Envio e confirmação:** igual ao PDF (plataforma, WhatsApp, Permitir, enquete, direto para si).
- **Botão "Baixar em Excel"** nas tabelas que a SARA mostra no painel, sem criar documento.
- **Feito em 10/11/2026:** migração `202611100001_sara_planilha` aplicada (tipo `planilha` e o texto do sino pelo tipo).
  - Gerador conferido por um leitor independente (openpyxl).
  - Os visuais passam a ter número dado pela plataforma (`numero_do_visual`), inclusive os que a central monta; isso também vale para o PDF.
  - "Baixar em Excel" em todo visual da SARA (rota `/api/sara/planilha`).
  - QA ponta a ponta 15/15, com a SARA central real.

### Etapa 3 — Tarefas e quadro (I-28)
> **Situação em 10/11/2026: pronta**, com a migração 202611100002 aplicada. Falta o Deploy. Diferenças do que foi planejado:
> - A tela agrupa por prazo ou por pessoa e filtra por "minhas / que pedi / todas", por quadro e pelas concluídas. Filtro por área e edição na própria linha ficaram para depois (hoje se edita no detalhe).
> - O cartão do Permitir mostra a lista mas não a edita. A correção (responsável, prazo) se faz depois, na tela. Na tela "Montar quadro de uma reunião" a lista é editável antes de criar.
> - O plano de ação da Qualidade (tarefa ligada à NC) ainda não foi construído. O banco já guarda a referência (`referencia_tipo`/`referencia_id`).
> - O "Comentar" só funciona depois da migração 202611100003, que corrige o tipo do andamento.
- **Banco (migração nova):**
  - `quadros`: título, data, origem (texto, reunião, SARA), resumo e quem criou.
  - `tarefas`: título, detalhe, área (módulo), responsável, prazo (data), situação (aberta, em_andamento, feita, devolvida, cancelada), motivo da devolução, quadro, referência opcional (OS, cotação, NC…), quem criou, concluída_em, cobranças e cobrado_em.
  - `tarefa_andamentos`.
  - **Quem vê:** responsável, quem criou, proprietário, auditoria, a diretoria com `warroom.sara`, e quem responde pela área (`sara_responsaveis`).
  - **Gravação:** só por funções `security definer`: `tarefa_criar` (qualquer pessoa ativa, para qualquer pessoa ativa da empresa; avisa no sino), `tarefa_atualizar` (andamento, feita, devolver com motivo, que avisa quem criou), `quadro_criar` e `tarefas_minhas`.
- **Telas:**
  - **Fundação › Tarefas:** quadros, com cronograma por prazo e colunas por responsável; edição inline; filtros por área, pessoa e situação.
  - **"Minhas tarefas"** no menu da conta, com contador, como as Decisões para você.
  - **War Room › Conselho:** resumo do andamento (abertas, vencidas, % concluído por quadro).
- **SARA:** ferramenta `montar_quadro` em todas as SARAs, não só na central.
  - Entra o texto colado, ditado ou transcrito. O modelo propõe os itens (tarefa, responsável falado, prazo falado, área).
  - **A plataforma confere:** o nome por `acharPessoa` sobre as pessoas ativas (com o responsável da área como sugestão quando o nome não é dito) e a data relativa ("sexta", "dia 20") pelos auxiliares de data já existentes.
  - O cartão mostra a lista **editável**; o Permitir cria tudo. Item sem responsável ou sem prazo fica marcado para completar.
  - Ferramenta `minhas_tarefas` para a pessoa perguntar "o que tenho para hoje".
- **Cobrança:** no padrão da vigia, na tarefa agendada de 10 em 10 minutos.
  - Aviso ao criar; lembrete na véspera do prazo; vencida = cobrança (até 3).
  - Pelo WhatsApp para quem está na lista, via `whatsapp_agendados`, respeitando o horário silencioso.
  - O Bom dia passa a incluir "suas tarefas de hoje e vencidas".
- **Qualidade:** a tarefa com referência a uma não conformidade é o plano de ação que falta no módulo (hoje a SARA da Qualidade diz que "virá").

### Etapa 4 — Gravar reunião (I-29)
- **Botão "Gravar reunião"** no quadro: `MediaRecorder` em pedaços de cerca de 50 s.
  - Cada pedaço vai para `/api/sara/[modulo]/voz` (Whisper na Cloudflare) e o texto é juntado.
  - Aviso fixo na tela: "Avise os presentes que a reunião está sendo transcrita".
  - Áudio não é guardado; o texto fica no quadro.
- **Fim da gravação:** `montar_quadro` com o texto inteiro e o mesmo cartão editável.
- **Limites:** tempo máximo (por exemplo 90 min) e retomada se um pedaço falhar.

### Etapa 5 — Lote pela metade do preço (I-30, depois de medir)
- **Medir antes:** quais tarefas aguentam esperar (pode levar de minutos a horas). Candidata principal: a extração da Sentinela.
- **Só entra se o atraso couber.** O vigia e o Bom dia têm hora certa e ficam fora.

## Arquivos principais
- **Novos:**
  - `lib/sara/motor/anthropic.ts`
  - `lib/sara/documentos/xlsx.ts`
  - `lib/tarefas/*` (regras puras e testáveis: datas, nomes)
  - migrações de planilha e tarefas
  - `modules/foundation` ou `app/components` para Tarefas
  - `docs/PLANO-SARA-FERRAMENTAS.md`
- **Alterados:**
  - os 9 arquivos das chamadas e `lib/sara/tentativas.ts`
  - `lib/sara/central/documentos.ts`, `lib/sara/documentos/documento.ts`, `lib/sara/sessao.ts`
  - rotas `app/api/sara/documentos/*`
  - `lib/whatsapp/{enviar,evolution,agendados}.ts`
  - `modules/warroom/src/{AcoesDocumento,Documentos}.tsx`
  - `lib/sara/central/{vigia-executar,bom-dia-executar}.ts`
  - `scripts/sync-os-cron.mjs`
  - `docs/ROADMAP.md`, `lib/novidades.ts`

## Verificação
- **Etapa 1:** suíte inteira verde com os mocks novos; um teste por chamada conferindo o corpo enviado; QA real numa conversa da central (consulta às áreas, web search, cache) e numa SARA de área; custo da conversa igual ao de antes.
- **Etapa 2:** planilha aberta no Excel e no Numbers (números somáveis, moeda certa), conferida na tela do dono; envio pela plataforma e pelo WhatsApp (Evolution simulada) com o mimetype certo.
- **Etapa 3:** QA no navegador com usuários temporários com as permissões reais:
  - criar, devolver e concluir; RLS (quem não deve ver não vê); cobrança na véspera e no vencimento;
  - quadro montado a partir de um texto de reunião com frases reais;
  - claro, escuro e celular.
- **Etapa 4:** gravação de 3 minutos em pedaços, texto completo, quadro montado.
- **Todas:** commit só dos meus arquivos; Deploy com o dono.
