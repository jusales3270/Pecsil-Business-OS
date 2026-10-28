import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { eventoDaBaixa, eventoDoTitulo, type LinhaBaixa, type LinhaRateio, type LinhaTitulo } from "./eventos";
import { aplicarRegra, regraNaData, type Evento, type Partida, type Pendencia, type Regra, type Vinculos } from "./regras";

/**
 * Escrituração automática (N-04), com a chave de serviço DEPOIS de a rota conferir fiscal.contabilidade operar.
 * Lê os títulos e as baixas do período, aplica a regra de cada evento com os vínculos do plano e grava em lotes
 * (contabil_escriturar_lote): o que já foi lançado não entra de novo. O que não dá para lançar volta como
 * pendência, com o motivo, sem ir para conta adivinhada.
 */
const PAGINA = 1000; // limite de linhas do Supabase por consulta
const LOTE = 200;

export async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    saida.push(...(data ?? []));
    if (!data || data.length < PAGINA) return saida;
  }
}

async function emPartes<T>(ids: readonly string[], ler: (parte: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await ler(ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    saida.push(...(data ?? []));
  }
  return saida;
}

const MAPA = { conta_gerencial: "gerencial", conta_bancaria: "bancaria", papel: "papel", fornecedor: "fornecedor", cliente: "cliente" } as const;
/** Os vínculos do plano. O motor só usa os confirmados; a simulação de cobertura pode somar os propostos. */
export async function vinculosDoPlano(admin: SupabaseClient, plano: string, comPropostos = false): Promise<Required<Vinculos>> {
  const linhas = await todas<{ origem: keyof typeof MAPA; chave: string; conta_id: string }>((a, b) => {
    const q = admin.from("contabil_vinculos").select("origem, chave, conta_id").eq("plano_id", plano);
    return (comPropostos ? q : q.eq("situacao", "confirmado")).order("id").range(a, b);
  });
  const v: Required<Vinculos> = { gerencial: new Map(), bancaria: new Map(), papel: new Map(), fornecedor: new Map(), cliente: new Map() };
  for (const x of linhas) v[MAPA[x.origem]]?.set(x.chave, x.conta_id);
  return v;
}

export type PendenciaEscrita = Pendencia & { origemTipo: "titulo" | "baixa"; origemId: string; data: string; historico: string; valor: number };
export type LancamentoMontado = { data: string; historico: string; origem_tipo: "titulo" | "baixa"; origem_id: string; regra_id: string; partidas: Partida[] };
export type ResultadoEscrita = { lancados: number; jaLancados: number; pendencias: PendenciaEscrita[]; eventos: number; de: string; ate: string; simulados?: LancamentoMontado[] };

/**
 * `simular`: monta os lançamentos e devolve, sem gravar nada (medida de cobertura); com `comPropostos`, usa também
 * os vínculos ainda não confirmados. A escrituração de verdade nunca usa proposto.
 */
export async function escriturar(admin: SupabaseClient, org: string, plano: string, periodo: { de: string; ate: string }, autor: { id: string | null; nome: string | null },
  opcoes: { simular?: boolean; comPropostos?: boolean } = {}): Promise<ResultadoEscrita> {
  const { data: p, error: ep } = await admin.from("contabil_planos").select("id, abertura").eq("id", plano).eq("organization_id", org).maybeSingle();
  if (ep || !p) throw new Error("Plano de contas não encontrado.");
  // Antes da abertura vale o saldo inicial: nada de lançar evento de antes.
  const de = p.abertura && p.abertura > periodo.de ? p.abertura : periodo.de;
  const ate = periodo.ate;
  const [{ data: regrasDb }, vinculos, { data: fechados }] = await Promise.all([
    admin.from("contabil_regras").select("id, organization_id, evento, descricao, partidas, vigente_de, vigente_ate").or(`organization_id.is.null,organization_id.eq.${org}`),
    vinculosDoPlano(admin, plano, Boolean(opcoes.simular && opcoes.comPropostos)),
    admin.from("contabil_periodos").select("competencia").eq("plano_id", plano).eq("situacao", "fechado"),
  ]);
  const fechado = new Set((fechados ?? []).map((f) => f.competencia as string));
  const regras = (regrasDb ?? []) as Regra[];

  const titulos = await todas<LinhaTitulo>((a, b) => admin.from("finance_titles")
    .select("id, direction, counterparty_name, document_number, description, competence_date, issue_date, original_amount, chart_account_id, cost_center_id, is_forecast, archived_at, cancelled_at, supplier_id, customer_id")
    .eq("organization_id", org).gte("competence_date", de).lte("competence_date", ate).order("id").range(a, b));
  const rateios = await emPartes<LinhaRateio>(titulos.map((t) => t.id), (parte) => admin.from("finance_title_allocations").select("title_id, chart_account_id, amount").in("title_id", parte));
  const porTitulo = new Map<string, LinhaRateio[]>();
  for (const r of rateios) porTitulo.set(r.title_id, [...(porTitulo.get(r.title_id) ?? []), r]);

  type BaixaDb = Omit<LinhaBaixa, "titulo"> & { installment: { title: LinhaBaixa["titulo"] } | null };
  const baixasDb = await todas<BaixaDb>((a, b) => admin.from("finance_settlements")
    .select("id, settlement_date, amount, discount, interest, penalty, exchange_difference, bank_account_id, reversed_at, installment:finance_installments(title:finance_titles(id, direction, counterparty_name, document_number, cost_center_id, supplier_id, customer_id))")
    .eq("organization_id", org).gte("settlement_date", de).lte("settlement_date", ate).order("id").range(a, b) as unknown as PromiseLike<{ data: BaixaDb[] | null; error: { message: string } | null }>);
  // Baixa sem banco: o banco do extrato com que foi conciliada.
  const semBanco = baixasDb.filter((b) => !b.bank_account_id).map((b) => b.id);
  const conciliadas = await emPartes<{ settlement_id: string; entrada: { bank_account_id: string } | null }>(semBanco, (parte) =>
    admin.from("finance_reconciliations").select("settlement_id, entrada:finance_bank_entries(bank_account_id)").in("settlement_id", parte) as unknown as PromiseLike<{ data: { settlement_id: string; entrada: { bank_account_id: string } | null }[] | null; error: { message: string } | null }>);
  const bancoConciliado = new Map(conciliadas.filter((x) => x.entrada?.bank_account_id).map((x) => [x.settlement_id, x.entrada!.bank_account_id]));

  const ja = new Set((await todas<{ origem_tipo: string; origem_id: string }>((a, b) => admin.from("contabil_lancamentos").select("origem_tipo, origem_id")
    .eq("plano_id", plano).in("origem_tipo", ["titulo", "baixa"]).gte("data", de).lte("data", ate).order("id").range(a, b))).map((l) => `${l.origem_tipo}:${l.origem_id}`));

  const eventos: Evento[] = [];
  const pendencias: PendenciaEscrita[] = [];
  for (const t of titulos) {
    const e = eventoDoTitulo(t, porTitulo.get(t.id) ?? []);
    if (e) eventos.push(e);
  }
  for (const b of baixasDb) {
    const e = eventoDaBaixa({ ...b, titulo: b.installment?.title ?? null }, bancoConciliado.get(b.id) ?? null);
    if (!e) continue;
    if ("pendencia" in e) pendencias.push({ ...e.pendencia, origemTipo: "baixa", origemId: b.id, data: b.settlement_date, historico: "Baixa", valor: Number(b.amount) });
    else eventos.push(e);
  }

  let jaLancados = 0;
  const lote: LancamentoMontado[] = [];
  for (const e of eventos) {
    if (ja.has(`${e.origemTipo}:${e.origemId}`)) { jaLancados++; continue; }
    if (fechado.has(e.data.slice(0, 7))) { pendencias.push({ motivo: "periodo_fechado", detalhe: e.data.slice(0, 7), origemTipo: e.origemTipo, origemId: e.origemId, data: e.data, historico: e.historico, valor: e.valores.valor }); continue; }
    const regra = regraNaData(regras, e.tipo, e.data);
    const r = regra ? aplicarRegra(e, regra, vinculos) : { pendencia: { motivo: "sem_regra" as const, detalhe: e.tipo } };
    if ("pendencia" in r) { pendencias.push({ ...r.pendencia, origemTipo: e.origemTipo, origemId: e.origemId, data: e.data, historico: e.historico, valor: e.valores.valor }); continue; }
    lote.push({ data: e.data, historico: e.historico, origem_tipo: e.origemTipo, origem_id: e.origemId, regra_id: regra!.id, partidas: r.partidas });
  }
  if (opcoes.simular) return { lancados: 0, jaLancados, pendencias, eventos: eventos.length, de, ate, simulados: lote };
  let lancados = 0;
  for (let i = 0; i < lote.length; i += LOTE) {
    const { data, error } = await admin.rpc("contabil_escriturar_lote", { p_org: org, p_plano: plano, p_lote: lote.slice(i, i + LOTE), p_autor: autor.id, p_autor_nome: autor.nome });
    if (error) throw new Error(`Lote ${i / LOTE + 1}: ${error.message}`);
    lancados += Number(data ?? 0);
  }
  return { lancados, jaLancados, pendencias, eventos: eventos.length, de, ate };
}
