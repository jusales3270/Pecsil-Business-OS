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
| Compras: aprovar cotações | quem aprova cotações (Domingo, Ricardo) |
| Cadastro de fornecedores (completar, unificar, incluir) | a equipe de Compras e o Rafael |
| Fiscal e faturamento | Jefferson (com o contador nas regras fiscais) |
| Comercial, orçamento e PCP | Rafael |
| Fundição | Guilherme |
| TI: regras do módulo, chamados, causa das quedas, ferramentas (monitoramento, acesso remoto) | Cesar Augusto Santos (supervisor de TI, confirmado em 19/10) |

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
| Nobreak gerenciável (modelo atual?) e onde roda o vigia externo (nuvem ou Raspberry Pi); canal de alerta (Telegram ou WhatsApp) | Proprietário (recurso) | T-01, T-03 | PLANO-TI §2, §3.1 |
| Servidor tem iDRAC/iLO/IPMI? BIOS com religamento automático? Existe link reserva? RustDesk ou MeshCentral? | Cesar (supervisor de TI) | T-01, T-04, T-05 | PLANO-TI §11 |
| Categorias e prazos dos chamados de TI (entraram provisórios: 10 categorias; urgente 4 h, alta 8 h, normal 24 h, baixa 72 h) e se o prazo para em "aguardando" | Cesar (supervisor de TI), em TI › Regras | T-06 | PLANO-TI, T-06 |
| Liberar o IP de saída da nuvem do vigia (100.60.102.71) no firewall da fábrica, para religar os testes de fora | Cesar (supervisor de TI) | T-03 | VIGIA-EXTERNO |
| Auditoria 0008 (esconder o rastro dos usuários de teste) | Proprietário (plataforma) | — | Auditoria central |
| A PecSil entrega com frota e motoristas próprios (quantos veículos)? Quem responde pela expedição e decide como as entregas são operadas? | Proprietário (indica a área) | L-01 a L-03 | Debate 19/10 |
| Regra de privacidade do rastreio do motorista (quando o GPS fica ligado, ciência por escrito) | Rosana (RH) | L-03 | Debate 19/10 |

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
| B-02 | Backup externo do banco e da Forja, com restore testado | 1 | 5 | 4 | 1 | 2 | 13,0 | no ar (= T-02, 19/10; Forja ainda fora) | Papel backup_leitura; projeto na nuvem | INFRA-BACKUP; Forja H3; BACKUP-EXTERNO |
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
| C-01 | Clientes completos: CNPJ de todos, unificar os repetidos | 1 | 4 | 4 | 1 | 2 | 12,0 | em construção (18 completados pelo GRV, 15 prontos para NF-e; fábricas, duplicados e novos com o Rafael) | Exportação 1 | ORC E1 |
| C-02 | Produtos limpos: NCM dos 758, os 98 "produto acabado", próximo número dos grupos | 1 | 4 | 4 | 0,5 | 2 | 24,0 | pedido à equipe | Rafael | ORC E1; produtos da Forja |
| C-03 | Duas OS por item (fundição e usinagem)? | 1 | — | — | — | — | — | decisão | Rafael | ORC O1 |
| C-05 | Pedido do cliente → itens do orçamento (o texto sai por regra, o Clef sugere o produto, o Rafael confirma) | + | 5 | 2 | 2 | 2 | 4,5 | no ar (Deploy 18/10) | Registro no Jev | Novo (16/10) |
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
| P-01 | Roteiro-padrão aplicado em massa por tipo de peça (os 10 modelos e o "aplicar" por artigo já existem na Forja; falta aplicar em massa e cobrir os tipos sem modelo) | 1 | 5 | 5 | 1,5 | 1 | 10,0 | pronto, aguarda deploy (Forja 9da6efb) | — | Forja 6c-D |
| P-02 | Serviço de terceiros por operação (campos prontos; falta a tela) | 1 | 4 | 4 | 0,5 | 1 | 24,0 | pronto, aguarda deploy | — | Forja 6c-B |
| P-03 | Horas previstas e previsto × realizado (o tempo previsto por operação já existe; falta a soma na OS e o comparativo na tela) | 1 | 4 | 3 | 1 | 1 | 10,0 | pronto, aguarda deploy (Forja 9da6efb) | — | Forja 6c-C |
| P-04 | Visita ao PCP e validação com 5 OS reais (Forja × GRV) | 1 | 5 | 5 | 0,5 | 2 | 30,0 | na fila | P-01, P-02; agenda da visita | Forja v5.1 |
| P-06 | Alertas por WhatsApp e SLA por etapa, com horário silencioso (um canal só, servindo a Forja e o Business OS) | + | 4 | 2 | 2 | 2 | 4,0 | na fila | Número oficial | Forja Sprint 7 |
| P-07 | Hardening da Forja (limite de requisições, CORS, chave JWT única, logs) | 1 | 4 | 3 | 1 | 1 | 10,0 | pronto, aguarda deploy (Forja 9da6efb) | — | Forja Sprint 7 |
| P-08 | Go-live da Forja (paralelo, critérios de liberação) | 1 | 5 | 5 | 1 | 2 | 15,0 | na fila | P-01 a P-04 | Forja v5.1 |
| P-09 | Painel financeiro do PCP | — | — | — | — | — | — | decisão | Foi coberto pelo "A faturar"? | Forja 6b |
| P-10 | OEE (SpindleOps) | + | 4 | 1 | 3 | 2 | 2,0 | na fila | P-08 | Forja Fase 2 |
| P-11 | Visualizador de desenhos e migração da pasta física (decisão de 18/10: os desenhos ficam na plataforma, no módulo da Fundição, e não entram no backup) | + | 3 | 1 | 2 | 1 | 2,5 | na fila | — | Forja Fase 2 |
| P-12 | Inteligência da produção (previsão de prazo, gargalo) | + | 4 | 1 | 4 | 2 | 1,5 | na fila | P-10 | Forja Fase 3 |
| P-13 | Causa-raiz dos motivos de parada | + | 3 | 1 | 1 | 2 | 5,0 | decisão | Taxonomia | Jev E8 |

