# Plano da SARA principal — a mindmaster da PecSil (E7)

> Etapa E7 do plano "o que absorver da LIA/TOTVS" (ROADMAP I-19). Desenho das duas camadas: [PLANO-SARA §0](PLANO-SARA.md).
> Onde ela mora: [PLANO-WAR-ROOM-CEREBRO §4](PLANO-WAR-ROOM-CEREBRO.md) (War Room › Conselho).
>
> Criado em 23/10/2026 · Dono: proprietário da PecSil · Execução: Claude · **Situação: aguarda aprovação**

---

## 0. O que é

Hoje cada módulo tem a sua SARA, que responde sobre o módulo e traz dados de outros quando a credencial
de quem pergunta permite. Falta a **SARA principal**: a que recebe a pergunta da empresa inteira,
divide o trabalho entre as SARAs dos módulos, junta as respostas e entrega uma só, com as fontes.

Exemplo: *"O atraso da Fundição vai apertar o caixa do mês?"*
1. A principal entende que precisa da Fundição (pedidos atrasados), da Produção (OS paradas), do Compras
   (o que está por comprar) e do Financeiro (fluxo de caixa de 90 dias).
2. Pergunta às quatro **ao mesmo tempo**, cada uma com as consultas dela e com a sessão de quem perguntou.
3. Confere os números, junta e responde, mostrando de qual SARA e de qual tela veio cada número.

É o "orquestrador" que a LIA mostrou, com as quatro IAs dela:

| Na LIA | Aqui |
|---|---|
| IA que busca dados no sistema | as SARAs dos módulos, chamadas como subagentes |
| IA que lê imagens | a foto vai para a SARA do módulo certo, que já lê imagem (E2) |
| IA que traz as regras do negócio | os documentos do Segundo Cérebro, os processos e o "quem decide o quê" |
| IA que confere os dados | o verificador: todo número da resposta final tem de estar no que as SARAs devolveram |
| IA central que coordena | a principal (Sonnet 5.5) |

## 1. Regras que não mudam

- **A credencial é o único limite.** A principal não vê nada a mais. Cada SARA chamada roda com a sessão
  de quem perguntou; sem o módulo, ela não é chamada e a resposta diz "sem permissão para…".
- **Número só com fonte.** O verificador corta ou marca o número que não veio de uma consulta.
- **Opinião é opinião.** No modo conselho, cada parecer aparece como opinião da IA, com a confiança à
  vista, nunca como dado apurado (regra do Jev/Clef).
- **Ação continua com Permitir.** Se a resposta pede uma ação, a principal pede à SARA do módulo que a
  prepare, e o cartão Permitir é o mesmo da E1.
- **Decisão do negócio é da área.** A principal recomenda e diz quem decide (o "quem decide o quê" do
  ROADMAP §0). Não decide pela Ana, pelo Henrique ou pelo Rafael.

## 2. Os dois modos

| Modo | Quando | O que faz |
|---|---|---|
| **Pergunta** | "quanto…", "quais…", "o que está…", "vai apertar…" | Divide, pergunta às SARAs em paralelo, confere e junta. Resposta com fontes. |
| **Conselho** | "devemos…", "vale a pena…", "o que você recomenda…" | Cada especialista dá um parecer curto, com a confiança: o **CFO** (Financeiro), **Operações** (Produção, Fundição, Almoxarifado), **Compras**, **Comercial**, **Pessoas** (RH) e **TI**. A principal mostra onde eles concordam, onde divergem, a recomendação e quem decide. |

No modo conselho, os especialistas pensam mais (*extended thinking*). Por isso esse modo custa mais e
só é usado quando a pergunta pede opinião.

## 3. Etapas

| # | Etapa | Entrega |
|---|---|---|
| **M1** | Orquestrador e subagentes | A principal em **War Room › Conselho**. Ferramenta `perguntar_a_sara(modulo, pergunta)` para cada módulo que a pessoa tem; as chamadas rodam em paralelo, com a sessão dela; a resposta junta tudo com as fontes de cada SARA. Conversa registrada como as outras, com o custo. |
| **M2** | Verificador | Todo número da resposta final é conferido com o que as SARAs devolveram. O que não bate é marcado ("sem fonte") ou sai. Também confere período e unidade. |
| **M3** | Conselho | Modo opinião: pareceres dos especialistas com a confiança, as divergências, a recomendação e quem decide. |
| **M4** | Ações e guias | A principal pede às SARAs dos módulos que preparem ações (cartões Permitir). Guias da principal, como "toda segunda, o resumo da empresa", no mesmo mecanismo da E3. |
| **M5** | Regras e grafo | Documentos do Segundo Cérebro e processos como fonte de regra do negócio; `mostrar_grafo` (G6): "mostre do que a Fundição depende". |

Cada etapa com testes (unitários, navegador com usuários temporários e as permissões reais, SARA real
com perguntas conferidas no banco) antes da seguinte.

## 4. Custo

- A principal usa o Sonnet 5.5; as SARAs dos módulos continuam com os modelos delas (Haiku; a TI com o
  Sonnet). Uma pergunta da empresa inteira faz de 2 a 5 chamadas. Estimativa: de 5 a 15 vezes o custo de
  uma pergunta a uma SARA de módulo. No modo conselho, mais.
- Teto próprio por mês (como o das SARAs dos módulos), aviso aos 80% e custo em R$ no painel do
  proprietário (E4).

## 5. Decisões do proprietário (para aprovar)

| # | Decisão | Proposta |
|---|---|---|
| **MM1** | Onde a principal mora | **War Room › Conselho** (como no plano da War Room). |
| **MM2** | Quem usa | **Só o proprietário por enquanto** (W1). Ricardo, Domingo e os demais do conselho entram quando o proprietário liberar, em Pessoas e Acessos. |
| **MM3** | Modelos | Principal no **Sonnet 5.5**; especialistas do modo conselho com *extended thinking*. |
| **MM4** | Teto do mês | Proposta inicial de **R$ 150 por mês**, com aviso aos 80%. Pela conta da E4, uma pergunta da empresa inteira sai por volta de R$ 0,50 (Sonnet na principal, Haiku nas SARAs, com o cache), ou seja, cerca de 300 perguntas no mês; o modo conselho custa de 2 a 3 vezes mais. |
| **MM5** | Ordem | **M1 → M2 → M3 → M4 → M5**, uma etapa de cada vez, com o "pode" antes de cada migração. |
