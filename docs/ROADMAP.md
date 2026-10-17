# Roadmap único — PecSil Business OS + Forja

> **Fonte única da ordem de construção.** Os planos de detalhe (Blueprint, Plano do Jev, custo e margem,
> orçamento, almoxarifado, Segundo Cérebro, Visão de produto e o roadmap da Forja) guardam o desenho
> técnico, as decisões e os critérios de aceite de cada item. **A ordem é decidida só aqui.**
>
> Criado em 16/10/2026 · Dono: proprietário da PecSil · Execução: Claude
> Painel visual: publicado a partir deste documento (seção 9).

---

## 0. Quadro de agora

**Em construção** (no máximo 3 frentes ao mesmo tempo)

| Item | O quê | Situação |
|---|---|---|
| I-01 | Unificação de fornecedores e clientes pelo Clef (Jev, Etapa 1) | Calibração; fila "para unificar" a partir de 17/10 |

**Próximos 5** — pela nota (seção 2), entre os itens que melhoram o PecSil com os portões abertos (17/10: white label e tenants ficam para depois). Os de nota maior que estão fora esperam uma dependência ou um OK; B-02, P-01, P-03, P-07 e C-08 foram adiados pelo proprietário em 16/10. Só sobram 3 itens do Marco 1 livres, então a fila completa com os do Marco 2

| Ordem | Item | O quê | Nota | Por que agora |
|---|---|---|---|---|
| 1 | B-09 | Infraestrutura documentada no Git (Coolify, serviços, variáveis sem os valores, rotina de recuperação) | 12,0 | Sem isso, uma pane no servidor depende de memória |
| 2 | B-11 | IP do login na auditoria (passa pelo proxy) | 8,0 | A trilha de auditoria fica completa |
| 3 | B-07 | Build fora do servidor e webhook de deploy | 7,0 | O build deixa de pesar no servidor da produção (muda o jeito do Deploy: OK do proprietário antes) |
| 4 | F-07 | Fluxo de caixa de 90 dias (cenários por regra) | 4,0 | A Ana vê o caixa à frente, não só o passado |
| 5 | A-08 | Equivalência de itens em cotações (revisto depois do A-01) | 3,3 | Comparativo de cotação mais preciso |

A fila de 17/10 (A-11, F-08, R-01, A-07, F-09) foi toda construída e está no ar (Deploy de `5e2e354` em 17/10, 23h29).

**Quem decide o quê** (regra de 16/10/2026): o proprietário cuida da **construção e dos recursos** da
plataforma: ordem do roadmap, acessos e permissões, infraestrutura, caixas de e-mail conectadas, uso e custo
da IA, deploy. **Decisão do negócio é de quem responde pela área**:

| Área | Quem decide |
|---|---|
| Financeiro | Ana |
| RH | Rosana |
| Almoxarifado | Henrique |
| Compras | quem aprova cotações (Domingo, Ricardo) |
| Fiscal e faturamento | Jefferson (com o contador nas regras fiscais) |
| Comercial, orçamento e PCP | Rafael |
| Fundição | Guilherme |

Na plataforma vale o mesmo: a decisão vai para a permissão da área (aprovar no Financeiro, aprovar
cotações, aprovar NF-e…), nunca para "só o proprietário".

**Travados** — o que destrava cada um

| Item | Travado por | Quem destrava |
|---|---|---|
| B-01 Perímetro do servidor | Senha SSH perdida | Proprietário (infraestrutura) |
| B-05 VPN · B-06 Porta 443 | Roteador e operadora; SSH | Proprietário (infraestrutura) |
| A-02 Estoque (saldo, custo médio, saída) | Decisões A4 e A5 | Henrique (A5) e Ana (A4, custo médio) |
| A-03 Inventário inicial | A3 e agenda da contagem física | Henrique |
| C-14 Microsoft 365 | Ação do administrador no tenant (caixa, app, escopo) | Administrador do M365 |
| F-01 Financeiro sem números fixos | Lista de "pequenos bugs" | Ana |
| F-03 Contas a pagar de BOLLORÉ em diante | Arquivo do relatório | Ana |
| K-02 a K-05 Custo e margem | Decisões D1 a D7 | Ana, Rafael, Rosana e Henrique (ver abaixo) |
| I-08 SARA | Fase 5 (custo e margem no ar) | — |

**Decisões pendentes** — cada uma com quem decide e o que destrava

