#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga do contas a pagar do sistema antigo
 *
 * Lê o PDF "Contas à Pagar/Pagas (Agrupado Por Fornecedor)" e grava os títulos
 * no Financeiro: título, parcela, rateio por conta do plano e, para o que já
 * foi pago, a baixa com data e valor. A leitura e as regras estão em
 * lib/finance/relatorio-titulos-parser.ts (testado em
 * tests/finance-contas-pagar.test.mjs).
 *
 * Trava: a soma lida de cada bloco (lançado, corrigido e pago) tem de bater com
 * o relatório. O sistema antigo soma valores não arredondados e erra 1 ou 2
 * centavos em alguns grupos: aceita-se até 1 centavo por título, e cada
 * diferença sai no resumo. Fora disso, nada é gravado.
 *
 * O que NÃO entra (lista "à parte" do resumo): títulos simbólicos de até
 * R$ 1,00. Previsão entra marcada como previsão (fora do total "A pagar").
 *
 * O arquivo tem folha e retiradas por pessoa: NÃO o coloque no repositório nem
 * envie nada dele a serviço externo.
 *
 * Reexecutável: cada título tem uma chave estável (`legacy_key`); rodar de novo
 * pula o que já entrou. Depois da carga a plataforma é a fonte.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-contas-pagar-pdf.mjs --file "~/Desktop/pagar 2026.pdf" --url http://<supabase>
 *   node scripts/import-contas-pagar-pdf.mjs --file … --url … --apply
 *
 * Opções:
 *   --out <pasta>                 onde gravar planilha e resumo (padrão: ao lado do --file)
 *   --arquivo-cortado             o PDF veio incompleto (ex.: "Página 1 de 6329" com 899
 *                                 páginas): aceita a falta do Total Geral e deixa de fora
 *                                 só o grupo que ficou sem bloco de totais
 *   --historico-antes AAAA-MM-DD  o que continua em aberto no relatório com vencimento
 *                                 antes desta data entra como "histórico a conferir"
 *                                 (fora dos totais, aba própria) até a equipe revisar
 *
 * Relatório mais completo por cima de uma carga anterior: só entra o que ainda não
 * está no banco (mesma chave), o que já foi gravado fica como está.
 * Requer SUPABASE_SERVICE_ROLE_KEY e, só para ler o PDF, o pacote pdfjs-dist
 * (não é dependência do app): npm i --no-save pdfjs-dist@4
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { LAYOUT_PAGAR, allocationIssue, conferirRelatorio, isPlaceholder, legacyKeyOf, parseRelatorioTitulos, reviewReasons } from "../lib/finance/relatorio-titulos-parser.ts";

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
  console.error("Informe o PDF: --file <caminho>");
  process.exit(1);
}
const outDir = resolve(getArg("--out")?.replace(/^~/, homedir()) ?? dirname(file));
const cortado = args.includes("--arquivo-cortado");
const historicoAntes = getArg("--historico-antes");
if (historicoAntes && !/^\d{4}-\d{2}-\d{2}$/.test(historicoAntes)) {
  console.error("--historico-antes pede uma data AAAA-MM-DD");
  process.exit(1);
}
const baseName = basename(file).replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();

// --- 1. Texto posicionado do PDF ------------------------------------------------
let getDocument;
try {
  ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
} catch {
  console.error("Falta o leitor de PDF (só esta carga usa): npm i --no-save pdfjs-dist@4");
  process.exit(1);
}
const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const pages = [];
for (let number = 1; number <= pdf.numPages; number += 1) {
  const content = await (await pdf.getPage(number)).getTextContent();
  pages.push(content.items.filter((item) => item.str.trim()).map((item) => ({ x: item.transform[4], y: item.transform[5], w: item.width, s: item.str })));
}

// --- 2. Leitura e conferência com os totais do relatório -------------------------
const report = parseRelatorioTitulos(pages, LAYOUT_PAGAR);
const conferencia = conferirRelatorio(report, 1);
const notices = conferencia.notices;
// Arquivo cortado: o último grupo termina sem totais e não há Total Geral. Só esses
// dois avisos são aceitos; o grupo incompleto fica de fora inteiro.
const semTotais = report.titles.filter((title) => title.block >= report.groups.length);
const problems = cortado
  ? conferencia.problems.filter((problem) => !/sem bloco de totais do grupo|Total Geral não encontrado/.test(problem))
  : conferencia.problems;
const brl = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const sum = (list, field = "cents") => list.reduce((acc, row) => acc + row.title[field], 0);

console.log(`\nRelatório: ${pdf.numPages} páginas · ${report.titles.length} títulos · ${report.groups.length} blocos de fornecedor`);
if (problems.length) {
  console.error(`\nA leitura NÃO confere com o relatório (${problems.length} divergência(s)). Nada será gravado.`);
  problems.slice(0, 30).forEach((problem) => console.error("  - " + problem));
  process.exit(1);
}

