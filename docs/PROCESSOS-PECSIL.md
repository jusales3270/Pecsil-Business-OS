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

## Cadeia 1 — Compra até o pagamento (RASCUNHO, a confirmar)

| Passo | Departamento | O que acontece | Evento | Situação no sistema |
|---|---|---|---|---|
| 1 | Compras | Cotação lançada | `compras.cotacao.criada` | ✅ registrado |
| 2 | Compras (gestor) | Cotação aprovada | `compras.cotacao.aprovada` | ✅ registrado |
| 3 | Compras → Almoxarifado | Comunicado ao almoxarifado do pedido a receber | *(a definir)* | ❌ não existe — hoje é fora do sistema |
| 4 | Almoxarifado | Pedido chega, é conferido e recebido | *(a definir, ex.: `estoque.recebimento.confirmado`)* | ❌ **módulo Almoxarifado/Estoque ainda não existe** (planejado) |
| 5 | Financeiro | Conta a pagar gerada **a partir do recebimento** (não da aprovação) | `financeiro.titulo.criado` | ✅ o título já aceita origem (`source_module`, `source_entity_id`) |
| 6 | Financeiro | Pagamento | `financeiro.titulo.baixado` | ✅ registrado |

Hoje também existe `compras.compra.registrada` (compra com NF lançada no Compras).
Falta entender onde ela se encaixa: é o mesmo momento do recebimento no almoxarifado,
ou vem antes?

**Perguntas em aberto:**
- Como o comunicado ao almoxarifado é feito hoje (e-mail, papel, WhatsApp)? Quem recebe?
- Quem confere o recebimento? Confere contra a cotação aprovada (itens, quantidades, preço)?
- **Recebimento parcial:** gera conta a pagar parcial, ou espera tudo chegar?
- **Divergência de NF** (preço ou quantidade diferente do aprovado): quem decide?
- Prazo de pagamento vem de onde: da cotação (condição do fornecedor), da NF ou é padrão?
- O centro de custo da compra é informado por quem — Compras, na cotação, ou o Financeiro?

## Cadeia 2 — Desligamento (RASCUNHO, a confirmar)

| Passo | Departamento | O que acontece | Evento | Situação no sistema |
|---|---|---|---|---|
| 1 | RH | Colaborador desligado | `rh.colaborador.desligado` | ✅ registrado |
| 2 | Acessos | Conta na plataforma bloqueada | `acesso.usuario.bloqueado` | ⚠️ hoje manual (Pessoas e Acessos) |
| 3 | Portaria | Entrada do ex-colaborador barrada / tratada como visitante | *(a definir)* | ❌ a Portaria não consulta o quadro do RH |

**Perguntas em aberto:** o bloqueio de acesso deve ser automático no desligamento, ou
passar por confirmação? A Portaria precisa de lista de colaboradores ativos?

## Lacunas identificadas

- **Almoxarifado/Estoque:** peça central da Cadeia 1; hoje só "planejado" no catálogo.
- **Produção (Forja):** os dados moram no Forja; para paradas virarem custo ou alerta
  em outro módulo, é preciso trazer eventos do Forja para a trilha.
