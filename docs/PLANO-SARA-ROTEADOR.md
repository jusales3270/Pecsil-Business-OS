# PLANO — Roteador de modelo e esforço da SARA (I-32), pronto para o ECOS

Aprovado pelo proprietário em 14/11/2026 ("vamos começar já essa construção… para que ela valha também para outras empresas").

## Contexto
O dono quer um roteador dentro do sistema que avalie cada pedido e escolha o modelo do Claude (Haiku, Sonnet, Opus, Fable) e o nível de esforço (low a max). A base é o guia da Anthropic: o modelo decide o quanto o Claude sabe, e o esforço decide o quanto ele se aplica. A regra é usar o mais barato que resolve e subir um degrau quando a resposta falha.

Exigência: valer para qualquer empresa do ECOS, sem nada fixo da Pecsil.

**Hoje, medido no código:**
- **Onde o modelo é escolhido:** fica fixo por SARA. `sara_modulos.modelo` só aceita Haiku ou Sonnet, sem tela para mudar. Há ainda constantes em `central/sara.ts:69`, `agentes/ti.ts:252` e `agentes/qualidade.ts:114`.
- **Por onde passa:** o modelo chega à API num só lugar, `lib/sara/laco.ts:222-227`.
- **O "pensar":** sai de `semPensar` (`lib/sara/base.ts:129`). Ele dá 400 com Opus e Fable, que não desligam o pensar.
- **Esforço:** não é usado em nenhuma chamada.
- **Chamadas auxiliares:** cada uma tem modelo fixo no próprio arquivo — Bom dia, vigia, crescimento, Sentinela, memória, conferir-saída, roteador da voz, tarefas e habilidades.
- **Teto do mês:** é em tokens, sem pesar o modelo, e os tokens das SARAs das áreas consultadas pela central ficam fora dele (`responder.ts:253`).
- **Custo:** `PRECOS` (`lib/sara/custo.ts`) só tem Haiku e Sonnet.

**Regras da API, conferidas na documentação e nos tipos do SDK 1.6.0:**
- O esforço vai em `output_config.effort`.
- **Haiku 5.5:** desliga o pensar só com esforço até `high`. Esforço padrão `medium`.
- **Sonnet 5.5:** `disabled` dá 400. Para desligar o pensar, só `between_tools`, com esforço até `high`, e esse modo é exclusivo do Sonnet 5.5. Esforço padrão `high`.
- **Opus 5.5:** o pensar não desliga. Esforço padrão `medium`.
- **Fable 5.2:** o pensar fica sempre ligado. Esforço padrão `high`. Exige retenção de 30 dias.
- **Sonnet 5.5, Opus e Fable recusam ferramenta forçada** (`tool_choice any`).
- **Cache:** trocar o modelo ou o esforço entre pedidos perde o cache.

## Desenho: três camadas (o que é do fornecedor, o que é da empresa e o que é do pedido)

### 1. Catálogo de modelos — código, igual para todas as empresas
Vai em `lib/sara/modelos.ts` (já existe: `MODELOS` e `modeloReserva`). Cada modelo recebe:
- preço de entrada, saída e cache;
- esforços aceitos e esforço padrão;
- como o pensar fica no mínimo: Haiku `disabled`, Sonnet `between_tools`, Opus e Fable `adaptive`;
- se aceita ferramenta forçada;
- qual é o modelo reserva;
- se exige retenção.

Entram Opus 5.5 e Fable 5.2.

**Montador do pedido** (função pura): `pedidoPara(modelo, esforco, {ferramentaForcada})` devolve o `thinking`, o `output_config` e o `tool_choice` válidos. Onde a ferramenta forçada não vale, troca por `auto` com instrução no texto. Ele substitui o `semPensar` em todas as chamadas, então nenhuma combinação dá 400.

`custo.ts` passa a ler os preços do catálogo. O modelo reserva (`tentativas.ts`) remonta o pedido para o modelo novo.

### 2. Política da empresa — banco, uma linha por organização (o "harness business")
Tabela nova `sara_politica_modelos`, no molde de `202611030002_sara_vigia_config.sql`: colunas tipadas, RLS só de leitura e gravação pelo servidor com auditoria.

**Quatro níveis genéricos**, cada um com modelo e esforço próprios. Padrões iniciais, confirmados pela medição da Etapa 0:

| Nível | Quando | Padrão |
|---|---|---|
| rápido | consulta simples, classificar, rotear, resumir | Haiku 5.5, low |
| padrão | tarefa com "pronto" claro: painel, PDF com modelo, cruzar duas áreas | Sonnet 5.5, medium |
| critério | julgamento com risco: dinheiro, decisão, documento externo, recomendação | Opus 5.5, medium |
| profundo | aberto ou estratégico: diagnóstico, plano, análise do ano | Opus 5.5, high (Fable 5.2 disponível, desligado por padrão) |

**Demais campos da política:**
- Modo do roteador: desligado, sombra (só registra) ou ligado.
- Teto do mês em reais por empresa, no lugar do teto em tokens.
- Os trabalhos fixos apontam para um nível. Padrões: Bom dia, memória, Sentinela, conferir-saída e roteador da voz no rápido; vigia no critério; relatório de crescimento no profundo.

**Quem usa o nível profundo:** uma permissão nova, `fundacao.sara_profunda`, no catálogo `modules/access-catalog.ts` e em `access_features`. O proprietário tem sempre. Para quem não tem, o pedido para no nível critério.

**Tela do proprietário:** em Fundação › "O que a SARA aprendeu" (já tem o custo da IA, componente `CustoDaIa`), uma seção "Modelos e esforço" com os 4 níveis, o modo, o teto e os trabalhos fixos. Os seletores só mostram o que o catálogo aceita.

A linha inicial é criada para todas as organizações (`insert ... select from organizations`). Nada da Pecsil fica no código.

### 3. Decisão por pedido — classificador
- **Arquivo novo:** `lib/sara/nivel.ts`.
- **Como decide:**
  - Uma chamada curta no nível rápido, com o montador e sem pensar, devolve `{nivel, risco, motivo}`.
  - Lê a pergunta, o canal, se há anexo ou imagem, se é a central, a última resposta (para continuação curta) e a lista genérica de áreas.
  - O texto da instrução é genérico: tipos de pedido e exemplos neutros, nenhum termo da Pecsil.
- **Quando roda:** começa no início do `responder` (`lib/sara/responder.ts`), em paralelo com as leituras que já existem, então quase não soma tempo. O verificador de escopo continua como está.
- **Regras sobre o nível sugerido:**
  - a política da empresa decide o modelo e o esforço;
  - sem a permissão profunda, o pedido para no critério;
  - a continuação curta herda o nível do pedido anterior, para não ficar trocando e perdendo o cache;
  - se o classificador falhar, vale o padrão da SARA, como hoje.
- **Por onde passa:** pelos `argsConversa` até `laco.ts:222`. As SARAs das áreas consultadas pela central seguem o padrão da área (Haiku), como recomenda a Anthropic: um modelo forte no comando e ajudantes baratos.
- **Escada de subida, no máximo uma vez por pedido:** quando o verificador de números recusa, a conferência de saída reprova ou a resposta sai sem fonte, a SARA tenta de novo um degrau acima. Primeiro sobe o esforço, depois o modelo. Tudo dentro da política e da permissão.

### Registro, custo e transparência
- **Registro do roteamento:** em `sara_mensagens.ferramentas`, um bloco `roteamento` com nível, motivo, modelo, esforço, se subiu, o tempo do classificador e o custo. O `jsonb` já existe; não precisa mudar `sara_registrar`.
- **Custo em reais:** coluna nova `custo_usd` em `sara_mensagens`, calculada pelo catálogo e incluindo o que as SARAs das áreas consultadas pela central gastaram, que hoje fica fora.
  - `sara_uso_mes` ganha uma versão em reais, que vira o teto.
  - Os avisos de 80% e de teto cheio continuam valendo.
- **Na tela:**
  - "Como chegou à resposta" mostra o nível, por exemplo "Análise com critério · Opus".
  - O painel de custo agrupa por nível e por modelo.

## Situação

**Etapa 0, medição (14/11/2026).**
- Script `scripts/medir-nivel-sara.mjs`, só leitura. O relatório fica no Desktop do dono, em "Pecsil - SARA ações/Roteador da SARA - medição (14-11).html", e não vai para o repositório porque tem perguntas reais da equipe.
- 149 perguntas reais em 60 dias, fora 168 "Bom dia" automáticos.

