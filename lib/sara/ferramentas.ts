import type { SupabaseClient } from "@supabase/supabase-js";
import { CENARIOS, projetar, saldoDePartida, type CenarioId, type Conta, type Parcela } from "../finance/fluxo-90.ts";

/**
 * Ferramentas da SARA (nível 1: só consulta). Cada uma declara a funcionalidade que exige e roda
 * com a SESSÃO de quem conversa: o banco (RLS) decide as linhas. A SARA só recebe as ferramentas
 * que a pessoa pode usar — é assim que a SARA de um módulo traz dado de outro módulo só quando a
 * credencial permite. Toda resposta traz a fonte (onde ver na plataforma).
 */

import { hoje, maisDias, num, reais, type Ferramenta, type Resultado } from "./base.ts";
import { AGENTES } from "./agentes/index.ts";

export type { Abrir, Ferramenta, Fonte, Registro, Resultado } from "./base.ts";
const LINK = {
  pagar: "/?module=financeiro&secao=Contas%20a%20pagar",
  receber: "/?module=financeiro&secao=Contas%20a%20receber",
  fluxo: "/?module=financeiro&secao=Fluxo%20de%20caixa",
  bancos: "/?module=financeiro&secao=Bancos%20e%20concilia%C3%A7%C3%A3o",
  compras: "/?module=compras",
};

