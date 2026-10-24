#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Complemento do cadastro de fornecedores pela exportação do GRV
 *
 * Lê FORNECEDORES.xlsx (cadastro de fornecedores do GRV) e, para cada fornecedor da plataforma
 * que casa com uma linha (mesmo CNPJ; ou mesmo nome sem ambiguidade), COMPLETA só os campos vazios:
 * CNPJ, IE, e-mail, telefone, endereço, cidade, UF, CEP, razão social e contato. Nunca sobrescreve.
 * Regra em lib/compras/fornecedores-carga.ts.
 *
 * Fica FORA (no relatório, para decisão de quem responde pelo cadastro):
 *   - pessoa física (nenhum dado pessoal entra sem decisão da área);
 *   - nome com mais de um CNPJ possível na planilha (ambíguo) e CNPJ diferente do que já existe;
 *   - fornecedores que só existem no GRV (não são criados aqui).
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-fornecedores-grv.mjs [--arquivo ~/Downloads/FORNECEDORES.xlsx]
 *        [--relatorio <arquivo.csv>] [--url http://<supabase>] [--apply]
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { lerXlsx } from "../lib/arquivos/xlsx.ts";
import { planejarCarga } from "../lib/compras/fornecedores-carga.ts";

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
const arquivo = (arg("--arquivo") ?? "~/Downloads/FORNECEDORES.xlsx").replace(/^~/, homedir());
const relatorio = (arg("--relatorio") ?? "~/Desktop/Pecsil - Fornecedores do GRV (conferência).csv").replace(/^~/, homedir());

if (!existsSync(arquivo)) { console.error(`Planilha não encontrada: ${arquivo}`); process.exit(1); }
const [cabeca, ...resto] = lerXlsx(readFileSync(arquivo));
const colunas = (cabeca ?? []).map((c) => String(c ?? "").trim());
if (!colunas.includes("*C.N.P.J/CPF") || !colunas.includes("*Razão Social")) { console.error("Não é a exportação do cadastro de fornecedores do GRV."); process.exit(1); }
const planilha = resto.filter((r) => r.some((c) => c !== null && String(c).trim() !== "")).map((r) => Object.fromEntries(colunas.map((c, i) => [c, r[i] ?? null])));
console.log(`Planilha: ${planilha.length} fornecedores`);

const supabaseUrl = arg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL;
if (!env.SUPABASE_SERVICE_ROLE_KEY || !supabaseUrl?.startsWith("http")) { console.error("\nSem SUPABASE_SERVICE_ROLE_KEY ou --url."); process.exit(1); }
const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: orgs } = await supabase.from("organizations").select("id");
if (orgs?.length !== 1) { console.error("A carga precisa de exatamente uma empresa no banco."); process.exit(1); }
const org = orgs[0].id;
const { data: fiscal } = await supabase.from("fiscal_config").select("cnpj").eq("organization_id", org).maybeSingle();
const fornecedores = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await supabase.from("suppliers")
    .select("id, name, legal_name, trade_name, tax_id, state_registration, contact_name, phone, email, address, city, state, postal_code, merged_into")
    .eq("organization_id", org).range(de, de + 999);
  if (error) { console.error("Não consegui ler os fornecedores:", error.message); process.exit(1); }
  fornecedores.push(...data); if (data.length < 1000) break;
}
console.log(`Plataforma: ${fornecedores.length} fornecedores (${fornecedores.filter((f) => !f.merged_into).length} sem unificação)`);

const plano = planejarCarga(planilha, fornecedores, fiscal?.cnpj ?? "");
const porCampo = {};
for (const c of plano.completar) for (const k of Object.keys(c.campos)) porCampo[k] = (porCampo[k] ?? 0) + 1;
console.log(`\nA completar: ${plano.completar.length} fornecedores (${plano.completar.filter((c) => c.como === "cnpj").length} pelo CNPJ, ${plano.completar.filter((c) => c.como === "nome").length} pelo nome)`);
console.log("Campos:", JSON.stringify(porCampo));
console.log(`Já completos: ${plano.jaCompletos} · Ambíguos: ${plano.ambiguos.length} · Pessoa física (fora): ${plano.pessoaFisica.length} · Sem par: ${plano.semPar.length}`);
console.log(`Só no GRV: ${plano.novos.length} (${plano.novos.filter((n) => n.tipo === "Transportadora").length} transportadoras, ${plano.novos.filter((n) => n.pessoa === "PF").length} pessoa física) · CNPJ repetido na planilha: ${plano.repetidosNaPlanilha.length}`);