| Decisão | Quem decide | Destrava | Origem |
|---|---|---|---|
| Reenviar o certificado A1 e homologar a NF-e — "não" em 16/10; reabrir quando o Fiscal quiser | Jefferson (Fiscal) | C-09 → C-10, C-12, C-13 | FISCAL-NFE |
| Número de WhatsApp dedicado (chip) para os alertas da plataforma e da Forja | Proprietário (recurso) | B-04, P-06 | 16/10 |
| Duas OS por item (fundição e usinagem)? | Rafael | C-13, P-08 | PLANO-ORCAMENTO, O1 |
| A3 contagem · A5 saída no balcão · A9 reposição · A10 locais | Henrique | A-02, A-03, A-05, A-06 | PLANO-ALMOXARIFADO |
| A4 custo do estoque (médio ponderado) | Ana | A-02 | PLANO-ALMOXARIFADO |
| A8 EPI do RH = material do almoxarifado | Rosana e Henrique | A-04 | PLANO-ALMOXARIFADO |
| Respostas das máscaras (UFs, B2, operações, quem edita) e Tema 69 | Jefferson, com o contador | C-11 | Máscaras de impostos |
| Lista de "pequenos bugs" do Financeiro | Ana | F-01, F-13 | Financeiro |
| Extrato do Bradesco de 03/07 a 05/10 | Ana | F-02 | Conciliação |
| D1 plano de contas e centros de custo · D4 rateio do indireto | Ana, com o contador | K-01, K-02, K-05, F-05, I-03 | PLANO-CUSTO-MARGEM |
| D2 custo-hora de máquina | Rafael e Ana | K-03 | PLANO-CUSTO-MARGEM |
| D3 custo da mão de obra (onde fica o salário) | Rosana e Ana | K-03 | PLANO-CUSTO-MARGEM |
| D5 consumo de material por OS | Rafael e Henrique | K-04 | PLANO-CUSTO-MARGEM |
| D6 data de corte (nada entra sem OS ou centro) · D7 histórico | Ana | K-02, K-05 | PLANO-CUSTO-MARGEM |
| Teto de uso de IA por setor (D6 do Segundo Cérebro) | Proprietário (custo da IA) | I-05, I-08 | PLANO-SEGUNDO-CEREBRO |
| Quem opera o Comercial · régua de cobrança | Rafael (Comercial) · Ana (cobrança) | C-15, C-16 | PROCESSOS-PECSIL, Cadeia 3 |
| Cadeia 2 (desligamento): bloqueio automático? Portaria lê os ativos? | Rosana | R-04 | PROCESSOS-PECSIL |
| Conciliação assistida pelo Clef: o extrato pode ir a serviço externo? | Ana (processo) e proprietário (dados para fora) | I-04 | PLANO-JEV, Etapa 4 |
| VERALLIA × "Verallia / Saint-Gobain – Campo Bom": mesma empresa? | Rafael | C-01 | Integração Forja |
| Histórico do ICMS (1.577 notas) — "ainda não" em 12/10 | Jefferson | — | Almoxarifado e Fiscal |
| Permissões: `fiscal.nfe` ao Jefferson, `operar` do quadro de terceiros ao RH, Homologação do Financeiro à Ana, Almoxarifado/ICMS à equipe | Proprietário (acessos) | Uso real; alçadas | Vários |
| Auditoria 0008 (esconder o rastro dos usuários de teste) | Proprietário (plataforma) | — | Auditoria central |

**Pedidos à equipe** (dados que não dependem de construção, mas destravam itens)

| Quem | O quê | Destrava |
|---|---|---|
| Jefferson | Exportações do GRV: clientes, orçamentos em aberto, últimos números (orçamento, OS, nota), movimentação de 12 meses, próximo número de cada grupo de material | C-01, C-13, A-03, A-10 |
| Jefferson e contador | Revisar os 844 materiais sem NCM e o plano de contas trocado (relatório na Área de Trabalho) | A-10 |
| Rafael | 758 produtos sem NCM; os 98 "produto acabado" no meio da matéria-prima; planilha da calculadora de caixa; os 28 modelos de cotação | C-02, C-07, C-06 |
| Henrique | Onde fica cada material; se a Fundição tem estoque separado | A-10, A10 |
| Ana | Revisar as sobras da conciliação e os 383 títulos "histórico a conferir" | F-04 |
| RH | 37 linhas recusadas do histórico, 10 pessoas do EPI sem CPF, 7 períodos de férias vencidas | R-02 |
| Chefe e PCP da Forja | Visita: crédito do "+1 peça", OPs rápidas, subetapas da fundição, status fiscais, CAB/LOC | P-04 |

---

## 1. Linha de chegada

**Marco 1 — GRV desligado.** Uma semana inteira de pedidos, OS, notas, compras, estoque e financeiro só pela
plataforma e pela Forja, sem voltar ao GRV. Os critérios de aceite estão na E8 do plano do orçamento e na M7 do
almoxarifado. Pré-requisitos fora da construção: NF-e em produção e a contagem física do estoque.

> **17/10/2026, decisão do proprietário:** primeiro fechar a construção do PecSil Business OS pronto e validado. Abertura de outras empresas (tenants) e venda white label ficam para depois: a raia Z está adiada e o Marco 2 só volta quando o proprietário decidir.

**Marco 2 — Pronta para escalar.** Uma segunda empresa de teste é criada do zero, sem nenhum código ou texto
da PecSil fixo:
- identidade, regras e numeração como configuração;
- isolamento por empresa testado;
- custo e margem no ar como prova de resultado;
- cadastro, cobrança e suporte da nova empresa, só quando o proprietário pedir.

Origem: `VISAO-PRODUTO-ESCALA` §6 e P3.1.

**Fora do caminho crítico (+).** Melhorias de valor que não aproximam nenhum marco. Entram quando a nota
justifica e nenhum item de marco com portão aberto está parado esperando.

---

## 2. Critério de construção

Cada item recebe quatro notas:

| Nota | O que mede | Escala |
|---|---|---|
| **V** valor | Quanto tira de trabalho manual ou de risco, e quantas pessoas ganham | 1 a 5 |
| **D** destrava | Quanto aproxima o marco do item (bloqueador direto = 5) | 1 a 5 |
| **E** esforço | Semanas de construção comigo (0,5 = poucos dias) | número |
| **R** risco | Dependência fora da construção: 1 nenhuma · 2 um OK ou um dado · 3 decisão, terceiro ou infraestrutura | 1 a 3 |

**Nota de prioridade = (V + 2·D) ÷ E.** Item com **R3** só entra na fila com a dependência resolvida.

**Como a fila é montada:**
1. Primeiro os itens do **Marco 1** com os portões abertos, pela nota.
2. Depois os do **Marco 2**.
3. Os itens **+** só quando abrir uma frente livre, e nunca mais de 3 frentes ao mesmo tempo.

