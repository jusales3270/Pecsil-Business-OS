#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga do contas a receber do sistema antigo
 *
 * Lê o PDF "Contas à Receber/Recebidas (Agrupado Por Cliente)" e grava os
 * títulos em aberto no Financeiro (finance_titles + parcela + rateio por conta).
 * A leitura e as regras estão em lib/finance/contas-receber-parser.ts (testado
 * em tests/finance-contas-receber.test.mjs).
 *
 * Trava: a soma lida de cada grupo (Previsões / Sem Previsões / Total) e o
 * Total Geral têm de bater com o relatório ao centavo; senão, nada é gravado.
 *
 * O que NÃO entra (sai na lista "à parte" do relatório da carga):
 *   - títulos simbólicos de até R$ 1,00 (nota recusada/cancelada/refaturada);
 *   - título sem cliente.
 * Previsão entra marcada como previsão (fica fora do total "A receber").
 *
 * Reexecutável: cada título tem uma chave estável (`legacy_key`); rodar de novo
 * pula o que já entrou. Depois da carga a plataforma é a fonte — não é para
 * recarregar um relatório mais novo por cima.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-contas-receber-pdf.mjs --file "~/Desktop/Contas a Receber.pdf"
 *   node scripts/import-contas-receber-pdf.mjs --file … --apply
 *
 * Opções: --url <supabase> · --out <pasta> (padrão: ao lado do --file)
 * Requer SUPABASE_SERVICE_ROLE_KEY e, só para ler o PDF, o pacote pdfjs-dist
 * (não é dependência do app): npm i --no-save pdfjs-dist@4
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
// O leitor importa outro módulo .ts sem extensão: o gancho abaixo resolve, como nos testes.
import "../tests/ts-resolver.mjs";

const { conferir, isPlaceholder, legacyKey, parseContasReceber, reviewReasons } = await import("../lib/finance/contas-receber-parser.ts");

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
const report = parseContasReceber(pages);
const problems = conferir(report);
const brl = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const sum = (list) => list.reduce((acc, title) => acc + title.cents, 0);

console.log(`\nRelatório: ${pdf.numPages} páginas · ${report.titles.length} títulos · ${report.groups.length} grupos`);
if (problems.length) {
  console.error(`\nA leitura NÃO confere com o relatório (${problems.length} divergência(s)). Nada será gravado.`);
  problems.slice(0, 30).forEach((problem) => console.error("  - " + problem));
  process.exit(1);
}
console.log(`Conferido com o relatório ao centavo: previsões ${brl(report.grand.forecastCents)} · sem previsão ${brl(report.grand.realCents)} · total ${brl(report.grand.totalCents)}`);

// --- 3. O que entra e o que fica à parte ----------------------------------------
const seen = new Map();
const rows = report.titles.map((title) => {
  const base = legacyKey(title, 0);
  const occurrence = seen.get(base) ?? 0;
  seen.set(base, occurrence + 1);
  const skip = isPlaceholder(title) ? "Valor simbólico (nota recusada, cancelada ou refaturada)" : !title.client.trim() ? "Sem cliente" : null;
  return { title, key: legacyKey(title, occurrence), skip, review: reviewReasons(title) };
});
const entering = rows.filter((row) => !row.skip);
const aside = rows.filter((row) => row.skip);
const real = entering.filter((row) => !row.title.forecast);
const forecast = entering.filter((row) => row.title.forecast);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const lines = [];
const say = (text = "") => { lines.push(text); console.log(text); };
const table = (label, list) => say(`  ${label.padEnd(34)} ${String(list.length).padStart(4)} títulos  ${brl(sum(list.map((row) => row.title))).padStart(20)}`);

say("\n== O que entra ==");
table("A receber (sem previsão)", real);
table("  · vencidos", real.filter((row) => row.title.dueDate < today));
table("  · a vencer", real.filter((row) => row.title.dueDate >= today));
table("Previsões", forecast);
table("  · com data já passada", forecast.filter((row) => row.title.dueDate < today));
table("  · com data futura", forecast.filter((row) => row.title.dueDate >= today));
table("Total que entra", entering);

say("\n== A receber (sem previsão) por ano de vencimento ==");
for (const year of [...new Set(real.map((row) => row.title.dueDate.slice(0, 4)))].sort()) table(year, real.filter((row) => row.title.dueDate.startsWith(year)));
say("\n== Previsões por ano de vencimento ==");
for (const year of [...new Set(forecast.map((row) => row.title.dueDate.slice(0, 4)))].sort()) table(year, forecast.filter((row) => row.title.dueDate.startsWith(year)));

say("\n== A receber (sem previsão) por grupo ==");
for (const group of [...new Set(real.map((row) => row.title.group))]) table(group, real.filter((row) => row.title.group === group));

say(`\n== Fica à parte (não entra): ${aside.length} títulos · ${brl(sum(aside.map((row) => row.title)))} ==`);
for (const row of aside) say(`  ${row.title.group || "(sem grupo)"} · ${row.title.document || row.title.history.slice(0, 40) || "—"} · venc. ${row.title.dueDate} · ${brl(row.title.cents)} · ${row.skip}`);

const toReview = entering.filter((row) => row.review.length);
say(`\n== Entram com aviso "revisar": ${toReview.length} títulos · ${brl(sum(toReview.map((row) => row.title)))} ==`);
for (const row of toReview) say(`  ${row.title.group} · ${row.title.document || row.title.history.slice(0, 40)} · venc. ${row.title.dueDate} · ${brl(row.title.cents)} · ${row.review.join("; ")}`);

