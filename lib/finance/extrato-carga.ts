/**
 * Carga de extrato bancário — a mesma lógica para a tela ("Enviar extrato") e para
 * o script `scripts/import-extrato-ofx.mjs`:
 *   1. lê o arquivo (OFX de qualquer banco, planilha do Santander, PDF do Itaú);
 *   2. confere os saldos (se não fechar, não grava);
 *   3. classifica cada lançamento e dá a ele uma chave estável (não duplica);
 *   4. casa as saídas com as baixas do contas a pagar que ainda não têm conta;
 *   5. monta os lotes para a função do banco.
 * Só roda no servidor. Nada vai a serviço externo; o CPF sai do texto na classificação.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tipoDoArquivo } from "../arquivos/detectar.ts";
import { textoDoPdf } from "../arquivos/pdf-texto.ts";
import { lerXls } from "../arquivos/xls.ts";
import { lerXlsx, type Celula } from "../arquivos/xlsx.ts";
import { lerExtratoBradesco, pareceExtratoBradesco } from "./extrato-bradesco.ts";
import { conciliarSaidas, type BaixaMatch, type ResultadoMatch } from "./conciliacao-match.ts";
import { classificarLancamento, type CategoriaExtrato, type Classificacao } from "./extrato-classificar.ts";
import { lerExtratoItauPdf, pareceExtratoItau } from "./extrato-itau-pdf.ts";
import { lerExtratoSantander } from "./extrato-planilha.ts";
import { conferirSaldos, lerOfx, textoOfx, type ConferenciaSaldos, type ExtratoOfx, type LancamentoOfx } from "./ofx-parser.ts";

export class ExtratoNaoReconhecido extends Error {}

/** Código do banco (COMPE) → nome. */
export const BANCOS: Record<string, string> = {
  "0001": "Banco do Brasil", "0033": "Santander", "0077": "Inter", "0104": "Caixa", "0208": "BTG Pactual",
  "0237": "Bradesco", "0260": "Nubank", "0341": "Itaú", "0422": "Safra", "0748": "Sicredi", "0756": "Sicoob",
};

export type Extrato = ExtratoOfx & {
  formato: "ofx" | "planilha" | "pdf";
  nomeBanco: string;
  agencia?: string;
  numeroConta?: string;
  digito?: string;
  saldoCorridoDivergente?: number;
  /** Observações sobre o arquivo (ex.: período faltando entre blocos). */
  avisos: string[];
};

/** Planilha (.xls ou .xlsx): descobre de qual banco é pelo conteúdo. */
function extratoDaPlanilha(linhas: Celula[][]): Extrato {
  if (pareceExtratoBradesco(linhas)) return { ...lerExtratoBradesco(linhas), formato: "planilha", nomeBanco: "Bradesco" };
  try {
    return { ...lerExtratoSantander(linhas), formato: "planilha", nomeBanco: "Santander", avisos: [] };
  } catch {
    throw new ExtratoNaoReconhecido("Planilha não reconhecida. Hoje a plataforma lê as planilhas de extrato do Santander e do Bradesco; de outro banco, envie o OFX.");
  }
}

/** Lê o arquivo enviado e devolve o extrato, ou explica por que não dá. */
export async function lerExtratoDoArquivo(dados: Uint8Array): Promise<Extrato> {
  const tipo = tipoDoArquivo(dados);
  if (tipo === "ofx") {
    const e = lerOfx(textoOfx(dados));
    const codigo = e.banco.replace(/\D/g, "").padStart(4, "0");
    return { ...e, banco: codigo, formato: "ofx", nomeBanco: BANCOS[codigo] ?? `Banco ${codigo}`, avisos: [] };
  }
  if (tipo === "xlsx") return extratoDaPlanilha(lerXlsx(Buffer.from(dados)));
  if (tipo === "xls") return extratoDaPlanilha(lerXls(Buffer.from(dados)));
  if (tipo === "pdf") {
    const paginas = await textoDoPdf(dados, 400);
    if (pareceExtratoItau(paginas)) return { ...lerExtratoItauPdf(paginas), formato: "pdf", nomeBanco: "Itaú", avisos: [] };
    throw new ExtratoNaoReconhecido("PDF não reconhecido como extrato. Hoje a plataforma lê o PDF do Itaú (\"Lançamentos do período\"); de outro banco, envie o OFX ou a planilha.");
  }
  if (tipo === "nfe-xml") throw new ExtratoNaoReconhecido("Este arquivo é uma nota fiscal (XML). Envie notas pelo Fiscal ou pelo Almoxarifado.");
  throw new ExtratoNaoReconhecido("Formato não reconhecido. Envie o extrato em OFX, Excel (.xls ou .xlsx) ou PDF.");
}