**Portões** (valem acima da nota):
- **(a)** pré-requisito pronto;
- **(b)** decisão de quem responde pela área registrada, quando houver (quadro "Quem decide o quê", seção 0);
- **(c)** uso novo de IA registrado no Plano do Jev (o modelo só sugere e uma pessoa confirma; vai o
  mínimo de dados para fora, nunca CPF, extrato ou dado de saúde);
- **(d)** aceite verificado em produção antes de marcar como entregue.

**Mudar a ordem = mudar uma nota**, com o motivo no registro (seção 8).

---

## 3. Itens por raia

Situação: `no ar` · `em construção` · `próximo` · `na fila` · `adiado` (o proprietário tirou da fila) · `travado` · `decisão` · `não fazer`.
Marco: **1**, **2** ou **+**.

### B — Base (infraestrutura e segurança)

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| B-01 | Recuperar o SSH e fechar o perímetro (portas do Supabase, porta 80 da Forja) | 1 | 5 | 3 | 1 | 3 | 11,0 | travado | Senha SSH | INFRA-SSH/PERIM; BP Fase 0 |
| B-02 | Backup externo do banco e da Forja, com restore testado | 1 | 5 | 4 | 1 | 1 | 13,0 | adiado | — | INFRA-BACKUP; Forja H3 |
| B-03 | Cofre de segredos e troca das chaves | 1 | 4 | 2 | 1,5 | 2 | 5,3 | na fila | B-01 | VIS 6.3a |
| B-04 | Monitoramento com alertas pelo WhatsApp (canal compartilhado com o P-06) | 1 | 4 | 3 | 0,5 | 2 | 20,0 | decisão | Número de WhatsApp dedicado | INFRA-MON |
| B-05 | VPN: só o Business OS público | 1 | 4 | 2 | 1 | 3 | 8,0 | travado | Roteador | INFRA-VPN |
| B-06 | Estabilizar a porta 443 | 1 | 4 | 3 | 0,5 | 3 | 20,0 | travado | Operadora; SSH | INFRA-443 |
| B-07 | Build fora do servidor e webhook de deploy | 2 | 3 | 2 | 1 | 1 | 7,0 | não fazer (proprietário 17/10: o Deploy manual pelo painel está funcionando) | — | INFRA-BUILD; VIS P1.1e |
| B-08 | 2FA próprio dos administradores e trava por horário e por IP | 1 | 4 | 2 | 1 | 1 | 8,0 | adiado | — | Novo (16/10) |
| B-09 | Infraestrutura documentada no Git | 2 | 2 | 2 | 0,5 | 1 | 12,0 | feito ([INFRA.md](INFRA.md)) | — | INFRA-DOC |
| B-10 | Plano B: nobreak, link reserva, réplica do banco | 2 | 3 | 1 | 1 | 3 | 5,0 | travado | Compra | INFRA-PLANOB |
| B-11 | IP do login na auditoria (passa pelo proxy) | + | 2 | 1 | 0,5 | 1 | 8,0 | no ar (conferir em produção) | — | AUD-IP |

### C — Comercial e faturamento

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | Clientes completos: CNPJ de todos, unificar os repetidos | 1 | 4 | 4 | 1 | 2 | 12,0 | na fila | Exportação 1 | ORC E1 |
| C-02 | Produtos limpos: NCM dos 758, os 98 "produto acabado", próximo número dos grupos | 1 | 4 | 4 | 0,5 | 2 | 24,0 | pedido à equipe | Rafael | ORC E1; produtos da Forja |
| C-03 | Duas OS por item (fundição e usinagem)? | 1 | — | — | — | — | — | decisão | Rafael | ORC O1 |
| C-05 | Pedido do cliente → itens do orçamento (o texto sai por regra, o Clef sugere o produto, o Rafael confirma) | + | 5 | 2 | 2 | 2 | 4,5 | pronto, aguarda deploy | Registro no Jev | Novo (16/10) |
| C-06 | Cotação ao cliente em PDF/Excel pelos modelos | + | 4 | 2 | 2 | 2 | 4,0 | na fila | Os 28 modelos | ORC E6 |
| C-07 | Calculadora de caixa | 1 | 3 | 4 | 1 | 2 | 11,0 | na fila | Planilha do Rafael | ORC E7; O5 |
| C-08 | Nota de exportação | 1 | 4 | 5 | 1,5 | 1 | 9,3 | adiado | — | ORC O6 |
| C-09 | NF-e em homologação (reenviar o A1, SEFAZ, assinatura real) | 1 | 5 | 5 | 1 | 2 | 15,0 | decisão | OK do Fiscal ("não" em 16/10) | FISCAL-NFE |
| C-10 | NF-e em produção e ciência das notas recebidas | 1 | 5 | 5 | 0,5 | 2 | 30,0 | na fila | C-09 | FISCAL-NFE |
| C-11 | ST, DIFAL, regras do Jefferson e respostas das máscaras | 1 | 4 | 4 | 1,5 | 2 | 8,0 | decisão | Respostas | Máscaras; FISCAL-NFE |
| C-12 | Título a receber pelas duplicatas da nota autorizada | 1 | 5 | 5 | 1 | 1 | 15,0 | na fila | C-09 | ORC E5 |
| C-13 | Virada do GRV no comercial e fiscal (orçamentos em aberto, últimos números, apagar o treino) | 1 | 5 | 5 | 1 | 2 | 15,0 | na fila | C-10, C-12, exportações | ORC E8 |
| C-14 | Microsoft 365 (caixa comercial@, app, escopo, credenciais) | + | 4 | 2 | 0,5 | 3 | 16,0 | travado | Administrador do M365 | CONEXAO-EMAIL |
| C-15 | Caixa de entrada e classificação dos pedidos por e-mail | + | 4 | 1 | 2 | 3 | 3,0 | travado | C-14 | CRM E4; Jev E5 |
| C-16 | Cobrança: régua ligada ao Financeiro | + | 4 | 1 | 2 | 3 | 3,0 | decisão | Régua e operador | CRM E6; Jev E6 |
| C-17 | Ordem de compra lê o emitente da configuração fiscal | 2 | 2 | 4 | 0,5 | 1 | 20,0 | no ar (conferir em produção) | — | VIS 6.1a |