| Nível | Perguntas | Hoje/mês | Roteador/mês | Com pensar do Opus (estimativa) |
|---|---|---|---|---|
| rápido (Haiku low) | 71 (48%) | R$ 4,57 | R$ 1,36 | R$ 1,36 |
| padrão (Sonnet medium) | 42 (28%) | R$ 5,22 | R$ 6,52 | R$ 6,52 |
| critério (Opus medium) | 33 (22%) | R$ 5,10 | R$ 11,18 | R$ 17,76 |
| profundo (Opus high) | 3 (2%) | R$ 0,47 | R$ 0,91 | R$ 1,25 |
| **total** | 149 | **R$ 15,35** | **R$ 19,98** | **R$ 26,90** |

- O classificador custa R$ 0,09 por mês.
- **Leitura:** o roteador custa um pouco mais em valor absoluto, porque o critério vai para o Opus. Em troca, gasta menos na metade das perguntas, que são rápidas, e põe o modelo forte onde há julgamento e risco.
- **Correções que a medição mostrou:**
  - a continuação curta só herda o nível quando emenda de fato ("e amanhã?", "pode abrir", "sim, envie"). Herdar pelo tamanho mandou "volta ao cérebro" e "quais pedidos estão parados" para o nível profundo;
  - o classificador sempre recebe a última resposta, e um dado solto ("Período 01/06 a 30/09") não sobe o nível.
- **Fica com o proprietário:** julgar os exemplos do relatório e confirmar os padrões dos níveis antes da Etapa 2.

**Etapa 1, catálogo e montador (14/11/2026).**
- O `semPensar` passa a ler o catálogo. No Opus e no Fable o pensar é adaptativo; o `semPensar` antigo mandaria `between_tools` e daria 400.
- O laço (`lib/sara/laco.ts`) monta o pedido pelo `pedidoPara` a cada chamada, e o modelo reserva recebe o pensar e o esforço dele. O esforço é opcional: sem ele, nada muda.
- O roteador da voz também passa pelo montador.
- O turno da SARA volta inteiro à API, com os blocos de pensamento, como o Opus e o Fable exigem.
- **Teste real:** 36 de 36 chamadas sem erro — os 4 modelos × esforço (padrão, low, high, max) × ferramenta forçada ou não, mais 2 rodadas de ferramenta devolvendo o pensar.

**Etapa 2, política por empresa (14/11/2026).**
- A migração `202611140001_sara_politica_modelos.sql` foi **APLICADA** em 14/11, com o "pode aplicar" do proprietário. Ela criou:
  - a tabela com uma linha por empresa, desligada e com os padrões;
  - o `custo_usd` gerado;
  - a função `sara_custo_mes()`.
- A análise profunda é liberada pela própria política (proprietário, diretoria pelo cargo Diretor, ou todos), sem permissão nova. Uma permissão na Fundação abriria o menu da Fundação para quem a recebesse.
- **Teste no navegador: 14 de 14**, com usuários temporários:
  - quem não é dono nem Auditoria é recusado;
  - a Auditoria lê e não grava;
  - o proprietário vê o catálogo, e um modelo fora dele é recusado com o motivo;
  - salvar grava no banco com auditoria do antes e do depois e reaparece ao reabrir;
  - o aviso do Fable aparece; claro, escuro e celular funcionam.
  - A linha da política foi restaurada igual à original.

**Etapa 3, o roteador na resposta (14/11/2026).**
- `lib/sara/roteamento.ts` decide (regras puras) e `lib/sara/responder.ts` chama a decisão:
  - a política e a classificação começam em paralelo com o resto da preparação;
  - **desligado:** não chama o classificador;
  - **só registrar:** decide depois da resposta, sem atrasar;
  - **ligado:** decide antes e troca o modelo e o esforço.
- O número de WhatsApp com modelo fixo vence, e a SARA central nunca fica abaixo do nível padrão.
- O laço dá folga no limite de saída com o pensar adaptativo (8.000).
- Cada resposta grava `ferramentas.roteamento` e `ferramentas.custo_usd`, que vira a coluna `custo_usd`. O custo inclui as SARAs das áreas consultadas pela central e o classificador.
- **Teste real: 8 de 8.**
  - Só registrar: o modelo não muda e o nível fica anotado.
  - Ligado: a pergunta direta foi para o Haiku low (4 s, US$ 0,001) e a recomendação com risco para o Opus médio (34 s, US$ 0,23).
  - "e as do mês que vem?" herdou o critério.
  - A central ficou no Sonnet (9 s, US$ 0,06), com o custo das áreas somado.