/** Conta bancária no formato do cadastro, a partir do que o arquivo informa. */
export function contaDoExtrato(e: Extrato) {
  const abertura = (e.saldoAnterior?.centavos ?? 0) / 100;
  if (e.agencia && e.numeroConta) {
    return { bank_code: e.banco, bank_name: e.nomeBanco, branch: e.agencia, account_number: e.numeroConta, account_digit: e.digito ?? null, account_type: "checking", opening_balance: abertura };
  }
  if (e.banco === "0341") {
    // ACCTID do Itaú = agência (4) + conta (5) + dígito (1). Ex.: 8949040243 → ag. 8949, conta 04024-3.
    return { bank_code: e.banco, bank_name: e.nomeBanco, branch: e.conta.slice(0, 4), account_number: e.conta.slice(4, -1), account_digit: e.conta.slice(-1), account_type: "checking", opening_balance: abertura };
  }
  return { bank_code: e.banco, bank_name: e.nomeBanco, branch: e.agenciaOfx ?? "0000", account_number: e.conta, account_digit: null, account_type: "checking", opening_balance: abertura };
}

export type Lancamento = LancamentoOfx & Classificacao & { id: string; externalId: string };

/** Classifica e dá a chave estável: data + valor + texto + ocorrência no dia. */
export function prepararLancamentos(e: Extrato): Lancamento[] {
  const ocorrencias = new Map<string, number>();
  return e.lancamentos.map((l) => {
    const c = classificarLancamento(l.memo);
    const base = `${l.data}|${l.centavos}|${c.descricao}`;
    const n = (ocorrencias.get(base) ?? 0) + 1;
    ocorrencias.set(base, n);
    const externalId = createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32);
    return { ...l, ...c, id: externalId, externalId };
  });
}

/** Não são pagamento (não procuram baixa). */
export const NAO_E_PAGAMENTO = new Set<CategoriaExtrato>(["transferencia_interna", "antecipacao_recebiveis", "emprestimo", "rendimento", "aplicacao", "recebimento_cliente", "estorno", "cambio", "exportacao", "finimp", "emprestimo_cambio"]);
/** Nem pedem conta no Financeiro: entram já como "ignorados". O recebimento de cliente fica pendente. */
// Câmbio (exportação, FINIMP, empréstimo) não é pagamento a fornecedor nem tem conta no
// Financeiro: fica fora da fila de conciliação (proprietário, 10/10/2026).
export const SEM_BAIXA = new Set<CategoriaExtrato>(["transferencia_interna", "antecipacao_recebiveis", "emprestimo", "rendimento", "aplicacao", "estorno", "cambio", "exportacao", "finimp", "emprestimo_cambio"]);