### A — Compras e almoxarifado

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| A-01 | Material ligado no fluxo de compra (de-para do código do fornecedor) | 1 | 4 | 4 | 2 | 1 | 6,0 | no ar (conferir em produção) | — | ALM M2 |
| A-02 | Estoque: saldo, custo médio, saída no balcão, kardex | 1 | 5 | 5 | 3 | 2 | 5,0 | decisão | A-01; A4, A5 | ALM M3 |
| A-03 | Inventário inicial por contagem | 1 | 5 | 5 | 1 | 3 | 15,0 | travado | A-02; A3; contagem | ALM M4 |
| A-04 | EPI ligado ao estoque (inclui o catálogo de EPI do Jev, Etapa 2) | 1 | 4 | 4 | 1,5 | 2 | 8,0 | decisão | A-02; A8 | ALM M5; Jev E2 |
| A-05 | Reposição: mínimo, máximo e solicitação sugerida | + | 4 | 2 | 1,5 | 2 | 5,3 | decisão | A-02; A9 | ALM M6 |
| A-06 | Virada do estoque (o GRV deixa de controlar) | 1 | 5 | 5 | 1 | 1 | 15,0 | na fila | A-01 a A-04 | ALM M7 |
| A-07 | Cotações: selos (preço, prazo, pagamento), regra "prazo depois preço" e saving na OC | + | 4 | 1 | 1 | 1 | 6,0 | no ar (conferir em produção) | — | Novo (16/10) |
| A-08 | Equivalência de itens em cotações | + | 3 | 1 | 1,5 | 2 | 3,3 | travado (portão do Jev) | Etapas 1 e 2 do Jev com aceite; o caminho por regra é o material do catálogo (A-01 + A-07) | Jev E7 |
| A-09 | Portal do fornecedor por link (decisão de 17/10: link por cotação, sem conta) | + | 4 | 1 | 3 | 1 | 2,0 | no ar (conferir em produção) | — | Novo (16/10) |
| A-10 | Dados do GRV para o estoque (movimentação, próximo número, locais, NCM) | 1 | 3 | 4 | 0,5 | 2 | 22,0 | pedido à equipe | Jefferson, Henrique | ALM §6 |
| A-11 | Lista de "parados há X dias" (cotação, pedido, rascunho de OS, nota), sem escalonar | + | 4 | 2 | 1 | 1 | 8,0 | no ar (conferir em produção) | — | Novo (16/10) |

### P — Produção (Forja)

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | Roteiro-padrão aplicado em massa por tipo de peça | 1 | 5 | 5 | 1,5 | 1 | 10,0 | adiado | — | Forja 6c-D |
| P-02 | Serviço de terceiros por operação (campos prontos; falta a tela) | 1 | 4 | 4 | 0,5 | 1 | 24,0 | pronto, aguarda deploy | — | Forja 6c-B |
| P-03 | Horas previstas e previsto × realizado | 1 | 4 | 3 | 1 | 1 | 10,0 | adiado | — | Forja 6c-C |
| P-04 | Visita ao PCP e validação com 5 OS reais (Forja × GRV) | 1 | 5 | 5 | 0,5 | 2 | 30,0 | na fila | P-01, P-02; agenda da visita | Forja v5.1 |
| P-06 | Alertas por WhatsApp e SLA por etapa, com horário silencioso (um canal só, servindo a Forja e o Business OS) | + | 4 | 2 | 2 | 2 | 4,0 | na fila | Número oficial | Forja Sprint 7 |
| P-07 | Hardening da Forja (limite de requisições, CORS, chave JWT única, logs) | 1 | 4 | 3 | 1 | 1 | 10,0 | adiado | — | Forja Sprint 7 |
| P-08 | Go-live da Forja (paralelo, critérios de liberação) | 1 | 5 | 5 | 1 | 2 | 15,0 | na fila | P-01 a P-04 | Forja v5.1 |
| P-09 | Painel financeiro do PCP | — | — | — | — | — | — | decisão | Foi coberto pelo "A faturar"? | Forja 6b |
| P-10 | OEE (SpindleOps) | + | 4 | 1 | 3 | 2 | 2,0 | na fila | P-08 | Forja Fase 2 |
| P-11 | Visualizador de desenhos e migração da pasta física | + | 3 | 1 | 2 | 1 | 2,5 | na fila | — | Forja Fase 2 |
| P-12 | Inteligência da produção (previsão de prazo, gargalo) | + | 4 | 1 | 4 | 2 | 1,5 | na fila | P-10 | Forja Fase 3 |
| P-13 | Causa-raiz dos motivos de parada | + | 3 | 1 | 1 | 2 | 5,0 | decisão | Taxonomia | Jev E8 |