- **Comparação do critério, mesma pergunta ("quais contas adiar se o caixa apertar"):**

  | Critério com | Tempo | Custo | Resultado |
  |---|---|---|---|
  | Sonnet alto | 21 s | US$ 0,11 | boa recomendação |
  | Opus médio | 42 s | US$ 0,14 | a mesma e mais dois achados de julgamento: o capital de giro do Itaú em aberto, e o total vencido inflado pelos lançamentos sem conciliar |

- **Decisão que fica com o proprietário:** critério no Opus médio (melhor julgamento, mais lento) ou no Sonnet alto (metade do tempo). Na voz e no WhatsApp, o tempo pesa mais.

## Etapas (QA e commit em cada uma; migração só com o "pode aplicar" do dono)
0. **Medição, sem mudar nada:** um script lê as perguntas dos últimos 60 dias em `sara_mensagens`.
   - Roda o classificador em cada uma e compara o custo real com o custo pela política padrão.
   - Separa amostras que subiriam para critério ou profundo, para o dono julgar a qualidade.
   - O relatório sai no Desktop e é aberto na tela. **Os padrões dos níveis só são fixados depois disso.**
1. **Catálogo e montador do pedido:**
   - catálogo com Opus e Fable, `pedidoPara` no lugar do `semPensar` em todas as chamadas, preços e reserva generalizada;
   - sem mudança de comportamento: os mesmos modelos de hoje;
   - teste de que nenhuma combinação do catálogo dá 400, mais uma chamada real por modelo.
2. **Política por empresa:** a migração (tabela da política, `custo_usd`, a permissão nova e o uso em reais), a leitura com padrão e a tela do proprietário.
3. **Classificador em modo sombra:** registra o nível que escolheria sem mudar o modelo. Depois de alguns dias de uso real, o dono liga.
4. **Liga o roteador e a escada de subida:** os trabalhos fixos passam pela política e o teto passa a ser em reais.
5. **Depois, se a medição mostrar ganho:** o nível profundo entregue de forma assíncrona (documento e sino) e o classificador fundido com o verificador de escopo.

## Arquivos principais
- **Novos:**
  - `lib/sara/nivel.ts`: classificador e regras;
  - `supabase/migrations/2026111x..._sara_politica_modelos.sql`;
  - `scripts/medir-nivel-sara.mjs`: Etapa 0, só leitura;
  - `tests/sara-roteador.test.mjs`.
- **Alterados:**
  - `lib/sara/modelos.ts`, `lib/sara/custo.ts`, `lib/sara/base.ts` (sai o `semPensar`);
  - `lib/sara/laco.ts`, `lib/sara/tentativas.ts`, `lib/sara/responder.ts`, `lib/sara/sessao.ts` (o `cfg`);
  - as chamadas auxiliares: `central/bom-dia.ts`, `vigia.ts`, `crescimento.ts`, `escopo.ts`, `conferir-saida.ts`, `memoria-pessoa.ts`, `habilidades.ts`, `central/voz-ao-vivo.ts`, `lib/tarefas/ler.ts`, `lib/contabil/sentinela/extracao.ts`;
  - `modules/access-catalog.ts`, `app/components/sara-aprendizado.tsx`, `app/api/sara/aprendizado/route.ts`;
  - `docs/ROADMAP.md` (I-32), `docs/PLANO-SARA-ROTEADOR.md` (este plano) e `lib/novidades.ts`.

## Verificação
- **Testes de unidade:**
  - o montador cobre cada modelo × esforço × ferramenta forçada, sem combinação que a API recusa;
  - a política aplica o padrão, o limite da permissão, a herança da continuação curta e a escada;
  - o custo em reais inclui as SARAs das áreas consultadas pela central.
- **Chamada real a cada modelo do catálogo:** Haiku, Sonnet, Opus e Fable, com e sem ferramentas, conferindo que não há 400.
- **Medição (Etapa 0):** relatório com o custo atual contra o projetado e as amostras.
- **Navegador:** usuários temporários com as permissões reais.
  - Com e sem a permissão profunda.
  - Perguntas reais, nunca o nome técnico da ferramenta: uma simples, uma de duas áreas, uma recomendação de pagamento e um "diagnóstico do trimestre".
  - Conferir o nível no "Como chegou", o custo no painel e a escada quando o verificador recusa.
  - Tela do proprietário em claro, escuro e celular.
- Suíte completa, tsc, lint e build numa cópia limpa.