### L — Logística (entregas e frota)

Origem: debate de 19/10/2026 e o fork [`fleetbase-frota`](https://github.com/jusales3270/fleetbase-frota) (Fleetbase, AGPL-3.0, ainda sem
nenhuma alteração nossa). **Decisão de arquitetura:** o Fleetbase roda como **serviço separado no mesmo servidor**, e a plataforma
fala com ele **só por API**, como a Forja e o transmissor de NF-e. Os motivos:
- a AGPL não contamina a plataforma (ver "Não fazer");
- a tecnologia é outra (PHP/Laravel, Ember, MySQL);
- as atualizações do projeto original continuam chegando sem conflito.

O Business OS é a fonte da verdade (clientes, pedidos, notas). O Fleetbase cuida só da execução da entrega (rota, motorista,
veículo, comprovante). O consignado da Russer (estoque parado em hospital) não usa o Fleetbase.

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| L-01 | Fleetbase como serviço separado no servidor: instalação no Coolify com MySQL próprio, backup junto do T-02, conta de integração e chamadas pela rede interna (a receita da Forja); as alterações nossas ficam públicas no fork (AGPL) | + | 2 | 1 | 1 | 2 | 4,0 | **instalado no servidor** (20/10, OK do proprietário): `fleetbase-entregas` no Coolify (`frota.pecsil`, teto de memória por contêiner, memória livre do servidor 58% depois), conta e chave criadas, aviso cadastrado, consulta pública e cadastro de contas fechados; **no ar** (Deploy de 57ac65a em 20/10: frota e mapa lidos pelo Traefik, aviso do Fleetbase chegando com 200); falta o backup do MySQL dele | Frota própria confirmada (19/10); quem responde pela expedição; consumo do servidor medido (Cesar); OK do proprietário para instalar | Debate 19/10; VIS §7; PLANO-LOGISTICA |
| L-02 | Entregas na plataforma: pedido faturado vira ordem de entrega no Fleetbase; "entregue com comprovante" volta como evento (Comercial, Fiscal, SARA); submódulo Entregas lendo a API, com o **mapa ao vivo** (caminhões em movimento pelo tempo real do Fleetbase, rota planejada × feita, previsão de chegada, status por parada; mapa OpenStreetMap) e o **link de rastreio para o cliente** (a confirmar na instalação) | + | 4 | 1 | 2 | 2 | 3,0 | construído (20/10): módulo Logística (Ao vivo, Entregas, Frota, Origem), entrega a partir de OS, pedido ou avulsa, conferência pelo aviso, eventos e pulso no Segundo Cérebro; migração 202610200001 **APLICADA** em 20/10; teste de navegador 15/15 com usuários temporários, Fleetbase local e simulador (rota e previsão com trânsito pelo Google); falta o commit | L-01; operação definida pela área; com a NF-e em produção (C-10), a entrega passa a nascer também da nota | Debate 19/10; PLANO-LOGISTICA |
| L-03 | Motorista e frota: app Navigator com GPS em tempo real e comprovante (foto e assinatura), manutenção dos veículos (o **cadastro** de veículos e motoristas já está na plataforma, L-02b de 20/10); se a frota já tiver rastreador (seguradora), avaliar a integração pela API do fornecedor | + | 3 | 1 | 1,5 | 3 | 3,3 | na fila | L-02; **B-06** (a 443 aberta de fora: o celular na estrada precisa alcançar o servidor); celulares com dados e carregador; **regra de privacidade do rastreio** (só durante a entrega ou o expediente, com ciência do motorista por escrito: Rosana, RH) | Debate 19/10 |

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
| I-07 | Religar a Busca Corporativa com os dados dos módulos | + | 3 | 1 | 2 | 1 | 2,5 | não fazer (proprietário 18/10: a SARA cobre) | — | Busca |
| I-08 | SARA nível 1: perguntas cruzando módulos, com as permissões de cada um | 2 | 5 | 3 | 4 | 3 | 2,8 | travado | Fase 5 (K-05) | BP Fase 6 |
| I-09 | SARA níveis 2 a 4 e voz | 2 | 5 | 2 | 6 | 3 | 1,5 | travado | I-08 | BP Fase 6 |
| I-10 | "Como faço?" (encaminhar a pergunta para a tela certa) | + | 3 | 1 | 1 | 3 | 5,0 | travado | I-08 | Jev E9 |
| I-11 | Tutoriais em vídeo (piloto do orçamento) | + | 3 | 1 | 1 | 2 | 5,0 | decisão | HeyGen? | Tutoriais |
| I-12 | SARA copilot por módulo, nível 1 (orienta e consulta com as permissões de quem pergunta; piloto Financeiro com a Ana) | 2 | 4 | 3 | 3 | 2 | 3,3 | no ar nos 9 módulos, com avisos, aprendizado e visual (Deploy 18/10); falta liberar por pessoa | Chave da Anthropic no servidor | [PLANO-SARA.md](PLANO-SARA.md) |

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