### F — Financeiro

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | Financeiro sem números fixos: lista de bugs (a branch de recebíveis já está no main, 34db4ae) | 1 | 5 | 5 | 1 | 2 | 15,0 | decisão | Lista da Ana | BP Fase 3; VIS P1.1d |
| F-02 | Commits pendentes: classificador do Santander, Bradesco, conta garantida | 1 | 4 | 3 | 0,5 | 2 | 20,0 | decisão | Extrato do Bradesco (Ana) | Conciliação |
| F-03 | Contas a pagar de BOLLORÉ em diante | 1 | 3 | 3 | 0,5 | 3 | 18,0 | travado | Arquivo | Carga legada |
| F-04 | Revisão das sobras e dos históricos a conferir | 1 | 4 | 4 | 0,5 | 2 | 24,0 | pedido à equipe | Ana | Carga legada |
| F-05 | Centros de custo e cadastros financeiros reais | + | 4 | 2 | 1 | 3 | 8,0 | decisão | D1 | CM E1 |
| F-06 | Alçadas de aprovação e baixa parcial ou reversível | 1 | 4 | 3 | 1,5 | 1 | 6,7 | no ar (conferir em produção) | — | BP Fase 3 |
| F-07 | Fluxo de caixa de 90 dias (cenários por regra; a explicação fica para a SARA) | + | 4 | 2 | 2 | 1 | 4,0 | no ar (conferir em produção) | — | BP Fase 3 |
| F-08 | Conciliação: regra com CNPJ e explicação da divergência (sempre com confirmação) | + | 3 | 2 | 1 | 1 | 7,0 | no ar (conferir em produção) | — | Conciliação |
| F-09 | Portal do escritório, Entrega B (guias viram contas a pagar) | + | 4 | 2 | 1,5 | 1 | 5,3 | no ar (conferir em produção) | — | Portal do escritório |
| F-10 | Pix e boleto registrados, Open Finance | + | 4 | 1 | 5 | 3 | 1,2 | decisão | Escolher o banco | Novo (16/10) |
| F-13 | Homologação do Financeiro com a Tesouraria | 1 | 5 | 5 | 1 | 2 | 15,0 | na fila | F-01 | BP Fase 3 |

### R — RH

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | Fechar a Fase 2 (sem mocks, testes, homologar com 2 perfis) | 2 | 4 | 3 | 1,5 | 1 | 6,7 | no ar (conferir em produção) | — | BP Fase 2 |
| R-02 | Dados do RH (37 linhas, 10 sem CPF, 7 férias vencidas) | + | 3 | 1 | 0,5 | 2 | 10,0 | pedido à equipe | RH | Importações do RH |
| R-03 | Função define as exigências (EPI, exames, validades) e mapa de férias por setor | + | 4 | 1 | 2 | 1 | 3,0 | no ar (conferir em produção) | — | BP Fase 2 |
| R-04 | Cadeia 2: desligamento | + | — | — | — | — | — | decisão | Q1, Q2 | PROCESSOS-PECSIL |

### I — IA (Clef, Jev, Segundo Cérebro, SARA)

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| I-01 | Unificação de fornecedores e clientes | + | 4 | 2 | 1 | 1 | 8,0 | em construção | — | Jev E1 |
| I-03 | Classificação de gastos (conta e centro) | + | 4 | 1 | 1,5 | 3 | 4,0 | decisão | F-05 | Jev E3 |
| I-04 | Conciliação assistida | + | — | — | — | — | — | decisão | Privacidade do extrato | Jev E4 |
| I-05 | Segundo Cérebro em uso real (coleta e triagem pelo Clef) | + | 3 | 1 | 1 | 2 | 5,0 | na fila | D6 | Segundo Cérebro |
| I-07 | Religar a Busca Corporativa com os dados dos módulos | + | 3 | 1 | 2 | 1 | 2,5 | na fila | — | Busca |
| I-08 | SARA nível 1: perguntas cruzando módulos, com as permissões de cada um | 2 | 5 | 3 | 4 | 3 | 2,8 | travado | Fase 5 (K-05) | BP Fase 6 |
| I-09 | SARA níveis 2 a 4 e voz | 2 | 5 | 2 | 6 | 3 | 1,5 | travado | I-08 | BP Fase 6 |
| I-10 | "Como faço?" (encaminhar a pergunta para a tela certa) | + | 3 | 1 | 1 | 3 | 5,0 | travado | I-08 | Jev E9 |
| I-11 | Tutoriais em vídeo (piloto do orçamento) | + | 3 | 1 | 1 | 2 | 5,0 | decisão | HeyGen? | Tutoriais |

### K — Custo e análise

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| K-01 | Decisões D1 a D7 | 2 | — | — | — | — | — | decisão | — | CM §3 |
| K-02 | Fio da OS: centro e OS obrigatórios nas cotações, compras e títulos | 2 | 4 | 4 | 1,5 | 3 | 8,0 | travado | D6; F-05 | CM E4 |
| K-03 | Custo-hora de máquina e de pessoa | 2 | 4 | 4 | 2 | 3 | 6,0 | travado | D2, D3 | CM E5 |
| K-04 | Consumo de material por OS | 2 | 4 | 4 | 1 | 3 | 12,0 | travado | D5; A-02 | CM E6 |
| K-05 | Custo e margem e dicionário de KPIs (1ª entrega da Fase 5) | 2 | 5 | 5 | 3 | 3 | 5,0 | travado | K-02 a K-04; D4 | CM E7 |
| K-06 | Margem na cotação e preço mínimo | 2 | 4 | 3 | 1,5 | 1 | 6,7 | na fila | K-05 | CM E8 |
| K-07 | Painel executivo cruzado no celular | 2 | 4 | 3 | 2 | 1 | 5,0 | na fila | K-05 | VIS P2.1 |
| K-08 | Linha de base "antes × depois" (registrar antes da virada) | 2 | 4 | 4 | 0,5 | 1 | 24,0 | no ar (conferir em produção) | — | VIS P3.2 |