// --- 3. O que entra e o que fica à parte ----------------------------------------
const squeeze = (text) => text.replace(/\s+/g, "");
const seen = new Map();
const rows = report.titles.map((original) => {
  const incompleto = semTotais.includes(original);
  // O nome do fornecedor quebra no meio da palavra dentro do título; o do grupo vem inteiro.
  const title = { ...original, party: squeeze(original.party) === squeeze(original.group) ? original.group : original.party };
  const base = legacyKeyOf("cp", title, 0);
  const occurrence = seen.get(base) ?? 0;
  seen.set(base, occurrence + 1);
  // Título já pago não precisa de conferência de data; só o em aberto.
  const review = title.paid ? [] : reviewReasons(title, "fornecedor");
  // Rateio: diferença de até 2 centavos é arredondamento (ajusta a maior linha); acima disso, a equipe revisa.
  const issue = allocationIssue(title);
  let allocations = title.allocations.filter((allocation) => allocation.code && allocation.cents > 0);
  if (issue && Math.abs(issue.diff) <= 2 && allocations.length) {
    const largest = allocations.reduce((a, b) => (b.cents > a.cents ? b : a));
    allocations = allocations.map((allocation) => (allocation === largest ? { ...allocation, cents: allocation.cents - issue.diff } : allocation));
  } else if (issue) review.push(`Rateio do relatório soma ${brl(issue.allocated)}, não o valor do título`);
  const semFornecedor = !title.party.replace(/\*/g, "").trim();
  const skip = incompleto ? "Grupo cortado no fim do arquivo (sem totais para conferir)"
    : isPlaceholder(title) ? "Valor simbólico (até R$ 1,00)"
    : semFornecedor ? "Sem fornecedor no relatório"
    : !allocations.length ? "Sem conta do plano no relatório"
    : null;
  // Em aberto há muito tempo no sistema antigo: histórico a conferir, fora dos totais.
  const historical = Boolean(historicoAntes && !title.paid && title.dueDate < historicoAntes);
  if (historical) review.unshift(`Histórico do sistema antigo: em aberto lá desde ${title.dueDate.split("-").reverse().join("/")}; conferir se foi pago`);
  return { title, allocations, key: legacyKeyOf("cp", title, occurrence), skip, review, historical };
});
const entering = rows.filter((row) => !row.skip);
const aside = rows.filter((row) => row.skip);
const paid = entering.filter((row) => row.title.paid);
const historical = entering.filter((row) => row.historical);
const open = entering.filter((row) => !row.title.paid && !row.title.forecast && !row.historical);
const forecast = entering.filter((row) => !row.title.paid && row.title.forecast && !row.historical);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const lines = [];
const say = (text = "") => { lines.push(text); console.log(text); };
const table = (label, list, field = "cents") => say(`  ${label.padEnd(36)} ${String(list.length).padStart(5)} títulos  ${brl(sum(list, field)).padStart(20)}`);
say(`Conferido com o relatório: ${report.groups.length} blocos dentro da tolerância de 1 centavo por título.`);
if (report.grand) say(`Total Geral impresso: lançado ${brl(report.grand.total.issued)} · pago ${brl(report.grand.total.paid)}`);
else say(`ARQUIVO CORTADO: sem Total Geral. ${semTotais.length} título(s) do grupo ${semTotais[0]?.group ?? "—"} ficam de fora por não terem totais.`);
say(`Soma das linhas:      lançado ${brl(report.titles.reduce((a, t) => a + t.cents, 0))} · pago ${brl(report.titles.reduce((a, t) => a + t.paidCents, 0))}`);

say("\n== O que entra ==");
table("Pagos (valor dos títulos)", paid);
table("Pagos (valor pago, com juros)", paid, "paidCents");
table("A pagar (em aberto, sem previsão)", open);
table("  · vencidos", open.filter((row) => row.title.dueDate < today));
table("  · a vencer", open.filter((row) => row.title.dueDate >= today));
table("Previsões (em aberto)", forecast);
table("  · com data já passada", forecast.filter((row) => row.title.dueDate < today));
table("  · com data futura", forecast.filter((row) => row.title.dueDate >= today));
table("Histórico a conferir (em aberto antes de " + (historicoAntes ?? "—") + ")", historical);
table("  · eram previsão", historical.filter((row) => row.title.forecast));
table("Total que entra", entering);