// Relatório para a conferência (sem CPF e sem dado de pessoa física).
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const NOMES = { tax_id: "CNPJ", state_registration: "IE", email: "E-mail", phone: "Telefone", address: "Endereço", city: "Cidade", state: "UF", postal_code: "CEP", legal_name: "Razão social", contact_name: "Contato" };
const linhas = [["Situação", "Fornecedor na plataforma", "No GRV", "Como casou", "O que completa", "Observação"].map(esc).join(";")];
for (const c of plano.completar) linhas.push(["Completar", c.nome, c.razaoGrv, c.como === "cnpj" ? "CNPJ" : "Nome", Object.entries(c.campos).map(([k, v]) => `${NOMES[k]}: ${v}`).join(" | "), ""].map(esc).join(";"));
for (const a of plano.ambiguos) linhas.push(["Conferir (ambíguo)", a.nome, a.opcoes.join(" | "), "", "", "Escolha o certo antes de completar"].map(esc).join(";"));
for (const p of plano.pessoaFisica) linhas.push(["Pessoa física", p.nome, "", "", "", "Nada entra sem a decisão da área (dado pessoal)"].map(esc).join(";"));
for (const s of plano.semPar) linhas.push(["Sem par no GRV", s.nome, "", "", "", ""].map(esc).join(";"));
for (const r of plano.repetidosNaPlanilha) linhas.push(["CNPJ repetido no GRV", "", r.razoes.join(" | "), "", "", "Fica de fora até corrigir no GRV"].map(esc).join(";"));
for (const n of plano.novos) linhas.push([n.tipo === "Transportadora" ? "Só no GRV (transportadora)" : "Só no GRV", "", n.pessoa === "PF" ? "(pessoa física)" : n.razao, "", n.pessoa === "PF" ? "" : `${n.cidade}${n.uf ? `/${n.uf}` : ""}`, n.inativo ? "Inativo no GRV" : ""].map(esc).join(";"));
writeFileSync(relatorio, "﻿" + linhas.join("\n"));
console.log(`\nRelatório: ${relatorio}`);

if (!apply) { console.log("\nSIMULAÇÃO: nada foi gravado. Para gravar só os campos a completar, rode de novo com --apply."); process.exit(0); }

let feitos = 0;
const duplicados = [];
const gravar = async (id, campos) => {
  // Garante que o campo continua vazio na hora de gravar (nunca sobrescreve).
  let q = supabase.from("suppliers").update({ ...campos, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", org);
  for (const k of Object.keys(campos)) q = q.or(`${k}.is.null,${k}.eq.`);
  return (await q).error;
};
for (const c of plano.completar) {
  let error = await gravar(c.id, c.campos);
  // CNPJ que já é de OUTRO fornecedor da plataforma: cadastro duplicado (unificação, I-01).
  // Completa o resto sem o CNPJ e deixa o par listado.
  if (error?.code === "23505" && c.campos.tax_id) {
    const { tax_id, ...resto } = c.campos;
    const { data: dono } = await supabase.from("suppliers").select("name").eq("organization_id", org).eq("tax_id", tax_id).maybeSingle();
    duplicados.push(`${c.nome} × ${dono?.name ?? "?"} (CNPJ ${tax_id})`);
    error = Object.keys(resto).length ? await gravar(c.id, resto) : null;
  }
  if (error) { console.error(`${c.nome}: ${error.message}`); continue; }
  feitos++;
}
console.log(`\nGravado: ${feitos} de ${plano.completar.length} fornecedores completados.`);
if (duplicados.length) console.log(`\nCNPJ já em outro fornecedor (duplicados para a unificação, sem o CNPJ):\n  ${duplicados.join("\n  ")}`);