### Z — Produto (multiempresa)

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| Z-01 | Fundação testada: contrato, isolamento por empresa, status "Homologado" | 2 | 4 | 5 | 1 | 1 | 14,0 | adiado (white label) | — | BP Fase 1 |
| Z-02 | Tudo da empresa como configuração (marca, setores, triagem, conector da Forja, cookie) | 2 | 4 | 5 | 3 | 1 | 4,7 | adiado (white label) | Z-01 | VIS 6.1 |
| Z-03 | Design System extraído (RH no DS) | 2 | 3 | 3 | 2 | 1 | 4,5 | adiado (white label) | — | BP D2 |
| Z-04 | Blueprint atualizado (stack real, os 10 domínios) | 2 | 2 | 2 | 0,5 | 1 | 12,0 | adiado (white label) | — | BP D3, D4 |
| Z-05 | Cadastro, cobrança e suporte da nova empresa | 2 | — | — | — | — | — | adiado (white label) | Pedido do proprietário | VIS 6.2 |
| Z-06 | Reações entre módulos (cadeias confirmadas) | + | 4 | 2 | 3 | 3 | 2,7 | adiado (white label) | Cadeias 2 e 3 | VIS P2.3 |

---

## 4. Entregue (histórico)

| Quando | O quê | Commit |
|---|---|---|
| 16/10 | Compras só com o menu lateral; "Pedidos almoxarifado" | `f21cf52` |
| 15–16/10 | Treino também cria o rascunho TREINO na Forja | `9eaf076` · Forja `724b25c` |
| 15–16/10 | Catálogo de materiais (9.340), OS em rascunho na Forja, lista de materiais, teto de faturamento só no pedido | `e3bbbe9` · Forja `4ab26b2` |
| 15/10 | "Abrir orçamento" no A faturar; produtos sem o corte em 1000 | `b8ebacb` |
| 15/10 | Produtos da Forja (3.902) e busca no item do orçamento | `e5a78a1` |
| 15/10 | Digital no celular e no tablet; app no tablet; menus em ordem alfabética | `37b847e` · `034ddc7` · `ebf694a` |
| 15/10 | Treino do orçamento ao faturamento; máscaras de impostos | `4bba7a9` · `ff31033` |
| 14/10 | Compras diretas; quadro de terceiros | `c145cff` · `dda5160` · `608ef71` |
| 13/10 | Orçamentos e faturamento; NF-e no treino e NFS-e; destinatário pelo cadastro; auditoria central | `76e0916` · `9553b7f` · `b842fdf` · `205801e` |
| 12/10 | Base da NF-e (transmissor, Vault, notas recebidas); entrar com a digital; fornecedores com CNPJ | `d672877` · `26d8246` · `f950bae` |
| 10–11/10 | Segundo Cérebro (coleta, leitura, ligações, busca); modelo de decisão (Clef) | `bc14397`…`2dec6a2` · `5a1e35c` |
| 09/10 | Pedidos da Fundição; ordem de compra | `ab8d9b9` · `1382aa4` |
| 01–08/10 | Fluxo Compras → Almoxarifado → Financeiro → ICMS; conciliação Itaú, Santander e Bradesco | `6affba4` · `238cde9` · `dcf00fa` · `35b37fa` |
| 27–30/09 | Compras na nuvem, Portaria, RH (terceiros, SST), contas a receber | `1601c24` · `4d1f348` · `09b13b6` · `34db4ae` |

---

## 5. Não fazer (decidido)

| O quê | Por quê |
|---|---|
| Folha de pagamento | O escritório contábil faz (BP §8) |
| Contabilidade própria | O escritório contábil faz; o portal liga vocês a ele |
| Conciliar sozinho | O proprietário escolheu "sobras vão para revisão" |
| SARA como chatbot sobre o ERP | BP §8 |
| Module Builder e personalização por conversa agora | BP Fase 7; nem o GRV liberou |
| Composio como hub agora; nunca no e-mail do Comercial | Integrações ficam nativas |
| IoT e DNC nas máquinas | Depende de hardware; o Tótem cobre |
| RFID como solução primária; `travaMaquina` | Decisões da Forja |
| Regras de aprovação escritas por frase | As regras da PecSil são poucas e fixas |

---

## 6. Desduplicações

| Assunto | Fica assim |
|---|---|
| SLA e WhatsApp | Um item só (P-06), da Forja, servindo também o Business OS |
| Lista de materiais | Vive na Forja (no ar); a E7 do orçamento fica com a calculadora de caixa (C-07) |
| Conciliação | Regra (F-08) agora; a assistida (I-04) depende de decisão; "sozinha" é `não fazer` |
| Painel executivo | VIS P2.1 = Fase 5 do Blueprint = K-07 |
| Equivalência em cotações | Jev E7 (A-08), revista depois do catálogo ligado nas compras (A-01) |

---

## 7. Regras de manutenção

1. Toda entrega atualiza a situação do item **no mesmo commit**.
2. Item novo só entra com as quatro notas, o marco e a raia.
3. Os planos de detalhe **não têm mais a sua própria ordem**: cada um aponta para este documento. Decisões e
   aceites continuam neles.
4. O quadro de agora (seção 0) é revisto a cada entrega: no máximo 3 frentes em construção.
5. Mudar a ordem é mudar uma nota, com o motivo no registro.

---

## 8. Registro

