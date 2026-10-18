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
| S3 | O modelo que conversa é o **Claude (Anthropic)**: Haiku 5.5 no dia a dia, Sonnet 5.5 para análise. O Clef segue nas decisões rápidas (ele não escreve texto). |
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
| Liga e desliga | Cada SARA nasce **desligada**; o proprietário liga por módulo e define o **teto de uso** (tokens por mês). Com o teto atingido, a SARA avisa e para. |
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
- Nada de ação que grava no nível 1.
- Uso novo de IA é registrado no Plano do Jev antes de entrar.
- Dado pessoal e de saúde não vai ao modelo.