const months = [...new Set(entering.map((row) => row.title.dueDate.slice(0, 7)))].sort();
say("\n== Por mês de vencimento: pagos · a pagar · previsões ==");
for (const month of months) {
  const of = (list) => list.filter((row) => row.title.dueDate.startsWith(month));
  say(`  ${month}   pagos ${String(of(paid).length).padStart(4)} ${brl(sum(of(paid))).padStart(17)}   a pagar ${String(of(open).length).padStart(4)} ${brl(sum(of(open))).padStart(16)}   previsões ${String(of(forecast).length).padStart(4)} ${brl(sum(of(forecast))).padStart(16)}`);
}
say("\n== Pago por mês (data do pagamento) ==");
for (const month of [...new Set(paid.map((row) => row.title.paidDate.slice(0, 7)))].sort()) table(month, paid.filter((row) => row.title.paidDate.startsWith(month)), "paidCents");

say("\n== Maiores fornecedores em aberto (sem previsão) ==");
const byParty = new Map();
for (const row of open) byParty.set(row.title.group, [...(byParty.get(row.title.group) ?? []), row]);
for (const [name, list] of [...byParty].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 15)) table(name.slice(0, 36), list);

const above = paid.filter((row) => row.title.paidCents > row.title.cents);
say(`\n== Pagos a maior (a diferença entra como juros/tarifa): ${above.length} títulos · ${brl(above.reduce((a, row) => a + row.title.paidCents - row.title.cents, 0))} ==`);
for (const row of above) say(`  ${row.title.group} · ${row.title.document} · ${brl(row.title.cents)} → pago ${brl(row.title.paidCents)}`);

say(`\n== Fica à parte (não entra): ${aside.length} títulos · ${brl(sum(aside))} ==`);
for (const row of aside) say(`  ${row.title.group} · ${row.title.document || row.title.history.slice(0, 40) || "—"} · venc. ${row.title.dueDate} · ${brl(row.title.cents)} · ${row.skip}`);

const toReview = entering.filter((row) => row.review.length && !row.historical);
say(`\n== Entram com aviso "revisar": ${toReview.length} títulos · ${brl(sum(toReview))} ==`);
for (const row of toReview) say(`  ${row.title.group} · ${row.title.document || row.title.history.slice(0, 40)} · lanç. ${row.title.issueDate} · venc. ${row.title.dueDate} · ${brl(row.title.cents)} · ${row.title.paid ? "pago" : "em aberto"} · ${row.review.join("; ")}`);

say(`\n== Diferenças de centavos do próprio relatório: ${notices.length} ==`);
for (const notice of notices) say("  " + notice);

// --- 4. Banco: contas do plano, fornecedores e o que já entrou ------------------
const supabaseUrl = getArg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
if (!env.SUPABASE_SERVICE_ROLE_KEY || !supabaseUrl?.startsWith("http")) {
  console.error("\nSem SUPABASE_SERVICE_ROLE_KEY ou URL do Supabase (--url): a simulação parou antes de conferir o banco.");
  process.exit(apply ? 1 : 0);
}
const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org, error: orgError } = await supabase.from("organizations").select("id").limit(1).single();
if (orgError) { console.error("Falha ao ler a organização:", orgError.message); process.exit(1); }
/** Lê a tabela inteira de 1.000 em 1.000 (a API corta a resposta). */
async function readAll(tableName, columns, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(tableName).select(columns)).range(from, from + 999);
    if (error) { console.error(`Falha ao ler ${tableName}:`, error.message); process.exit(1); }
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const codes = [...new Set(entering.flatMap((row) => row.allocations.map((allocation) => allocation.code)))].sort();
const accounts = await readAll("finance_chart_accounts", "code,name,allows_posting,active", (q) => q.eq("organization_id", org.id).not("code", "is", null));
const known = new Map(accounts.map((account) => [account.code, account]));
const missing = codes.filter((code) => !known.has(code));
const blocked = codes.filter((code) => known.has(code) && (!known.get(code).allows_posting || !known.get(code).active));
say(`\n== Plano de contas: ${codes.length} contas usadas, ${missing.length} fora do plano, ${blocked.length} sem lançamento ==`);
if (missing.length || blocked.length) {
  console.error(`Contas que impedem a carga: faltando ${missing.join(", ") || "—"} · sem lançamento/inativas ${blocked.join(", ") || "—"}`);
  process.exit(1);
}

const normalize = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,;:/\\\-_()"']/g, " ").replace(/\s+/g, " ").trim();
const suppliers = await readAll("suppliers", "normalized_name", (q) => q.eq("organization_id", org.id));
const existing = new Set(suppliers.map((supplier) => supplier.normalized_name));
const parties = [...new Map(entering.map((row) => [normalize(row.title.party), row.title.party])).entries()];
const fresh = parties.filter(([key]) => !existing.has(key));
say(`\n== Fornecedores: ${parties.length} no relatório · ${parties.length - fresh.length} já cadastrados · ${fresh.length} serão criados ==`);