### T — TI (rede, servidores, computadores)

Escopo e debate: [PLANO-TI.md](PLANO-TI.md). Ordem do §9 do plano; decisão de 18/10: **a TI vem antes do Estoque**.

| Item | O quê | Marco | V | D | E | R | Nota | Situação | Depende de | Detalhe |
|---|---|---|---|---|---|---|---|---|---|---|
| T-01 | Pré-requisito de hardware: nobreak gerenciável e BIOS com religamento automático (+ iDRAC/iLO/IPMI, se houver) | 1 | 5 | 4 | 0,5 | 3 | 26,0 | decisão (roteiro do supervisor pronto em PLANO-TI) | Compra do nobreak (proprietário); BIOS e modelo atual (supervisor de TI) | TI §2; B-10 |
| T-02 | Backup do banco fora do servidor, com restore testado: criptografado (age) antes de sair, servidor só grava, no projeto Supabase do vigia | 1 | 5 | 4 | 1 | 2 | 13,0 | no ar (19/10: primeiro backup real e restauração das cópias da nuvem conferida; Forja ainda fora) | Projeto na nuvem, chave age e app no Coolify (proprietário) | TI §10; B-02; BACKUP-EXTERNO |
| T-03 | Vigia externo num projeto Supabase na nuvem (sinal de vida + testes de fora + causa por regra), alerta pela API oficial do WhatsApp | 1 | 5 | 4 | 0,5 | 2 | 26,0 | no ar (19/10: sinal de vida a cada minuto; testes de fora desligados, porque o firewall da fábrica bloqueia a nuvem; WhatsApp sem destinatário) | Projeto na nuvem e tarefa no Coolify (proprietário); chip do WhatsApp para o alerta | TI §3.1; B-04; VIGIA-EXTERNO |
| T-04 | Coleta interna (Netdata ou Zabbix): CPU, memória, disco, temperatura, serviços, rede | 2 | 3 | 2 | 0,5 | 3 | 14,0 | na fila | Acesso ao servidor (B-01 ou console do supervisor); escolha da ferramenta | TI §3.2–3.3 |
| T-05 | Acesso remoto auditado (RustDesk auto-hospedado ou MeshCentral) no lugar do AnyDesk | 2 | 4 | 1 | 1 | 2 | 6,0 | na fila | Escolha do supervisor de TI | TI §4 |
| T-06 | Módulo TI no Business OS: inventário de ativos, painel de saúde, incidentes (histórico de quedas), chamados, acessos remotos | 1 | 4 | 3 | 1,5 | 1 | 6,7 | aplicado em 19/10 (QA de navegador 32/32), falta o commit e o deploy: painel de saúde lido do vigia, quedas copiadas do vigia (causa provável por regra, a TI confirma), chamados de qualquer pessoa pelo menu da conta, inventário, regras provisórias e a SARA de TI; acessos remotos esperam o T-05 e o nobreak o T-01 | Deploy; acessos do Cesar (proprietário, "depois concedo"); aviso à empresa só depois de o Cesar revisar as regras | TI §5; PLANO-TI T-06 |
| T-07 | Evento TI → Produção: coletor ou servidor fora do ar marca a CNC como "sem telemetria" | 2 | 3 | 1 | 0,5 | 2 | 10,0 | na fila | T-03 ou T-04; telemetria das CNCs (P-10) | TI §7.1 |
| T-08 | Camada agêntica: política determinística, ações seguras (reiniciar serviço, trocar de link), olhar para trás semanal | + | 4 | 1 | 2 | 3 | 3,0 | na fila | T-03, T-04, T-06; uso de IA no Plano do Jev | TI §6 |
| T-09 | SARA de TI e alertas falados (TTS local: Kokoro ou Piper) | + | 3 | 1 | 1 | 2 | 5,0 | em parte: a SARA de TI (consultas e avisos) veio com o T-06; faltam os alertas falados | T-06; teste de voz na CPU; voz da SARA (I-09) | TI §7.2 |
| T-10 | Produtização: TI agêntica white label, governança da autonomia, serviço por SLA | + | — | — | — | 3 | — | adiado (white label) | PecSil pronta e validada (17/10) | TI §8; raia Z |

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
| Incorporar o código do Fleetbase à plataforma | Decisão de 19/10. O Fleetbase é AGPL-3.0: a plataforma inteira herdaria a licença, e o produto licenciado (VIS §7) cairia. Ele fica como serviço separado, por API (L-01), como o transmissor GPL |
| Religar a Busca Corporativa (I-07) | Proprietário, 18/10: a SARA de cada módulo já acha e abre o registro com as permissões de quem pergunta; a busca entre módulos fica com a SARA principal (I-08). A tela segue escondida pela flag |

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
| 17/10/2026 | **SARA nível 1 antes da Fase 5** (decisão do proprietário): cada módulo ganha a sua SARA (copilot), que orienta e consulta só com as permissões de quem conversa e pode trazer dados de outros módulos quando a credencial permite. Modelo de conversa: Claude (Anthropic); Clef segue nas decisões. Piloto: Financeiro com a Ana. Grafo da empresa fica para depois. Novo item I-12; desenho em PLANO-SARA.md | Proprietário |
| 17/10/2026 | C-01, parte 1: CLIENTE.xlsx do GRV (121). Os 38 clientes da plataforma não tinham nenhum dado fiscal; 18 PJ do Brasil completados só nos campos vazios (CNPJ, IE, indicador, CEP, endereço, bairro, município, UF, telefone) + consulta pública de CNPJ (número, complemento, código IBGE): 15 prontos para NF-e. Ficam para o Rafael: O-I e Verallia com várias fábricas (um cliente por CNPJ/fábrica; "OI-SP" e "VERALLIA" a ligar), 4 duplicados (Nadir, Cattorini, Parglass…), 86 só no GRV; exterior (4) para o Jefferson | Claude |
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
| 19/10/2026 | Formato do produto: instalação licenciada no cliente (implementação + manutenção mensal, como o GRV), não SaaS por assinatura. Raia Z continua adiada; quando voltar, nasce neste formato (VISAO-PRODUTO-ESCALA §7) | Proprietário |
| 19/10/2026 | Nova raia L (Logística): o Fleetbase (fork `fleetbase-frota`) entra como serviço separado no mesmo servidor, consumido por API, e não incorporado ao código (AGPL-3.0). L-01 (instalação, nota 4,0), L-02 (entregas na plataforma, 3,0) e L-03 (motorista e frota, 3,3), todos fora do caminho crítico (+). Antes, é preciso confirmar a frota própria e quem responde pela expedição | Proprietário |
| 19/10/2026 | L-02 ganha o mapa ao vivo e o link de rastreio para o cliente; L-03 passa a depender do B-06 (443 aberta de fora) e da regra de privacidade do rastreio (Rosana) | Proprietário |
| 20/10/2026 | Frota própria confirmada. L-01 no ambiente local (Fleetbase v0.7.68) e L-02 construído (PLANO-LOGISTICA): banco testado num Postgres descartável (permissões, ciclo da entrega, conferência só pelo servidor, 7 eventos, pulso no Segundo Cérebro); 466 testes com build. Falta aplicar a migração 202610200001 e o teste de navegador | Claude |
| 20/10/2026 | Rotas pelo Google Routes (Pro, com trânsito): cota diária de 200, guarda de 3 min (dentro da faixa grátis), chave só no Fleetbase. Teste: 39,9 km e 69 min com trânsito, confiança alta (PLANO-LOGISTICA §3) | Proprietário |
| 20/10/2026 | L-02: migração 202610200001 aplicada (ninguém recebeu acesso); teste de navegador 15/15: sem permissão não vê, só ver não cria, entrega enviada com rastreio, endereço achado no mapa, caminhão no mapa com a rota e a previsão com trânsito, "entregue" volta sozinho, cancelamento, eventos, celular no escuro sem rolagem; 467 testes com build | Claude |
| 20/10/2026 | Consulta pública do Fleetbase fechada (nginx em infra/fleetbase, ligado no local) e link de rastreio do cliente pela plataforma (migração 202610200002 aplicada: só o hash, leitura só do servidor, sem dados do motorista, sem gastar a cota do Google). Mandar o link é decisão do Comercial. Teste de navegador 24/24 | Proprietário / Claude |
| 20/10/2026 | L-01 no servidor: Fleetbase instalado no Coolify pelo ramo `pecsil` do fork (compose sem porta publicada, nginx com o bloqueio dentro da imagem, passo inicial do banco); conta da empresa, chave de integração e aviso para a plataforma criados pela rede interna; cadastro público de contas fechado. A plataforma passa a falar com ele pelo Traefik (`FLEETBASE_API_HOST`), como a Forja | Proprietário / Claude |
| 20/10/2026 | Cadastro da frota e dos motoristas (pedido do proprietário; L-02b no PLANO-LOGISTICA): o motorista é um colaborador do RH (documentos ficam no RH; ao Fleetbase vai só o nome), veículo com placa normalizada, motorista designado na entrega. Migração 202610200003 aplicada (permissão `logistica.frota`, ninguém recebeu acesso: o proprietário delega depois); teste de navegador 29/29 | Proprietário / Claude |
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
| 18/10/2026 | Deploy do proprietário: C-05 e a SARA dos 9 módulos (I-12) no ar. Da comparação com o GRV Max (19 itens), 7 estão no ar, 2 em parte pela SARA (I-08, I-10) e 10 travados ou adiados | Claude |
| 18/10/2026 | I-07 (religar a Busca Corporativa) vai para "não fazer": a SARA cobre | Proprietário |
| 18/10/2026 | P-01, P-03 e P-07 construídos na Forja (proprietário reabriu). P-01: roteiro-padrão aplicado em massa por tipo, só em artigo sem roteiro, com prévia. P-03: aba "Previsto × realizado" na OS (carimbo de menos de 1 min = sem medição). P-07: bloqueio por PIN errado (10 em 5 min), limite geral, cabeçalhos, CORS fechado, socket só com login, JWT obrigatório em produção, módulo Artigos para gravar roteiro, logs com rotação; e o PIN errado volta a mostrar erro na tela. Sem migração. Modelos para funil, punção, cabeça de sopro e molde: Rafael | Claude |
| 18/10/2026 | Entra a raia T (TI), com o debate das 5 conversas de 19/09 a 18/10 registrado em PLANO-TI.md. A TI vem antes do Estoque. T-02 é o B-02 (o debate pede reabrir); T-10 (produtização) fica estacionado pela regra do white label. Quem decide a TI: o supervisor de TI | Proprietário |
| 18/10/2026 | T-03 construído: vigia num projeto Supabase na nuvem (escolha do proprietário), alerta pela API oficial do WhatsApp; causa por regra (energia/reinício × internet × porta 443) pelo tempo ligado do servidor. Teste 12/12 num Postgres do Supabase descartável. T-01: roteiro do supervisor em PLANO-TI | Claude |
| 18/10/2026 | Desenhos da Forja: guardados na plataforma, no módulo da Fundição, e fora do backup (T-02). O backup cobre o banco da plataforma, os arquivos da plataforma e o banco da Forja | Proprietário |
| 18/10/2026 | T-02 (= B-02) reaberto e construído: backup diário criptografado (age, chave privada só com o proprietário) no mesmo projeto Supabase do vigia, servidor só grava, papel backup_leitura só de leitura, retenção na nuvem, aviso de 26 h. Desenhos fora (decisão do proprietário). E2E 11/11 e SQL 3/3 com dados de mentira | Proprietário / Claude |
| 18/10/2026 | T-02: papel backup_leitura aplicado em produção (migração 202610180007, senha por verificador SCRAM). Backup real de 22,9 MB criptografado em 17 s; restaurado num Postgres descartável: 165 tabelas e 132.639 linhas iguais à produção. Falta instalar o app no Coolify | Claude |
| 19/10/2026 | T-03 no ar: projeto Supabase do vigia, tarefa "Sinal de vida" no Coolify, primeiro sinal às 09:40. Os testes de fora foram desligados: o firewall da fábrica bloqueia conexões vindas da nuvem (o site abre no 4G), e liberar o IP de saída (100.60.102.71) é com o supervisor de TI. T-02 no ar: app backup-externo, primeiro backup real às 09:48 (23,2 MB + 45,9 MB), cópias da nuvem restauradas com a chave do proprietário: 132 tabelas iguais e 70 arquivos. Falta o banco da Forja | Claude |
| 19/10/2026 | Supervisor de TI confirmado: Cesar Augusto Santos (decide as regras do módulo de TI). T-06 construído: migração 202610190001 (inventário, incidentes, chamados, regras; escrita só por funções, cada uma com a sua permissão), 003_painel.sql na nuvem (leitura do vigia com o token do sinal, sem telefone nem token), cópia das quedas pelo sinal de vida a cada minuto, telas TI › Painel/Chamados/Incidentes/Inventário/Regras, "Chamados de TI" no menu da conta para todos e a SARA de TI. SQL 51/51 num Postgres descartável com a estrutura de produção; painel da nuvem testado; 440 testes. Aplicados no mesmo dia (migração e 003 na nuvem); QA de navegador 32/32 com usuários temporários (abrir pelo menu da conta, atender, resolver, voltar pelo aviso, inventário, incidente manual, SARA de TI); o aviso "Chamar a TI" à empresa espera o Cesar revisar as regras (proprietário) | Proprietário / Claude |
| 19/10/2026 | SARA de TI com o modelo mais capaz (Sonnet 5.5), a única: agente técnico (linguagem técnica, passos e comandos em bloco, até 5 buscas em documentação de fabricantes e sistemas), mesmos guardrails. Ajustes que valem para todas: dúvida de outro módulo indica a SARA certa em vez da recusa padrão; citação da pesquisa não quebra a frase; lembrete de escrever a resposta quando o modelo só abre a tela. Teste com o modelo real 7/7 | Proprietário / Claude |

## 9. Painel

O proprietário não acompanha painel (16/10): quem segue este roadmap é o Claude, e o andamento é reportado
na conversa de trabalho. O painel só é regerado quando pedido.

- Endereço: https://claude.ai/artifact/XQv2ZVFfz8RGBiPXGwUnVz (privado; compartilhar pelo menu da página)
- Gerar: `node scripts/roadmap-painel.mjs <saida.html>` e republicar o arquivo no mesmo endereço