// --- 4. Banco: contas do plano, clientes e o que já entrou ----------------------
const supabaseUrl = getArg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
if (!env.SUPABASE_SERVICE_ROLE_KEY || !supabaseUrl?.startsWith("http")) {
  console.error("\nSem SUPABASE_SERVICE_ROLE_KEY ou URL do Supabase (--url): a simulação parou antes de conferir o banco.");
  process.exit(apply ? 1 : 0);
}
const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org, error: orgError } = await supabase.from("organizations").select("id").limit(1).single();
if (orgError) { console.error("Falha ao ler a organização:", orgError.message); process.exit(1); }

const codes = [...new Set(entering.flatMap((row) => row.title.allocations.map((allocation) => allocation.code).filter(Boolean)))].sort();
const { data: accounts } = await supabase.from("finance_chart_accounts").select("code,name,allows_posting,active").eq("organization_id", org.id).in("code", codes);
const known = new Map((accounts ?? []).map((account) => [account.code, account]));
const missing = codes.filter((code) => !known.has(code));
const blocked = codes.filter((code) => known.has(code) && (!known.get(code).allows_posting || !known.get(code).active));
say(`\n== Plano de contas: ${codes.length} contas usadas ==`);
for (const code of codes) say(`  ${code} ${known.get(code)?.name ?? "NÃO EXISTE NO PLANO"}`);
if (missing.length || blocked.length) {
  console.error(`\nContas que impedem a carga: faltando ${missing.join(", ") || "—"} · sem lançamento/inativas ${blocked.join(", ") || "—"}`);
  process.exit(1);
}

const normalize = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,;:/\\\-_()"']/g, " ").replace(/\s+/g, " ").trim();
const { data: customers } = await supabase.from("customers").select("name,normalized_name").eq("organization_id", org.id);
const existing = new Set((customers ?? []).map((customer) => customer.normalized_name));
const clients = [...new Map(entering.map((row) => [normalize(row.title.client), row.title.client])).entries()];
say(`\n== Clientes: ${clients.length} no relatório · ${clients.filter(([key]) => existing.has(key)).length} já cadastrados · ${clients.filter(([key]) => !existing.has(key)).length} serão criados ==`);
for (const [key, name] of clients) say(`  ${existing.has(key) ? "já existe " : "novo      "} ${name}`);

const { data: already } = await supabase.from("finance_titles").select("legacy_key").eq("organization_id", org.id).not("legacy_key", "is", null);
const loaded = new Set((already ?? []).map((row) => row.legacy_key));
const pending = entering.filter((row) => !loaded.has(row.key));
say(`\n== Banco: ${loaded.size} título(s) desta carga já gravado(s) · ${pending.length} a gravar ==`);

const csv = [["situacao", "grupo", "cliente", "lancamento", "vencimento", "documento", "tipo", "valor", "previsao", "contas", "historico", "observacao", "revisar"].join(";")];
const cell = (value) => `"${String(value ?? "").replace(/"/g, '""').replace(/\n/g, " | ")}"`;
for (const row of rows) {
  const t = row.title;
  csv.push([row.skip ? "fica à parte: " + row.skip : "entra", t.group, t.client, t.issueDate, t.dueDate, t.document, t.documentType, (t.cents / 100).toFixed(2).replace(".", ","), t.forecast ? "sim" : "não",
    t.allocations.filter((a) => a.code).map((a) => `${a.code} ${(a.cents / 100).toFixed(2).replace(".", ",")}`).join(" + "), t.history, t.notes, row.review.join("; ")].map(cell).join(";"));
}
const csvPath = resolve(outDir, "contas-receber-carga.csv");
const reportPath = resolve(outDir, "contas-receber-carga.txt");
writeFileSync(csvPath, "﻿" + csv.join("\n"));

if (!apply) {
  say("\nSIMULAÇÃO: nada foi gravado. Para gravar, rode de novo com --apply.");
  writeFileSync(reportPath, lines.join("\n"));
  console.log(`\nPlanilha: ${csvPath}\nResumo:   ${reportPath}`);
  process.exit(0);
}

// --- 5. Gravação (uma transação no banco) ---------------------------------------
const payload = pending.map((row) => {
  const t = row.title;
  // Mesma conta em duas linhas do rateio vira uma só.
  const byCode = new Map();
  for (const allocation of t.allocations) if (allocation.code && allocation.cents > 0) byCode.set(allocation.code, (byCode.get(allocation.code) ?? 0) + allocation.cents);
  return {
    legacy_key: row.key,
    group: t.group,
    client: t.client,
    document: t.document,
    document_type: t.documentType,
    history: t.history || t.document || "Sem histórico no sistema antigo",
    notes: t.notes,
    issue_date: t.issueDate,
    due_date: t.dueDate,
    amount: t.cents / 100,
    forecast: t.forecast,
    review_reason: row.review.join("; "),
    allocations: [...byCode].map(([code, cents]) => ({ code, amount: cents / 100 })),
  };
});
const { data: result, error } = await supabase.rpc("finance_import_receivables", { p_org: org.id, p_titles: payload });
if (error) { console.error("\nFalha na carga (nada foi gravado):", error.message); process.exit(1); }
say(`\nGRAVADO: ${result.inserted} títulos · ${Number(result.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · ${result.skipped} já existiam.`);
writeFileSync(reportPath, lines.join("\n"));
console.log(`\nPlanilha: ${csvPath}\nResumo:   ${reportPath}`);