/** Parcelas em aberto de um lado (pagar/receber), com o filtro pedido. */
async function contas(sb: SupabaseClient, direcao: "payable" | "receivable", e: Record<string, unknown>): Promise<Resultado> {
  const situacao = String(e.situacao ?? "vencidas");
  const dias = num(e.dias, 30, 1, 365);
  const limite = num(e.limite, 15, 1, 40);
  const quem = String(e.nome ?? "").trim();
  const h = hoje();
  let q = sb.from("finance_installments")
    .select("due_date, amount, settled_amount, finance_titles!inner(counterparty_name, counterparty_group, description, document_number, status, is_forecast, is_historical, archived_at, direction)")
    .eq("finance_titles.direction", direcao).eq("finance_titles.is_historical", false).is("finance_titles.archived_at", null)
    .neq("status", "cancelled").neq("status", "settled").not("finance_titles.status", "in", "(cancelled,settled)")
    .order("due_date").limit(2000);
  if (situacao === "vencidas") q = q.lt("due_date", h).eq("finance_titles.is_forecast", false);
  else if (situacao === "a_vencer") q = q.gte("due_date", h).lte("due_date", maisDias(h, dias)).eq("finance_titles.is_forecast", false);
  else if (situacao === "em_aprovacao") q = q.eq("finance_titles.status", "pending_approval");
  else if (situacao === "previsoes") q = q.eq("finance_titles.is_forecast", true).gte("due_date", h).lte("due_date", maisDias(h, dias));
  if (quem) q = q.ilike("finance_titles.counterparty_name", `%${quem.replace(/[%_]/g, " ")}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Linha = { due_date: string; amount: number; settled_amount: number; finance_titles: { counterparty_name: string; counterparty_group: string | null; description: string | null; document_number: string | null; status: string } };
  const linhas = ((data ?? []) as unknown as Linha[]).map((l) => ({
    [direcao === "payable" ? "fornecedor" : "cliente"]: l.finance_titles.counterparty_group || l.finance_titles.counterparty_name,
    descricao: l.finance_titles.description?.slice(0, 80) ?? null, documento: l.finance_titles.document_number, vencimento: l.due_date,
    em_aberto: reais(Number(l.amount) - Number(l.settled_amount)), em_aprovacao: l.finance_titles.status === "pending_approval",
  })).filter((l) => l.em_aberto > 0);
  const total = reais(linhas.reduce((s, l) => s + l.em_aberto, 0));
  const maiores = [...linhas].sort((a, b) => b.em_aberto - a.em_aberto).slice(0, limite);
  return {
    dados: { situacao, horizonte_dias: situacao === "a_vencer" || situacao === "previsoes" ? dias : null, quantidade: linhas.length, total, maiores_primeiro: maiores,
      observacao: linhas.length > maiores.length ? `Mostrando as ${maiores.length} maiores de ${linhas.length}.` : null },
    fontes: [{ rotulo: direcao === "payable" ? "Financeiro › Contas a pagar" : "Financeiro › Contas a receber", link: direcao === "payable" ? LINK.pagar : LINK.receber }],
  };
}

const SITUACAO_TITULO: Record<string, string> = {
  draft: "rascunho", pending_approval: "em aprovação", approved: "em aberto", partially_settled: "pago em parte", settled: "quitado", overdue: "vencido", cancelled: "cancelado",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Busca lançamentos por termos (nome, histórico, documento), já com pagamentos e vencimentos. */
async function buscar(sb: SupabaseClient, direcao: "payable" | "receivable", e: Record<string, unknown>): Promise<Resultado> {
  const termos = String(e.termos ?? "").split(/\s+/).map((t) => t.replace(/[%_]/g, "").trim()).filter((t) => t.length >= 2).slice(0, 5);
  if (!termos.length) throw new Error("Diga ao menos um termo para buscar (nome, histórico ou documento).");
  const ordem = ["ultimo_pago", "proximo_vencimento", "ultimo_vencimento", "mais_recente_lancado"].includes(String(e.ordem)) ? String(e.ordem) : "ultimo_pago";
  const { data, error } = await sb.rpc("sara_buscar_lancamentos", { p_direcao: direcao, p_termos: termos, p_ordem: ordem, p_limite: num(e.limite, 5, 1, 15) });
  if (error) throw new Error(error.message);
  const d = data as { quantidade: number; termos: number; termos_casados: number; lancamentos: Record<string, unknown>[] };
  const parcial = d.quantidade > 0 && d.termos_casados < d.termos;
  return {
    dados: { termos, ordem, encontrados: d.quantidade, lancamentos: d.lancamentos.map((l) => ({ ...l, status: SITUACAO_TITULO[String(l.status)] ?? l.status })),
      busca_parcial: parcial ? `Nenhum lançamento tem todos os termos; estes têm ${d.termos_casados} de ${d.termos}. Confira se é o que a pessoa pediu.` : null,
      observacao: d.quantidade > d.lancamentos.length ? `Mostrando ${d.lancamentos.length} de ${d.quantidade}; refine os termos se não for nenhum destes.` : null },
    fontes: [{ rotulo: direcao === "payable" ? "Financeiro › Contas a pagar" : "Financeiro › Contas a receber", link: direcao === "payable" ? LINK.pagar : LINK.receber }],
  };
}

const ESQUEMA_BUSCA = {
  type: "object",
  properties: {
    termos: { type: "string", description: "Palavras que o lançamento precisa conter, separadas por espaço (todas): parte do nome, do histórico ou do documento. Ex.: \"grob finame\", \"oleo\". Prefira 1 ou 2 palavras-chave (fornecedor, produto, documento), como estão no cadastro (financiamento do BNDES aparece como FINAME); acentos não importam. Se nenhum lançamento tiver todas, vêm os que têm mais delas." },
    ordem: { type: "string", enum: ["ultimo_pago", "proximo_vencimento", "ultimo_vencimento", "mais_recente_lancado"], description: "ultimo_pago (padrão): o pagamento mais recente; proximo_vencimento: o próximo a vencer de hoje em diante; ultimo_vencimento: a última parcela prevista; mais_recente_lancado: o último cadastrado." },
    limite: { type: "integer", description: "Quantos trazer (padrão 5, máximo 15)." },
  },
  required: ["termos"],
};

const ESQUEMA_CONTAS = (quem: string) => ({
  type: "object",
  properties: {
    situacao: { type: "string", enum: ["vencidas", "a_vencer", "em_aprovacao", "previsoes"], description: "vencidas: já venceram e estão em aberto; a_vencer: vencem nos próximos `dias`; em_aprovacao: contas aguardando aprovação; previsoes: previsões (ainda não são conta) nos próximos `dias`." },
    dias: { type: "integer", description: "Horizonte em dias para a_vencer e previsoes (padrão 30)." },
    nome: { type: "string", description: `Parte do nome do ${quem}, para filtrar.` },
    limite: { type: "integer", description: "Quantas linhas listar, das maiores para as menores (padrão 15, máximo 40)." },
  },
  required: ["situacao"],
});

const FINANCEIRO: Ferramenta[] = [
  {
    nome: "contas_a_pagar", exige: ["financeiro.pagar"], esquema: ESQUEMA_CONTAS("fornecedor"),
    descricao: "Contas a pagar em aberto (parcelas) por situação: vencidas, a vencer, em aprovação ou previsões. Devolve quantidade, total e as maiores, com fornecedor, vencimento e valor em aberto.",
    rodar: (sb, e) => contas(sb, "payable", e),
  },
  {
    nome: "contas_a_receber", exige: ["financeiro.receber"], esquema: ESQUEMA_CONTAS("cliente"),
    descricao: "Contas a receber em aberto (parcelas) por situação: vencidas, a vencer, em aprovação ou previsões. Devolve quantidade, total e as maiores, com cliente, vencimento e valor em aberto.",
    rodar: (sb, e) => contas(sb, "receivable", e),
  },
  {
    nome: "buscar_contas_a_pagar", exige: ["financeiro.pagar"], esquema: ESQUEMA_BUSCA,
    descricao: "Acha lançamentos de contas a pagar pelo nome do fornecedor, histórico ou documento (inclusive os já pagos), com o id, o último pagamento (data e valor), o próximo e o último vencimento. Serve para achar um lançamento e abri-lo com abrir_lancamento, e também para listar os pagamentos de um fornecedor (até 15, do mais recente; use limite 15 e, se houver mais, diga quantos são).",
    rodar: (sb, e) => buscar(sb, "payable", e),
  },
  {
    nome: "buscar_contas_a_receber", exige: ["financeiro.receber"], esquema: ESQUEMA_BUSCA,
    descricao: "Acha lançamentos de contas a receber pelo nome do cliente, histórico ou documento (inclusive os já recebidos), com o id, o último recebimento (data e valor), o próximo e o último vencimento. Serve para achar um lançamento e abri-lo com abrir_lancamento, e também para listar os recebimentos de um cliente (até 15, do mais recente; use limite 15 e, se houver mais, diga quantos são).",
    rodar: (sb, e) => buscar(sb, "receivable", e),
  },
  {
    nome: "abrir_lancamento", exige: ["financeiro.pagar", "financeiro.receber"],
    descricao: "Abre na tela o lançamento exato (o detalhe do título), pelo id que veio de buscar_contas_a_pagar ou buscar_contas_a_receber.",
    esquema: { type: "object", properties: { id: { type: "string", description: "id do lançamento (da busca)." } }, required: ["id"] },
    rodar: async (sb, e) => {
      const id = String(e.id ?? "");
      if (!UUID.test(id)) throw new Error("id inválido: use o id que veio da busca.");
      const { data: t, error } = await sb.from("finance_titles").select("id, direction, status, is_forecast, counterparty_name, description, finance_installments(finance_settlements(settlement_date, reversed_at))").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!t) throw new Error("Lançamento não encontrado ou fora das permissões desta pessoa.");
      type T = { id: string; direction: "payable" | "receivable"; status: string; is_forecast: boolean; counterparty_name: string; description: string | null; finance_installments: { finance_settlements: { settlement_date: string; reversed_at: string | null }[] }[] };
      const titulo = t as unknown as T;
      const pago = (titulo.finance_installments ?? []).flatMap((i) => i.finance_settlements ?? []).filter((s) => !s.reversed_at).map((s) => s.settlement_date).sort().at(-1) ?? null;
      const aba = titulo.status === "settled" && pago ? "quitados" : titulo.is_forecast ? "previsoes" : "aberto";
      const secao = titulo.direction === "payable" ? "Contas a pagar" : "Contas a receber";
      const rotulo = `Financeiro › ${secao} › ${titulo.counterparty_name}`;
      return {
        dados: { aberto: rotulo, historico: titulo.description, situacao: SITUACAO_TITULO[titulo.status] ?? titulo.status, aba },
        fontes: [{ rotulo: `Financeiro › ${secao}`, link: titulo.direction === "payable" ? LINK.pagar : LINK.receber }],
        abrir: { modulo: "financeiro", secao, rotulo, registro: { tipo: "titulo", id: titulo.id, direcao: titulo.direction, aba, mes: aba === "quitados" && pago ? pago.slice(0, 7) : null } },
      };
    },
  },
  {
    nome: "fluxo_de_caixa_90_dias", exige: ["financeiro.fluxo", "financeiro.relatorios"],
    descricao: "Projeção do caixa dos próximos 90 dias a partir do saldo dos bancos, por cenário (conservador, pelo vencimento, otimista), com as regras do cenário, o menor saldo, o primeiro dia negativo e as semanas.",
    esquema: { type: "object", properties: { cenario: { type: "string", enum: ["conservador", "base", "otimista"], description: "base = pelo vencimento (padrão)." } } },
    rodar: async (sb, e) => {
      const id = (["conservador", "base", "otimista"].includes(String(e.cenario)) ? e.cenario : "base") as CenarioId;
      const { data, error } = await sb.rpc("finance_fluxo_90");
      if (error) throw new Error(error.message);
      const d = data as { hoje: string; contas: Conta[]; parcelas: Parcela[]; fora: Record<string, number> };
      const p = projetar(d.parcelas, CENARIOS[id].regras, d.hoje, saldoDePartida(d.contas));
      return {
        dados: {
          cenario: CENARIOS[id].nome, saldo_de_partida: p.saldoInicial, menor_saldo: p.menor, saldo_em_90_dias: p.saldoFinal, primeiro_dia_negativo: p.primeiroNegativo,
          entradas: p.entra, saidas: p.sai,
          contas: d.contas.map((c) => ({ banco: c.nome, saldo_pelo_extrato: c.saldo, extrato_ate: c.ultimo })),
          semanas: p.semanas.map((s) => ({ de: s.inicio, ate: s.fim, entra: s.entra, sai: s.sai, saldo_no_fim: s.saldoFinal })),
          fora_da_projecao: d.fora,
        },
        fontes: [{ rotulo: "Financeiro › Fluxo de caixa (próximos 90 dias)", link: LINK.fluxo }],
      };
    },
  },
  {
    nome: "bancos_e_conciliacao", exige: ["financeiro.bancos"],
    descricao: "Contas bancárias com o saldo pelo extrato, a data do último extrato importado e quantos lançamentos do extrato ainda estão a conciliar.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const { data: contas, error } = await sb.from("finance_bank_accounts").select("id, bank_name, branch, account_number, opening_balance, active").eq("active", true);
      if (error) throw new Error(error.message);
      const lista = [];
      for (const c of contas ?? []) {
        // Em páginas de 1.000 (o limite do Supabase por consulta): sem isso o saldo e a conciliação saíam cortados.
        const ent: { direction: string; amount: number; booking_date: string; reconciliation_status: string }[] = [];
        for (let de = 0; de < 200_000; de += 1000) {
          const { data: pagina, error: erro } = await sb.from("finance_bank_entries").select("id, direction, amount, booking_date, reconciliation_status")
            .eq("bank_account_id", c.id).order("id").range(de, de + 999);
          if (erro) throw new Error(erro.message);
          ent.push(...(pagina ?? []));
          if ((pagina ?? []).length < 1000) break;
        }
        const saldo = Number(c.opening_balance) + ent.reduce((s, x) => s + (x.direction === "credit" ? Number(x.amount) : -Number(x.amount)), 0);
        lista.push({ banco: c.bank_name, agencia: c.branch, conta: c.account_number, saldo_pelo_extrato: reais(saldo),
          ultimo_extrato: ent.reduce((m, x) => (x.booking_date > m ? x.booking_date : m), "") || null,
          a_conciliar: ent.filter((x) => x.reconciliation_status === "pending").length });
      }
      return { dados: { contas: lista }, fontes: [{ rotulo: "Financeiro › Bancos e conciliação", link: LINK.bancos }] };
    },
  },
  {
    nome: "compras_aprovadas_a_pagar", exige: ["compras.cotacoes", "compras.aprovacoes", "compras.realizadas"],
    descricao: "Do Compras: ordens de compra aprovadas e compradas nos últimos `dias`, com fornecedor, total, prazo de entrega e condição de pagamento — o que deve virar conta a pagar quando a nota chegar.",
    esquema: { type: "object", properties: { dias: { type: "integer", description: "Janela em dias (padrão 60)." }, fornecedor: { type: "string", description: "Parte do nome do fornecedor." } } },
    rodar: async (sb, e) => {
      const dias = num(e.dias, 60, 1, 365);
      let q = sb.from("cotacoes").select("id, fornecedor, status, data_decisao, prazo_entrega, frete_valor, receipt_id, cotacao_produtos(valor_unit, quantidade, ipi, prazo, status)")
        .in("status", ["APROVADO", "COMPRADO"]).is("deleted_at", null).gte("data_decisao", maisDias(hoje(), -dias)).order("data_decisao", { ascending: false }).limit(200);
      if (e.fornecedor) q = q.ilike("fornecedor", `%${String(e.fornecedor).replace(/[%_]/g, " ")}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      type Oc = { id: number; fornecedor: string; status: string; data_decisao: string | null; prazo_entrega: string | null; frete_valor: number | null; receipt_id: string | null; cotacao_produtos: { valor_unit: number; quantidade: number; ipi: number; prazo: string | null; status: string }[] };
      const ocs = ((data ?? []) as Oc[]).map((o) => {
        const itens = (o.cotacao_produtos ?? []).filter((p) => p.status !== "REJEITADO");
        return { oc: o.id, fornecedor: o.fornecedor, situacao: o.status === "COMPRADO" ? "comprada" : "aprovada", aprovada_em: o.data_decisao?.slice(0, 10) ?? null,
          entrega: o.prazo_entrega, pagamento: itens.find((p) => p.prazo)?.prazo ?? null, nota_recebida: Boolean(o.receipt_id),
          total: reais(itens.reduce((s, p) => s + Number(p.valor_unit) * Number(p.quantidade) * (1 + Number(p.ipi || 0) / 100), 0) + Number(o.frete_valor || 0)) };
      });
      return { dados: { janela_dias: dias, quantidade: ocs.length, total: reais(ocs.reduce((s, o) => s + o.total, 0)), ordens: ocs.slice(0, 25) },
        fontes: [{ rotulo: "Compras › Cotações (ordens de compra)", link: LINK.compras }] };
    },
  },
];

