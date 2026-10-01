#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga do histórico do Painel do ICMS
 *
 * Traz as planilhas mensais do ICMS que estavam no app antigo de Compras (cópia
 * da nuvem guardada em ~/.config/pecsil/compras-snapshot.json, tabelas
 * icms_planilhas, icms_rows e icms_livro) para o módulo Fiscal:
 *   - cada linha vira uma nota em fiscal_icms_entries (origem "historico");
 *   - o livro de apuração vira fiscal_icms_ledger.
 *
 * Situação: a planilha guardava "XML/LACTO/AUT" como texto ("OK/OK/OK",
 * "NFSe./OK/**", "OK/REMESSA/OK"). Cada marcação só fica ligada quando a coluna
 * diz OK; o texto original vai para a observação, para não perder nada.
 * Centro: "Fundição + Usinagem" liga F e U; "Não classificado" fica sem centro.
 *
 * Reexecutável: cada linha tem chave (`legacy_key`); rodar de novo só acrescenta.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-icms-historico.mjs [--file <snapshot.json>] [--url http://<supabase>] [--apply]
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const env = { ...process.env };
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim(); const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i < 0) continue;
    const key = t.slice(0, i).trim();
    if (process.env[key] === undefined) env[key] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const apply = args.includes("--apply");
const file = (arg("--file") ?? "~/.config/pecsil/compras-snapshot.json").replace(/^~/, homedir());
if (!existsSync(file)) { console.error(`Cópia não encontrada: ${file}`); process.exit(1); }

const tabelas = JSON.parse(readFileSync(file, "utf8")).tabelas ?? {};
const lista = (nome) => (Array.isArray(tabelas[nome]) ? tabelas[nome] : tabelas[nome]?.rows ?? []);
const planilhas = new Map(lista("icms_planilhas").map((p) => [p.id, p.mes]));
const linhas = lista("icms_rows");
const livro = lista("icms_livro");

const data = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const dinheiro = (v) => Math.round(Number(v || 0) * 100) / 100;
const ok = (parte) => (parte ?? "").trim().toUpperCase() === "OK";

const semPlanilha = [];
const notas = [];
for (const r of linhas) {
  const mes = planilhas.get(r.planilha_id);
  if (!mes) { semPlanilha.push(r.id); continue; }
  const [xml, lacto, aut] = String(r.status ?? "").split("/");
  const centro = String(r.centro ?? "");
  const obs = [r.obs, r.status && r.status !== "OK/OK/OK" ? `Planilha: ${r.status}` : null].filter(Boolean).join(" | ");
  notas.push({
    legacy_key: `icms|${r.id}`,
    competencia: `${mes}-01`,
    emitida: data(r.emitida),
    recebida: data(r.recebida),
    fornecedor: String(r.fornecedor || r.fantasia || "(sem fornecedor)").trim(),
    fantasia: r.fantasia ? String(r.fantasia).trim() : null,
    nfe: r.nfe ? String(r.nfe).trim() : null,
    valor: dinheiro(r.valor),
    vlr_cobrado: dinheiro(r.vlr_cobrado),
    icms: dinheiro(r.icms),
    ipi: dinheiro(r.ipi),
    tipo: r.tipo ? String(r.tipo).trim() : null,
    fundicao: centro.includes("Fundição"),
    usinagem: centro.includes("Usinagem"),
    administrativo: centro.includes("Administrativo"),
    xml_ok: ok(xml),
    lancado: ok(lacto),
    autorizado: ok(aut),
    obs: obs || null,
    origem: "historico",
    created_by_name: "Planilha do ICMS (app antigo)",
  });
}
const apuracao = livro.filter((l) => planilhas.has(l.planilha_id)).sort((a, b) => a.id - b.id).map((l, i, todas) => ({
  legacy_key: `livro|${l.id}`,
  competencia: `${planilhas.get(l.planilha_id)}-01`,
  ordem: todas.slice(0, i).filter((x) => x.planilha_id === l.planilha_id).length + 1,
  descricao: String(l.descricao || "—").trim(),
  credito: dinheiro(l.credito),
  debito: dinheiro(l.debito),
  saldo: l.saldo === null || l.saldo === undefined ? null : dinheiro(l.saldo),
}));

const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
console.log(`\nCópia: ${file}`);
console.log(`Planilhas: ${planilhas.size} (${[...planilhas.values()].sort().join(", ")})`);
console.log(`Notas: ${notas.length} · livro: ${apuracao.length} linhas${semPlanilha.length ? ` · ${semPlanilha.length} sem planilha (ficam de fora)` : ""}`);
console.log("\nPor mês: notas · valor · ICMS · IPI · F/U/RS · XML/LACTO/AUT ok");
for (const mes of [...new Set(notas.map((n) => n.competencia))].sort()) {
  const m = notas.filter((n) => n.competencia === mes);
  const s = (k) => m.reduce((a, n) => a + n[k], 0);
  const c = (k) => m.filter((n) => n[k]).length;
  console.log(`  ${mes.slice(0, 7)}  ${String(m.length).padStart(4)}  ${brl(s("valor")).padStart(16)}  ${brl(s("icms")).padStart(13)}  ${brl(s("ipi")).padStart(12)}  ${c("fundicao")}/${c("usinagem")}/${c("administrativo")}  ${c("xml_ok")}/${c("lancado")}/${c("autorizado")}`);
}

const supabaseUrl = arg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL;
if (!env.SUPABASE_SERVICE_ROLE_KEY || !supabaseUrl?.startsWith("http")) { console.error("\nSem SUPABASE_SERVICE_ROLE_KEY ou --url."); process.exit(apply ? 1 : 0); }
const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org } = await supabase.from("organizations").select("id").limit(1).single();
const chaves = async (tabela) => {
  const out = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(tabela).select("legacy_key").not("legacy_key", "is", null).range(from, from + 999);
    if (error) { console.error(`Falha ao ler ${tabela}:`, error.message); process.exit(1); }
    data.forEach((r) => out.add(r.legacy_key));
    if (data.length < 1000) return out;
  }
};
const jaNotas = await chaves("fiscal_icms_entries");
const jaLivro = await chaves("fiscal_icms_ledger");
const novasNotas = notas.filter((n) => !jaNotas.has(n.legacy_key)).map((n) => ({ ...n, organization_id: org.id }));
const novoLivro = apuracao.filter((l) => !jaLivro.has(l.legacy_key)).map((l) => ({ ...l, organization_id: org.id }));
console.log(`\nBanco: ${jaNotas.size} nota(s) e ${jaLivro.size} linha(s) do livro já carregadas · a gravar: ${novasNotas.length} notas e ${novoLivro.length} linhas`);

if (!apply) { console.log("\nSIMULAÇÃO: nada foi gravado. Para gravar, rode de novo com --apply."); process.exit(0); }
for (let i = 0; i < novasNotas.length; i += 500) {
  const { error } = await supabase.from("fiscal_icms_entries").insert(novasNotas.slice(i, i + 500));
  if (error) { console.error(`Falha no lote ${i / 500 + 1} das notas (os anteriores ficaram; rode de novo para continuar):`, error.message); process.exit(1); }
}
if (novoLivro.length) {
  const { error } = await supabase.from("fiscal_icms_ledger").insert(novoLivro);
  if (error) { console.error("Falha no livro de apuração:", error.message); process.exit(1); }
}
console.log(`\nGRAVADO: ${novasNotas.length} notas e ${novoLivro.length} linhas do livro.`);
