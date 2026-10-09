# Processos da PecSil — mapa das cadeias entre departamentos

> Documento vivo. Cada cadeia descreve como um fato em um departamento leva a uma
> ação em outro. É daqui que saem as **reações** entre módulos do Business OS —
> nenhuma reação é ligada antes de a cadeia estar confirmada neste documento.

## Como o Business OS trata isso

1. **Eventos (já existe):** cada módulo anuncia o que acontece numa trilha única
   (`module_events`), visível em Fundação › Eventos. Ex.: `compras.cotacao.aprovada`,
   `rh.colaborador.desligado`. Catálogo: `modules/event-catalog.ts`.
2. **Reações (depois, cadeia a cadeia):** "quando o evento X acontecer, o módulo Y
   faz Z". Só entram quando a cadeia abaixo estiver confirmada com quem executa o
   processo.
3. **SARA:** acompanha as cadeias, avisa quando alguma trava (ex.: "3 compras
   aprovadas há mais de 10 dias sem recebimento") e responde perguntas sobre elas.

## Modelo de cadeia

| Passo | Departamento | O que acontece | Evento que registra | Quem faz | Prazo esperado |
|---|---|---|---|---|---|
| 1 | … | … | `modulo.entidade.fato` | … | … |

Perguntas de toda cadeia: quem dispara? quem confere? o que acontece quando dá
errado (parcial, divergência, cancelamento)? quem precisa ser avisado?

---

## Cadeia 1 — Compra até o pagamento (DEFINIDA pelo dono em 01/10/2026, implantada)

Três módulos conversando — **Compras → Almoxarifado → Financeiro** — e o ICMS no módulo **Fiscal**.
Quem é avisado sai da permissão (`notify_feature`), não do nome da pessoa.

| Passo | Quem | Onde | O que acontece | Evento / aviso |
|---|---|---|---|---|
| 1 | Almoxarife (Henrique) | Almoxarifado › Solicitações | Pede o material que falta (itens, divisão Usinagem ou Fundição, urgência) | `almoxarifado.solicitacao.criada` · aviso a quem cota (`compras.cotacoes` operar) |
| 1b | Fundição (Guilherme) | Fundição › Pedidos de material | Pede o material da Fundição pelo painel dele (desde 09/10/2026); vai sempre para a divisão Fundição, assinado por ele (`material_requests.origem = 'FUNDICAO'`) | `fundicao.pedido.criado` · aviso a quem cota |
| 2 | Compras (Kaylane) | Compras › Pedidos de material (abas Usinagem / Fundição) | "Cotar" abre a cotação ligada ao pedido (`cotacoes.material_request_id`) | `compras.cotacao.criada` · pedido "em cotação" + aviso ao solicitante |
| 3 | Gestor (Ricardo) | Compras › Pendentes | Aprova ou rejeita | `compras.cotacao.aprovada` · pedido "aprovado"/"rejeitado" + aviso ao solicitante |
| 4 | Compras (Kaylane) | Compras › Minhas cotações › Comprar | **Aviso de compra** (NF opcional nesta hora) | `compras.compra.registrada` · **previsão** em Contas a pagar + aviso a quem paga e a quem recebe |
| 5 | Almoxarife | Almoxarifado › A caminho › Receber | Confere e lança a nota (XML da NF-e ou digitada) | `almoxarifado.recebimento.confirmado` · **conta a pagar real** (vencimentos das duplicatas), previsão abatida/apagada, linha no **Painel do ICMS**, aviso a quem paga |
| 6 | Financeiro (Ana) | Financeiro › Contas a pagar | Paga | `financeiro.titulo.baixado` |

Respostas às perguntas do rascunho:
- **Comunicado ao almoxarifado:** pelo sistema (aviso no sino e lista "A caminho").
- **Pedidos da Fundição (09/10/2026):** quem só tem Fundição › Pedidos de material cai direto no painel da Fundição e vê só os pedidos da Fundição. O material chega pelo Almoxarifado (o Henrique recebe, vendo "para a Fundição"); o solicitante é avisado de cada passo e quando o material chega.
- **Conferência:** o almoxarife confere o material com a nota; o XML mostra itens e valores ao lado do que foi comprado.
- **Recebimento parcial:** cada nota gera a sua conta a pagar; a previsão é abatida e o pedido fica "recebido em parte" até o almoxarife marcar "pedido completo".
- **Divergência:** o almoxarife descreve; a conta entra com "revisar" e o Compras é avisado.
- **Prazo de pagamento:** da nota (duplicatas do XML); sem duplicata, o vencimento previsto (prazo do fornecedor, ou 30 dias).
- **Conta do plano:** a mais usada para o fornecedor no histórico; sem histórico, "revisar" para o Financeiro classificar.
- **Nota sem pedido:** "recebimento avulso" — conta com "revisar" e aviso ao Compras.

Funções no banco: `almoxarifado_criar_solicitacao`, `almoxarifado_atualizar_solicitacao`,
`trg_compra_previsao`, `almoxarifado_a_caminho`, `almoxarifado_confirmar_recebimento`
(migrações `202610010001`–`202610010004`).

## Cadeia 2 — Desligamento (RASCUNHO, a confirmar)

| Passo | Departamento | O que acontece | Evento | Situação no sistema |
|---|---|---|---|---|
| 1 | RH | Colaborador desligado | `rh.colaborador.desligado` | ✅ registrado |
| 2 | Acessos | Conta na plataforma bloqueada | `acesso.usuario.bloqueado` | ⚠️ hoje manual (Pessoas e Acessos) |
| 3 | Portaria | Entrada do ex-colaborador barrada / tratada como visitante | *(a definir)* | ❌ a Portaria não consulta o quadro do RH |

**Perguntas em aberto:** o bloqueio de acesso deve ser automático no desligamento, ou
passar por confirmação? A Portaria precisa de lista de colaboradores ativos?

## Cadeia 3 — Pedido do cliente até o recebimento (RASCUNHO, a confirmar)

Hoje esta cadeia **não existe como processo**: quem faz tudo é o diretor de
operações, pelo e-mail e pelo WhatsApp pessoal dele. É a razão de existir o
departamento Comercial no sistema.

| Passo | Departamento | O que acontece | Evento | Situação no sistema |
|---|---|---|---|---|
| 1 | Comercial | Cliente escreve para `comercial@` | `comercial.email.recebido` | ✅ registrado (quando a conexão estiver ligada) |
| 2 | Comercial | O e-mail é classificado: pedido, cobrança, dúvida ou outro | `comercial.email.classificado` | ✅ registrado (Jev, com revisão humana) |
| 3 | Comercial | Vira card no funil e alguém assume | *(a definir)* | ⏳ etapa 5 do módulo |
| 4 | Comercial → Produção | Pedido aprovado vira OS no Forja | *(a definir)* | ❌ hoje é o diretor que lança no Forja |
| 5 | Financeiro | Título a receber é lançado | `financeiro.titulo.criado` | ⚠️ existe a tela, mas **não há nenhum título a receber lançado** |
| 6 | Comercial | Cobrança: aviso ao cliente sobre o que venceu | `comercial.cobranca.enviada` | ⏳ etapa 6 do módulo |
| 7 | Financeiro | Recebimento | `financeiro.titulo.baixado` | ✅ registrado |

**Perguntas em aberto:**
- Quem vai operar o Comercial? Hoje não existe a função na empresa.
- O pedido do cliente vira OS no Forja por quem, e com qual confirmação?
- O título a receber nasce da OS do Forja (que já guarda preço unitário, valor
  total, PO do cliente e valor recebido) ou é lançado à mão no Financeiro?
- A régua de cobrança (1º aviso, 2º, 3º) tem quantos dias, e quem aprova o envio?
- O WhatsApp do diretor continua sendo canal? Se sim, o que entra no sistema?

## Lacunas identificadas

- **Almoxarifado/Estoque:** peça central da Cadeia 1; hoje só "planejado" no catálogo.
- **Produção (Forja):** os dados moram no Forja; para paradas virarem custo ou alerta
  em outro módulo, é preciso trazer eventos do Forja para a trilha.