| Data | O que mudou | Quem |
|---|---|---|
| 16/10/2026 | Roadmap único criado: Marco 1 (GRV desligado) e Marco 2 (pronta para escalar); critério (V + 2·D) ÷ E e portões; os planos de detalhe passam a apontar para cá | Proprietário |
| 16/10/2026 | Entram os itens novos da comparação com o GRV Max: A-07, C-05, A-11, B-08, A-09 e F-10. Os 14 da lista ficam assim: 1 C-05 · 2 A-07, A-08 · 3 A-11, P-06 · 4 B-08 · 5 A-09 · 6 I-08 · 7 F-07 · 8 F-08, I-04 · 9 I-10 · 10 K-05, K-06, P-03 · 11 P-10 · 12 R-03, A-04 · 13 P-06 · 14 F-10 | Proprietário |
| 16/10/2026 | P-02 construído na Forja (branch `feat/terceiros-operacao`): tela de terceiros na operação do artigo e a correção da aba de lotes, que mostrava toda OP como interna; teste de navegador 15/15 | Claude |
| 17/10/2026 | F-09 construído: o escritório (ou o Fiscal) envia o PDF da guia no portal, a plataforma lê tipo, valor, vencimento e linha digitável por regra (valor conferido com o código de barras), quem envia confere e a guia vira conta a pagar EM APROVAÇÃO; aviso para quem aprova contas a pagar; guia repetida recusada; cancelamento com motivo enquanto não paga; o escritório vê só a situação do pagamento. Migração 202610170005 aplicada; teste de navegador 17/17 (contador, empresa e Financeiro) | Claude |
| 17/10/2026 | Deploy de `5e2e354` (A-01, A-11, F-08, R-01, A-07, F-09 e tudo o que estava no main): terminou 23h29 | Proprietário |
| 17/10/2026 | B-07 (build fora do servidor) sai: o proprietário faz o Deploy manual pelo painel e está funcionando | Proprietário |
| 17/10/2026 | Cargas do GRV (pedido do proprietário): 543 fornecedores completados pela exportação FORNECEDORES.xlsx, só campos vazios (CNPJ 30→519, endereço 16→534, e-mail 16→414…), sem pessoa física, ambíguos e novos para o Compras decidir (relatório); 3.123 itens do ATIVO IMOBILIZADO.xlsx no catálogo, inativos e sem estoque pela decisão A7 (12.463 materiais). 10 fornecedores duplicados (mesmo CNPJ) ficam para a unificação I-01 | Proprietário / Claude |
| 17/10/2026 | C-05 construído: "Ler pedido do cliente" no orçamento. Leitura por regra do pedido (testada no PDF real da O-I: 5 itens, preço "por 100", soma igual ao total), cliente pelo CNPJ ou pelo nome escrito no pedido, produto por de-para do código do cliente, depois artigo + tipo (prefixo) + material, depois descrição; ao confirmar grava o de-para. Clef registrado DESLIGADO no Plano do Jev (Etapa 10), só desempata candidatos com as descrições. Migração 202610170011 aplicada; teste de navegador 15/15. A tabela de prefixos (BM, BL, BP, BF) é proposta: decisão do Rafael | Claude |
| 17/10/2026 | Deploy de `95e1c67` (B-11, F-07, R-03 e A-09) | Proprietário |
| 17/10/2026 | A-09 construído com a decisão do proprietário (link por cotação, sem conta, no lugar da conta de terceiro): o Compras convida o fornecedor a partir do pedido de material; o fornecedor responde sem login (preço, IPI, quantidade, prazo, frete, pagamento e PDF), uma vez, dentro da validade; vira cotação pendente ligada ao pedido. Sem IA: o fornecedor digita, o PDF é a prova. Só o hash do link fica no banco. Migração 202610170010 aplicada; teste de navegador 19/19. Achado: só 2 pedidos de material no sistema contra 234 cotações; o portal e o comparativo rendem quando o pedido passar a ser feito pela plataforma (decisão do Compras e do Almoxarifado) | Claude / Proprietário |
| 17/10/2026 | R-03, parte 2: mapa de férias por setor (12 meses: pessoas fora por mês e parte do setor, prazo de concessão vencendo no mês, vencidos à parte) no lugar do "Calendário consolidado", que tinha o período fixo no código (julho a setembro de 2026). Migração 202610170009 aplicada; teste de navegador 9/9. Achado para o RH: 7 saldos com o prazo vencido, alguns de 2000–2001 (provável gozo não lançado) | Claude |
| 17/10/2026 | R-03, parte 1: exigências por função (EPI do catálogo, exame, treinamento, com validade) em RH › Saúde e segurança; 193 sugestões em 40 funções pela regra "entregue a ≥ metade da função em 12 meses", confirmáveis em lote; pendências por colaborador. Decide quem aprova SST (permissão da área; o proprietário não decide pelo RH). Migração 202610170008 aplicada; teste de navegador 13/13. Validades dos EPIs: decisão da Rosana | Claude |
| 17/10/2026 | A-08 revisto depois do A-01: comparar itens pelo texto erra (nas cotações reais os pares mais parecidos são produtos diferentes: parafuso M8×16 × M8×12, blank do art. 563993 × 563992), então não entra regra de texto. A equivalência por regra é o material do catálogo ligado na compra (A-01), que o comparativo do A-07 já usa. A parte do Clef (pares de descrição) fica travada pelo portão do Plano do Jev (Etapas 1 e 2 sem aceite). Achado: das 234 cotações, só 1 está ligada a um pedido de material, então o comparativo ainda não teve caso real | Claude |
| 17/10/2026 | F-07 construído: Fluxo de caixa abre nos próximos 90 dias, do saldo dos bancos pelo extrato, em três cenários por regra (conservador: recebe 15 dias depois, vencido a receber fora, previsões de saída; pelo vencimento; otimista), regras ajustáveis na tela sem gravar, saldo de hoje digitável para conta com extrato atrasado, semana a semana com as maiores parcelas e aviso do que distorce (R$ 1,06 mi a pagar vencido, antigos e previsões velhas fora). Migração 202610170007 aplicada; teste de navegador 14/14. Regras padrão: decisão da Ana | Claude |
| 17/10/2026 | B-11 construído: o GoTrue v2.189.0 grava o login com o IP vazio de propósito (nenhum dos 6.996 registros desde 01/09 tem IP); a plataforma passa a guardar o IP que o Traefik entrega (último do X-Forwarded-For) e o aparelho, no login por senha (gateway /sb) e pela digital, e a Auditoria mostra "IP …" no login. Migração 202610170006 aplicada; teste de navegador 6/6 | Claude |
| 17/10/2026 | B-09 feito: `docs/INFRA.md` (topologia, portas, serviços com os ids do Coolify, nomes das variáveis, tarefas agendadas, migrações, recuperação por tipo de pane, lacunas), conferido pela API do Coolify. Achados: Coolify aberto em HTTP na porta 8001 pública; senha do Postgres e chaves do MinIO da Forja vazias no Coolify; nenhum backup dos bancos | Claude |
| 17/10/2026 | Nova fila, pela nota, entre os itens com portões abertos: B-09, B-11, B-07, F-07, A-08 | Claude |
| 17/10/2026 | A-07 construído: "precisa até" no pedido de material, comparativo na cotação (selos de preço, entrega e pagamento; regra entrega no prazo e depois menor custo), economia gravada na aprovação e impressa na OC. Migração 202610170004 aplicada; teste 7/7 | Claude |
| 17/10/2026 | R-01 construído: RH sem caminho de demonstração (ação sem banco vira erro), cartão de SST calculado, conferência de documento gravada, aba Homologação real (critérios, conferência dos dados, registro por perfil). Migração 202610170003 aplicada; teste com dois perfis de RH 9/9. Homologação final: Rosana e Bianca (precisam da permissão Homologação do RH) | Claude |
| 17/10/2026 | A-11 (Fundação › Parados, migração 202610170002 aplicada, teste 4/4) e F-08 (conciliação: CNPJ nas sugestões, motivo de cada uma, explicação da linha sem par, pares de mesmo CNPJ e valor para confirmar em lote; sem migração) construídos. Achado: consultas do Financeiro paravam em 1.000 linhas (limite do Supabase) e passaram a ler em páginas | Claude |
| 17/10/2026 | Foco só no PecSil até o projeto pronto e validado; raia Z (tenants, white label) adiada. Fila: A-11, F-08, R-01, A-07, F-09 | Proprietário |
| 17/10/2026 | A-01 construído: material do catálogo na solicitação, cotação, compra, compra direta e recebimento; de-para por fornecedor (CNPJ + código → material, com fator de unidade); tela Almoxarifado › Ligar histórico (420 textos, sugestão por regra). Migração 202610170001 aplicada (17/10); teste de navegador 8/8. Aceite: Henrique e o Compras com dados reais | Claude |
| 16/10/2026 | Deploy de `fffcfe8` (F-06, C-17, K-08 e decisões por área); avisos de revisão da linha de base enviados à Ana, Domingo, Ricardo e Rafael | Proprietário / Claude |
| 16/10/2026 | **Decisões vão para a área, não para o proprietário** (pedido dele): quadro "Quem decide o quê"; D1–D7 e A3–A10 redistribuídas; na plataforma (migração 0008) a linha de base é revisada por área, numeração e treino do orçamento são do Comercial, ligar a NF-e em produção é de quem aprova NF-e, e as alçadas não têm mais exceção do proprietário | Proprietário |
| 16/10/2026 | Migrações 202610160005 a 0007 aplicadas; linha de base registrada (corte 16/10, 14 indicadores; revisão e correção pela tela Fundação › Linha de base, a pedido do proprietário); teste de navegador 22/22 | Proprietário / Claude |
| 16/10/2026 | C-17, F-06 e K-08 construídos e testados em transação desfeita na produção (migrações 202610160005 a 0007, aguardam o OK); A-01 começa | Claude |
| 16/10/2026 | B-08 também adiado; começa a construção de F-06, A-01, K-08 e C-17 | Proprietário |
| 16/10/2026 | B-02, P-01, P-03, P-07 e C-08 adiados pelo proprietário ("nenhum se aplica agora"). Nova fila: B-08, F-06, A-01 (Marco 1) e K-08, C-17 (Marco 2) | Proprietário |
| 16/10/2026 | Respostas do proprietário: alerta do B-04 pelo WhatsApp (precisa de número dedicado, mesmo canal do P-06); C-09 "não" por ora. Fila refeita: B-02, P-01, P-03, P-07, C-08 | Proprietário |
| 16/10/2026 | Certificado A1 confirmado (enviado e removido em 13/10 de propósito); C-09 só depende do OK | Proprietário |

---

## 9. Painel

O proprietário não acompanha painel (16/10): quem segue este roadmap é o Claude, e o andamento é reportado
na conversa de trabalho. O painel só é regerado quando pedido.

- Endereço: https://claude.ai/artifact/XQv2ZVFfz8RGBiPXGwUnVz (privado; compartilhar pelo menu da página)
- Gerar: `node scripts/roadmap-painel.mjs <saida.html>` e republicar o arquivo no mesmo endereço