const already = await readAll("finance_titles", "legacy_key", (q) => q.eq("organization_id", org.id).like("legacy_key", "cp|%"));
const loaded = new Set(already.map((row) => row.legacy_key));
const pending = entering.filter((row) => !loaded.has(row.key));
const known2 = entering.filter((row) => loaded.has(row.key));
say(`\n== Banco: ${loaded.size} título(s) do sistema antigo já gravado(s) · ${known2.length} deste arquivo já estão lá (ficam como estão) · ${pending.length} a gravar ==`);
const tablePending = (label, list, field) => table(label, list.filter((row) => !loaded.has(row.key)), field);
tablePending("  · pagos", paid);
tablePending("  · a pagar", open);
tablePending("  · previsões", forecast);
tablePending("  · histórico a conferir", historical);

const csv = [["situacao", "no_banco", "fornecedor", "lancamento", "vencimento", "pagamento", "documento", "tipo", "valor", "valor_pago", "previsao", "contas", "historico", "observacao", "revisar"].join(";")];
const cell = (value) => `"${String(value ?? "").replace(/"/g, '""').replace(/\n/g, " | ")}"`;
const num = (cents) => (cents / 100).toFixed(2).replace(".", ",");
for (const row of rows) {
  const t = row.title;
  csv.push([row.skip ? "fica à parte: " + row.skip : t.paid ? "pago" : row.historical ? "histórico a conferir" : t.forecast ? "previsão" : "a pagar", loaded.has(row.key) ? "já gravado" : row.skip ? "" : "novo", t.party, t.issueDate, t.dueDate, t.paidDate ?? "", t.document, t.documentType, num(t.cents), t.paid ? num(t.paidCents) : "", t.forecast ? "sim" : "não",
    row.allocations.map((a) => `${a.code} ${num(a.cents)}`).join(" + "), t.history, t.notes, row.review.join("; ")].map(cell).join(";"));
}
const csvPath = resolve(outDir, `${baseName}-carga.csv`);
const reportPath = resolve(outDir, `${baseName}-carga.txt`);
writeFileSync(csvPath, "﻿" + csv.join("\n"), { mode: 0o600 });

if (!apply) {
  say("\nSIMULAÇÃO: nada foi gravado. Para gravar, rode de novo com --apply.");
  writeFileSync(reportPath, lines.join("\n"), { mode: 0o600 });
  console.log(`\nPlanilha: ${csvPath}\nResumo:   ${reportPath}`);
  process.exit(0);
}

// --- 5. Gravação (lotes de 250, cada um numa transação; o último grava o resumo) ---
const payload = pending.map((row) => {
  const t = row.title;
  // Mesma conta em duas linhas do rateio vira uma só.
  const byCode = new Map();
  for (const allocation of row.allocations) byCode.set(allocation.code, (byCode.get(allocation.code) ?? 0) + allocation.cents);
  return {
    legacy_key: row.key,
    group: t.group,
    party: t.party,
    document: t.document,
    document_type: t.documentType,
    history: t.history || t.document || "Sem histórico no sistema antigo",
    notes: t.notes,
    issue_date: t.issueDate,
    due_date: t.dueDate,
    amount: t.cents / 100,
    forecast: t.forecast,
    historical: row.historical,
    review_reason: row.review.join("; "),
    paid_date: t.paid ? t.paidDate : null,
    paid_amount: t.paid ? t.paidCents / 100 : null,
    allocations: [...byCode].map(([code, cents]) => ({ code, amount: cents / 100 })),
  };
});
const done = { inserted: 0, skipped: 0, settled: 0, amount: 0 };
const SIZE = 250;
for (let from = 0; from < payload.length || from === 0; from += SIZE) {
  const last = from + SIZE >= payload.length;
  const { data: result, error } = await supabase.rpc("finance_import_titles", { p_org: org.id, p_direction: "payable", p_titles: payload.slice(from, from + SIZE), p_summary: last });
  if (error) {
    console.error(`\nFalha no lote ${from / SIZE + 1} (os lotes anteriores ficaram gravados; rode de novo para continuar):`, error.message);
    process.exit(1);
  }
  for (const key of Object.keys(done)) done[key] += Number(result[key]);
  process.stdout.write(`\r  gravados ${done.inserted} de ${payload.length}`);
  if (last) break;
}
say(`\nGRAVADO: ${done.inserted} títulos · ${done.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · ${done.settled} com baixa · ${done.skipped} já existiam.`);
writeFileSync(reportPath, lines.join("\n"), { mode: 0o600 });
console.log(`\nPlanilha: ${csvPath}\nResumo:   ${reportPath}`);
