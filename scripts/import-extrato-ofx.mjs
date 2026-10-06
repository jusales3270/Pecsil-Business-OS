#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga do extrato bancário (OFX) e conciliação
 *
 * Lê o OFX do banco, confere dia a dia que os saldos fecham, classifica cada
 * lançamento (lib/finance/extrato-classificar.ts), tira o CPF do texto e casa as
 * SAÍDAS com as baixas do contas a pagar que ainda não têm conta bancária
 * (lib/finance/conciliacao-match.ts: mesma data e valor; data deslocada; lote do
 * dia). Entradas e saídas sem baixa ficam sem vínculo, para a equipe revisar na
 * tela "Bancos e conciliação". NADA é criado no contas a pagar/receber por aqui.
 *
 * O extrato tem folha e pagamentos a pessoas: NÃO o coloque no repositório nem
 * envie nada dele a serviço externo. O relatório da simulação também é local.
 *
 * Reexecutável: cada lançamento tem um `external_id` estável (data + valor +
 * texto + ocorrência no dia); rodar de novo pula o que já entrou.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-extrato-ofx.mjs --file "~/Desktop/extrato.ofx" --url http://<supabase>
 *   node scripts/import-extrato-ofx.mjs --file … --url … --apply
 *
 * Opções:
 *   --out <pasta>   onde gravar o relatório (padrão: ao lado do --file; modo 0600)
 *   --banco <nome>  nome da conta no cadastro (padrão: "Itaú")
 * Requer SUPABASE_SERVICE_ROLE_KEY (.env.local) e a migração 202610060002.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { conciliarSaidas } from "../lib/finance/conciliacao-match.ts";
import { ROTULO_CATEGORIA, classificarLancamento } from "../lib/finance/extrato-classificar.ts";
import { conferirSaldos, lerOfx } from "../lib/finance/ofx-parser.ts";

const envPath = resolve(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (process.env[key] === undefined) env[key] = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};
const apply = args.includes("--apply");
const file = getArg("--file")?.replace(/^~/, homedir());
if (!file || !existsSync(file)) {
  console.error("Informe o OFX: --file <caminho>");
  process.exit(1);
}
const outDir = resolve(getArg("--out")?.replace(/^~/, homedir()) ?? dirname(file));
const nomeBanco = getArg("--banco") ?? "Itaú";
const brl = (centavos) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// --- 1. Leitura e conferência dos saldos ------------------------------------------
const extrato = lerOfx(readFileSync(file, "latin1"));
const conferencia = conferirSaldos(extrato);
console.log(`\nExtrato: banco ${extrato.banco} · conta ${extrato.conta} · ${extrato.lancamentos.length} lançamentos · ${extrato.inicio} a ${extrato.fim}`);
console.log(`Saldos diários conferidos: ${conferencia.dias} · divergentes: ${conferencia.divergentes.length}`);
if (conferencia.divergentes.length) {
  console.error("\nA leitura NÃO fecha com os saldos do banco. Nada será gravado.");
  conferencia.divergentes.slice(0, 20).forEach((d) => console.error(`  - ${d.data}: banco ${brl(d.esperado)} · calculado ${brl(d.calculado)}`));
  process.exit(1);
}
const diferencaFinal = extrato.saldoFinal === null ? 0 : extrato.saldoFinal - conferencia.saldoCalculado;
console.log(`Saldo final: calculado ${brl(conferencia.saldoCalculado)}${extrato.saldoFinal === null ? "" : ` · informado no cabeçalho ${brl(extrato.saldoFinal)}`}${diferencaFinal ? ` (diferença do próprio banco: ${brl(diferencaFinal)})` : ""}`);

// --- 2. Classificação e chave estável ---------------------------------------------
const ocorrencias = new Map();
const lancamentos = extrato.lancamentos.map((l) => {
  const c = classificarLancamento(l.memo);
  const base = `${l.data}|${l.centavos}|${c.descricao}`;
  const n = (ocorrencias.get(base) ?? 0) + 1;
  ocorrencias.set(base, n);
  const externalId = createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32);
  return { ...l, ...c, externalId, id: externalId };
});

// --- 3. Banco: contas e baixas ----------------------------------------------------
const url = getArg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(apply ? "Faltam a URL do Supabase (--url) e SUPABASE_SERVICE_ROLE_KEY." : "\nSem URL/chave do Supabase: simulação só com a classificação, sem casar com as baixas.");
  if (apply) process.exit(1);
}
const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

async function readAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const NAO_E_PAGAMENTO = new Set(["transferencia_interna", "antecipacao_recebiveis", "emprestimo", "rendimento", "aplicacao", "recebimento_cliente", "estorno"]);
// Não precisam de baixa nenhuma (movimento entre contas, crédito do banco, rendimento): entram já como "ignorados".
// O recebimento de cliente fica pendente: a equipe liga à parcela do contas a receber.
const SEM_BAIXA = new Set(["transferencia_interna", "antecipacao_recebiveis", "emprestimo", "rendimento", "aplicacao", "estorno"]);
const saidas = lancamentos.filter((l) => l.centavos < 0 && !NAO_E_PAGAMENTO.has(l.categoria));