/** Todas as consultas da equipe: as do Financeiro e as de cada agente (lib/sara/agentes). */
export const FERRAMENTAS: Ferramenta[] = [...FINANCEIRO, ...AGENTES.flatMap((a) => a.ferramentas)];

/** Abrir uma tela para a pessoa: só entre as que ela pode abrir (a lista entra já filtrada). */
export function ferramentaDeTelas(telas: { id: string; modulo: string; secao?: string; rotulo: string; serve: string }[]): Ferramenta | null {
  if (!telas.length) return null;
  return {
    nome: "abrir_tela", exige: [],
    descricao: `Abre uma tela da plataforma para a pessoa ver (navega por ela). Telas que esta pessoa pode abrir: ${telas.map((t) => `${t.id} = ${t.rotulo} (${t.serve})`).join("; ")}.`,
    esquema: { type: "object", properties: { tela: { type: "string", enum: telas.map((t) => t.id) } }, required: ["tela"] },
    rodar: async (_sb, e) => {
      const t = telas.find((x) => x.id === e.tela);
      if (!t) throw new Error("Tela fora das permitidas a esta pessoa.");
      return { dados: { aberta: t.rotulo }, fontes: [], abrir: { modulo: t.modulo, secao: t.secao ?? null, rotulo: t.rotulo } };
    },
  };
}

/**
 * Lacuna: a pergunta é do trabalho, mas nenhuma consulta da SARA responde (não é falta de permissão).
 * Não grava nada por si: fica registrada na conversa (sara_mensagens.ferramentas) e vira matéria para
 * o Segundo Cérebro e para o roadmap (o que as pessoas precisam e a plataforma ainda não responde).
 */
export const LACUNA: Ferramenta = {
  nome: "registrar_lacuna", exige: [],
  descricao: "Anota um pedido que você não consegue atender porque nenhuma consulta sua responde (NÃO use quando for falta de permissão). Diga à pessoa que anotou o pedido.",
  esquema: { type: "object", properties: { assunto: { type: "string", description: "O que a pessoa queria saber ou fazer, em uma frase." } }, required: ["assunto"] },
  rodar: async (_sb, e) => ({ dados: { anotado: String(e.assunto ?? "").slice(0, 300) }, fontes: [] }),
};

/** Ferramentas que a pessoa pode usar (S2). */
export function ferramentasDe(pode: (feature: string) => boolean, nomes: string[]): Ferramenta[] {
  return FERRAMENTAS.filter((f) => nomes.includes(f.nome) && f.exige.some(pode));
}