const diaMais = (s: string, d: number) => new Date(Date.parse(`${s}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const cents = (n: unknown) => Math.round(Number(n) * 100);

/**
 * Baixas do contas a pagar ainda sem conta bancária na janela do extrato (±3 dias).
 * O valor que sai do caixa é pago + juros + multa (o desconto não sai do caixa).
 */
export async function buscarBaixasLivres(supabase: SupabaseClient, inicio: string, fim: string): Promise<BaixaMatch[]> {
  const linhas: Record<string, unknown>[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from("finance_settlements")
      .select("id, settlement_date, amount, interest, penalty, bank_account_id, installment:finance_installments(title:finance_titles(direction, counterparty_name))")
      .is("reversed_at", null)
      .is("bank_account_id", null)
      .gte("settlement_date", diaMais(inicio, -3))
      .lte("settlement_date", diaMais(fim, 3))
      .order("settlement_date")
      .order("id")
      .range(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...(data as Record<string, unknown>[]));
    if (data.length < 1000) break;
  }
  return linhas
    .filter((r) => (r.installment as { title?: { direction?: string } } | null)?.title?.direction === "payable")
    .map((r) => ({
      id: String(r.id),
      data: String(r.settlement_date),
      centavos: cents(r.amount) + cents(r.interest) + cents(r.penalty),
      contraparte: (r.installment as { title?: { counterparty_name?: string | null } }).title?.counterparty_name ?? null,
    }));
}

export function casarComBaixas(lancamentos: Lancamento[], baixas: BaixaMatch[]): ResultadoMatch {
  const saidas = lancamentos.filter((l) => l.centavos < 0 && !NAO_E_PAGAMENTO.has(l.categoria));
  return conciliarSaidas(saidas.map((l) => ({ id: l.id, data: l.data, centavos: -l.centavos, contraparte: l.contraparte })), baixas);
}

export type LoteCarga = { entries: Record<string, unknown>[]; links: Record<string, unknown>[] };

/**
 * Lotes para a função do banco (cada lote numa transação). `jaImportados`: chaves
 * que já estão no banco — esses lançamentos são pulados pela função e NÃO ganham
 * vínculo novo aqui (reenviar um arquivo não concilia sozinho o que já estava pendente).
 */
export function montarLotes(lancamentos: Lancamento[], resultado: ResultadoMatch, baixas: BaixaMatch[], origem: Extrato["formato"], jaImportados: Set<string> = new Set(), tamanho = 250): LoteCarga[] {
  const baixaPorId = new Map(baixas.map((b) => [b.id, b]));
  const payload = lancamentos.map((l) => ({
    external_id: l.externalId,
    booking_date: l.data,
    direction: l.centavos > 0 ? "credit" : "debit",
    amount: Math.abs(l.centavos) / 100,
    description: l.descricao,
    document_number: l.documento ?? null,
    status: SEM_BAIXA.has(l.categoria) ? "ignored" : "pending",
    category: l.categoria,
    counterparty_name: l.contraparte,
    counterparty_tax_id: l.cnpj,
    raw_payload: { fitid: l.fitid || null, tipo: l.tipo, memo: l.descricao, origem },
  }));
  const lotes: LoteCarga[] = [];
  for (let de = 0; de < payload.length; de += tamanho) {
    const entries = payload.slice(de, de + tamanho);
    const ids = new Set(entries.map((e) => e.external_id));
    const links = resultado.vinculos
      .filter((v) => ids.has(v.entradaId) && !jaImportados.has(v.entradaId))
      .map((v) => ({ external_id: v.entradaId, nivel: v.nivel, confianca: v.confianca, settlements: v.baixaIds.map((id) => ({ id, amount: (baixaPorId.get(id)?.centavos ?? 0) / 100 })) }));
    lotes.push({ entries, links });
  }
  return lotes;
}

export type ResumoCategoria = { categoria: CategoriaExtrato; quantidade: number; entradas: number; saidas: number };

export function resumoPorCategoria(lancamentos: Lancamento[]): ResumoCategoria[] {
  const mapa = new Map<CategoriaExtrato, ResumoCategoria>();
  for (const l of lancamentos) {
    const r = mapa.get(l.categoria) ?? { categoria: l.categoria, quantidade: 0, entradas: 0, saidas: 0 };
    r.quantidade++;
    if (l.centavos > 0) r.entradas += l.centavos; else r.saidas -= l.centavos;
    mapa.set(l.categoria, r);
  }
  return [...mapa.values()].sort((a, b) => b.entradas + b.saidas - (a.entradas + a.saidas));
}

/** Chaves deste extrato que já estão gravadas na conta (consulta em blocos). */
export async function chavesJaImportadas(supabase: SupabaseClient, conta: ReturnType<typeof contaDoExtrato>, chaves: string[]): Promise<{ contaId: string | null; existentes: Set<string> }> {
  const { data: contas } = await supabase
    .from("finance_bank_accounts")
    .select("id")
    .eq("bank_code", conta.bank_code)
    .eq("branch", conta.branch)
    .eq("account_number", conta.account_number)
    .limit(1);
  const contaId = contas?.[0]?.id ? String(contas[0].id) : null;
  const existentes = new Set<string>();
  if (!contaId) return { contaId, existentes };
  for (let i = 0; i < chaves.length; i += 200) {
    const { data, error } = await supabase.from("finance_bank_entries").select("external_id").eq("bank_account_id", contaId).in("external_id", chaves.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) existentes.add(String(r.external_id));
  }
  return { contaId, existentes };
}

export { conferirSaldos, type ConferenciaSaldos };