let resultado = { vinculos: [], entradasSemVinculo: saidas.map((l) => l.id), baixasSemVinculo: [], lotesGrandesIgnorados: 0 };
let baixas = [];
let jaConciliados = new Set();
let modo = "-";
if (supabase) {
  const dia = (s, d) => new Date(Date.parse(`${s}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
  const linhas = await readAll(() =>
    supabase
      .from("finance_settlements")
      .select("id, settlement_date, amount, interest, penalty, discount, bank_account_id, installment:finance_installments(title:finance_titles(direction, counterparty_name))")
      .is("reversed_at", null)
      .gte("settlement_date", dia(extrato.inicio, -3))
      .lte("settlement_date", dia(extrato.fim, 3))
      .order("settlement_date")
      .order("id"),
  );
  const pagar = linhas.filter((r) => r.installment?.title?.direction === "payable");
  jaConciliados = new Set(pagar.filter((r) => r.bank_account_id).map((r) => r.id));
  const livres = pagar.filter((r) => !r.bank_account_id);
  const cents = (n) => Math.round(Number(n) * 100);
  // O valor que sai do caixa: pago + juros + multa. Testa também descontando o desconto
  // e fica com a leitura que concilia mais.
  const montar = (descontar) =>
    livres.map((r) => ({ id: r.id, data: r.settlement_date, centavos: cents(r.amount) + cents(r.interest) + cents(r.penalty) - (descontar ? cents(r.discount) : 0), contraparte: r.installment?.title?.counterparty_name ?? null }));
  const entradasMatch = saidas.map((l) => ({ id: l.id, data: l.data, centavos: -l.centavos, contraparte: l.contraparte }));
  const tentativas = [false, true].map((descontar) => {
    const b = montar(descontar);
    return { descontar, baixas: b, resultado: conciliarSaidas(entradasMatch, b) };
  });
  const melhor = tentativas.sort((a, b) => b.resultado.vinculos.length - a.resultado.vinculos.length)[0];
  baixas = melhor.baixas;
  resultado = melhor.resultado;
  modo = melhor.descontar ? "pago + juros + multa − desconto" : "pago + juros + multa";
  console.log(`\nBaixas do contas a pagar na janela do extrato: ${pagar.length} (já com conta bancária: ${jaConciliados.size}) · livres para casar: ${livres.length}`);
  console.log(`Valor da baixa usado no casamento: ${modo}`);
}

// --- 4. Resumo --------------------------------------------------------------------
const porId = new Map(lancamentos.map((l) => [l.id, l]));
const baixaPorId = new Map(baixas.map((b) => [b.id, b]));
const niveis = { 1: 0, 2: 0, 3: 0 };
let valorCasado = 0;
for (const v of resultado.vinculos) {
  niveis[v.nivel] += 1;
  valorCasado += -porId.get(v.entradaId).centavos;
}
const valorSaidas = saidas.reduce((s, l) => s - l.centavos, 0);

console.log(`\n=== Lançamentos por categoria ===`);
const porCategoria = new Map();
for (const l of lancamentos) {
  const c = porCategoria.get(l.categoria) ?? { n: 0, entradas: 0, saidas: 0 };
  c.n += 1;
  if (l.centavos > 0) c.entradas += l.centavos;
  else c.saidas -= l.centavos;
  porCategoria.set(l.categoria, c);
}
for (const [categoria, c] of [...porCategoria].sort((a, b) => b[1].saidas + b[1].entradas - (a[1].saidas + a[1].entradas))) {
  console.log(`  ${String(c.n).padStart(5)}  ${ROTULO_CATEGORIA[categoria].padEnd(36)} entradas ${brl(c.entradas).padStart(18)}  saídas ${brl(c.saidas).padStart(18)}`);
}

if (supabase) {
  console.log(`\n=== Conciliação das saídas com o contas a pagar (${saidas.length} lançamentos, ${brl(valorSaidas)}) ===`);
  console.log(`  Conciliadas: ${resultado.vinculos.length} (${((resultado.vinculos.length / saidas.length) * 100).toFixed(1)}%) · ${brl(valorCasado)} (${((valorCasado / valorSaidas) * 100).toFixed(1)}% do valor)`);
  console.log(`    nível 1 (data e valor iguais): ${niveis[1]} · nível 2 (data deslocada): ${niveis[2]} · nível 3 (lote do dia): ${niveis[3]}`);
  console.log(`  Sem baixa correspondente: ${resultado.entradasSemVinculo.length} lançamentos · ${brl(resultado.entradasSemVinculo.reduce((s, id) => s - porId.get(id).centavos, 0))}`);
  console.log(`  Lotes grandes demais para testar a soma: ${resultado.lotesGrandesIgnorados}`);
  const semBaixaPorCategoria = new Map();
  for (const id of resultado.entradasSemVinculo) {
    const l = porId.get(id);
    const c = semBaixaPorCategoria.get(l.categoria) ?? { n: 0, v: 0 };
    c.n += 1;
    c.v -= l.centavos;
    semBaixaPorCategoria.set(l.categoria, c);
  }
  for (const [categoria, c] of [...semBaixaPorCategoria].sort((a, b) => b[1].v - a[1].v)) console.log(`    sem baixa · ${ROTULO_CATEGORIA[categoria].padEnd(34)} ${String(c.n).padStart(4)} · ${brl(c.v)}`);
  const dentro = baixas.filter((b) => b.data >= extrato.inicio && b.data <= extrato.fim);
  const sobras = resultado.baixasSemVinculo.filter((id) => dentro.some((b) => b.id === id));
  console.log(`  Baixas do contas a pagar no período sem lançamento no extrato: ${sobras.length} · ${brl(sobras.reduce((s, id) => s + baixaPorId.get(id).centavos, 0))}`);
}

// --- 5. Relatório local -----------------------------------------------------------
const stamp = basename(file).replace(/\.ofx$/i, "").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const vinculoPorEntrada = new Map(resultado.vinculos.map((v) => [v.entradaId, v]));
const linhasCsv = [["data", "valor", "categoria", "descricao", "contraparte", "situacao", "nivel", "confianca", "baixas"].join(";")];
for (const l of lancamentos) {
  const v = vinculoPorEntrada.get(l.id);
  const situacao = v ? "conciliado" : l.centavos < 0 && !NAO_E_PAGAMENTO.has(l.categoria) ? "sem baixa" : "sem baixa esperada";
  linhasCsv.push([l.data, (l.centavos / 100).toFixed(2).replace(".", ","), ROTULO_CATEGORIA[l.categoria], l.descricao, l.contraparte ?? "", situacao, v?.nivel ?? "", v?.confianca ?? "", v ? v.baixaIds.length : ""].map(csv).join(";"));
}
const relatorio = resolve(outDir, `conciliacao-${stamp}.csv`);
writeFileSync(relatorio, linhasCsv.join("\n"), { mode: 0o600 });
console.log(`\nRelatório (local, não vai ao Git): ${relatorio}`);

if (!apply) {
  console.log("\nSimulação: nada foi gravado. Rode com --apply depois de conferir o relatório.");
  process.exit(0);
}

// --- 6. Gravação (lotes de 250 lançamentos, cada um numa transação) ---------------
const { data: org, error: orgError } = await supabase.from("organizations").select("id").limit(1).single();
if (orgError) {
  console.error("Organização não encontrada:", orgError.message);
  process.exit(1);
}
// ACCTID do Itaú = agência (4) + conta (5) + dígito (1). Ex.: 8949040243 → ag. 8949, conta 04024-3.
const conta = { bank_code: extrato.banco, bank_name: nomeBanco, branch: extrato.conta.slice(0, 4), account_number: extrato.conta.slice(4, -1), account_digit: extrato.conta.slice(-1), account_type: "checking", opening_balance: (extrato.saldoAnterior?.centavos ?? 0) / 100 };

const payload = lancamentos.map((l) => ({
  external_id: l.externalId,
  booking_date: l.data,
  direction: l.centavos > 0 ? "credit" : "debit",
  amount: Math.abs(l.centavos) / 100,
  description: l.descricao,
  document_number: null,
  status: SEM_BAIXA.has(l.categoria) ? "ignored" : "pending",
  category: l.categoria,
  counterparty_name: l.contraparte,
  counterparty_tax_id: l.cnpj,
  raw_payload: { fitid: l.fitid, tipo: l.tipo, memo: l.descricao },
}));
const SIZE = 250;
let inseridos = 0;
let ignorados = 0;
let vinculados = 0;
for (let from = 0; from < payload.length; from += SIZE) {
  const lote = payload.slice(from, from + SIZE);
  const ids = new Set(lote.map((e) => e.external_id));
  const links = resultado.vinculos
    .filter((v) => ids.has(v.entradaId))
    .map((v) => ({ external_id: v.entradaId, nivel: v.nivel, confianca: v.confianca, settlements: v.baixaIds.map((id) => ({ id, amount: baixaPorId.get(id).centavos / 100 })) }));
  const ultimo = from + SIZE >= payload.length;
  const resumo = ultimo ? { arquivo: basename(file), lancamentos: payload.length, inicio: extrato.inicio, fim: extrato.fim, conciliados: resultado.vinculos.length } : null;
  const { data: r, error } = await supabase.rpc("finance_import_bank_entries", { p_org: org.id, p_account: conta, p_entries: lote, p_links: links, p_summary: resumo });
  if (error) {
    console.error(`\nFalha no lote ${from / SIZE + 1}: ${error.message}\nOs lotes anteriores ficaram gravados; rode de novo para continuar.`);
    process.exit(1);
  }
  inseridos += r.inserted;
  ignorados += r.skipped;
  vinculados += r.linked;
  console.log(`  lote ${from / SIZE + 1}: ${r.inserted} gravados · ${r.skipped} já existiam · ${r.linked} conciliados`);
}
console.log(`\nConcluído: ${inseridos} lançamentos gravados · ${ignorados} já existiam · ${vinculados} conciliações.`);
