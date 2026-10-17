#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Complemento do cadastro de clientes pela exportação do GRV (C-01)
 *
 * Lê CLIENTE.xlsx (cadastro de clientes do GRV) e completa, só nos campos VAZIOS, os clientes da
 * plataforma que casam sem ambiguidade (pessoa jurídica no Brasil): CNPJ, IE, indicador da IE, CEP,
 * logradouro, bairro, município, UF e telefone. Regra em lib/comercial/clientes-carga.ts.
 * Com --cnpj, completa pela consulta pública de CNPJ (decisão de 13/10/2026; só o CNPJ sai) o que o
 * GRV não tem: número, complemento, código IBGE do município e e-mail para a NF-e.
 *
 * Fica FORA (relatório para o Comercial; exterior para o Fiscal): fábricas do mesmo cliente,
 * duplicados na plataforma, exterior, pessoa física, sem par e quem só existe no GRV.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-clientes-grv.mjs [--arquivo ~/Downloads/CLIENTE.xlsx] [--relatorio <csv>]
 *        [--url http://<supabase>] [--apply] [--cnpj]
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { lerXlsx } from "../lib/arquivos/xlsx.ts";
import { planejarClientes } from "../lib/comercial/clientes-carga.ts";
import { consultarCnpj } from "../lib/fiscal/consulta-publica.ts";

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
const comCnpj = args.includes("--cnpj");
const arquivo = (arg("--arquivo") ?? "~/Downloads/CLIENTE.xlsx").replace(/^~/, homedir());
const relatorio = (arg("--relatorio") ?? "~/Desktop/PecSil - Clientes do GRV (conferência).csv").replace(/^~/, homedir());
const HOJE = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

if (!existsSync(arquivo)) { console.error(`Planilha não encontrada: ${arquivo}`); process.exit(1); }
const [cabeca, ...resto] = lerXlsx(readFileSync(arquivo));
const colunas = (cabeca ?? []).map((c) => String(c ?? "").trim());
if (!colunas.includes("CNPJ / CPF") || !colunas.includes("R. Social")) { console.error("Não é a exportação do cadastro de clientes do GRV."); process.exit(1); }
const planilha = resto.filter((r) => r.some((c) => c !== null && String(c).trim() !== "")).map((r) => Object.fromEntries(colunas.map((c, i) => [c, r[i] ?? null])));
console.log(`Planilha: ${planilha.length} clientes`);

const supabaseUrl = arg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL;
if (!env.SUPABASE_SERVICE_ROLE_KEY || !supabaseUrl?.startsWith("http")) { console.error("\nSem SUPABASE_SERVICE_ROLE_KEY ou --url."); process.exit(1); }
const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: orgs } = await supabase.from("organizations").select("id");
if (orgs?.length !== 1) { console.error("A carga precisa de exatamente uma empresa no banco."); process.exit(1); }
const org = orgs[0].id;
const { data: clientes, error } = await supabase.from("customers")
  .select("id, name, tax_id, ie, ind_ie, cep, logradouro, numero, complemento, bairro, municipio, codigo_municipio, uf, telefone, email_nfe, merged_into")
  .eq("organization_id", org);
if (error) { console.error("Não consegui ler os clientes:", error.message); process.exit(1); }
console.log(`Plataforma: ${clientes.length} clientes`);

const plano = planejarClientes(planilha, clientes);
const porCampo = {};
for (const c of plano.completar) for (const k of Object.keys(c.campos)) porCampo[k] = (porCampo[k] ?? 0) + 1;
console.log(`\nA completar: ${plano.completar.length} clientes · campos: ${JSON.stringify(porCampo)}`);
console.log(`Já completos: ${plano.jaCompletos} · Fábricas (Comercial escolhe): ${plano.fabricas.length} · Duplicados (unificar): ${plano.duplicados.length} · Exterior (Fiscal): ${plano.exterior.length} · Pessoa física: ${plano.pessoaFisica.length} · Sem par: ${plano.semPar.length}`);
console.log(`Só no GRV: ${plano.novos.length} (${plano.novos.filter((n) => n.pessoa === "PF").length} pessoa física)`);

const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const linhas = [["Situação", "Cliente na plataforma", "No GRV", "O que completa / opções", "Quem decide"].map(esc).join(";")];
for (const c of plano.completar) linhas.push(["Completar", c.nome, c.razaoGrv, Object.entries(c.campos).map(([k, v]) => `${k}: ${v}`).join(" | "), ""].map(esc).join(";"));
for (const f of plano.fabricas) linhas.push(["Escolher a fábrica", f.nome, "", f.opcoes.join(" | "), "Comercial (Rafael)"].map(esc).join(";"));
for (const d of plano.duplicados) linhas.push(["Duplicado na plataforma", d.nomes.join(" | "), d.razaoGrv, "Unificar antes de completar", "Comercial (Rafael)"].map(esc).join(";"));
for (const e of plano.exterior) linhas.push(["Exterior", e.nome, e.pais, "Destinatário da NF-e de exportação", "Fiscal (Jefferson)"].map(esc).join(";"));
for (const p of plano.pessoaFisica) linhas.push(["Pessoa física", p.nome, "", "Nada entra sem decisão (dado pessoal)", "Comercial"].map(esc).join(";"));
for (const s of plano.semPar) linhas.push(["Sem par no GRV", s.nome, "", "", ""].map(esc).join(";"));
for (const n of plano.novos) linhas.push(["Só no GRV", "", n.pessoa === "PF" ? "(pessoa física)" : `${n.nome} · ${n.razao}`, n.pessoa === "PF" ? "" : `${n.cidade}/${n.uf}${n.pais && n.pais !== "BRASIL" ? ` · ${n.pais}` : ""}`, "Comercial (Rafael)"].map(esc).join(";"));
writeFileSync(relatorio, "﻿" + linhas.join("\n"));
console.log(`\nRelatório: ${relatorio}`);

if (!apply) { console.log("\nSIMULAÇÃO: nada foi gravado. Para gravar, rode com --apply (e --cnpj para a consulta pública)."); process.exit(0); }

const gravar = async (id, campos) => {
  // Só grava campo que continua vazio (nunca sobrescreve).
  let q = supabase.from("customers").update({ ...campos, dados_fiscais_em: new Date().toISOString(), dados_fiscais_por: `GRV (carga de ${HOJE})`, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", org);
  for (const k of Object.keys(campos)) q = q.or(typeof campos[k] === "number" ? `${k}.is.null` : `${k}.is.null,${k}.eq.`);
  return (await q).error;
};
let feitos = 0;
for (const c of plano.completar) {
  const e = await gravar(c.id, c.campos);
  if (e) { console.error(`${c.nome}: ${e.message}`); continue; }
  feitos++;
}
console.log(`\nGravado do GRV: ${feitos} de ${plano.completar.length} clientes.`);
if (!comCnpj) process.exit(0);

// Consulta pública de CNPJ: completa o que o GRV não tem.
const { data: agora } = await supabase.from("customers").select("id, name, tax_id, cep, logradouro, numero, complemento, bairro, municipio, codigo_municipio, uf, email_nfe").eq("organization_id", org).in("id", plano.completar.map((c) => c.id));
let consultados = 0, completados = 0;
for (const c of agora ?? []) {
  if (!c.tax_id || c.tax_id.length !== 14) continue;
  let d = null;
  try { d = await consultarCnpj(c.tax_id); } catch (e) { console.error(`${c.name}: ${e.message}`); continue; }
  consultados++;
  await new Promise((r) => setTimeout(r, 400));
  if (!d) { console.error(`${c.name}: CNPJ não encontrado na consulta pública.`); continue; }
  if (c.uf && d.uf && c.uf !== d.uf) { console.error(`${c.name}: UF do GRV (${c.uf}) diferente da consulta (${d.uf}); nada gravado pela consulta.`); continue; }
  const campos = {};
  const pega = (k, v, max = 60) => { if (v && !c[k]) campos[k] = String(v).slice(0, max); };
  pega("numero", d.numero); pega("complemento", d.complemento); pega("codigo_municipio", /^\d{7}$/.test(d.codigoMunicipio) ? d.codigoMunicipio : "");
  pega("email_nfe", /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) && d.email.length <= 60 ? d.email : "");
  pega("cep", /^\d{8}$/.test(d.cep) ? d.cep : ""); pega("logradouro", d.logradouro); pega("bairro", d.bairro); pega("municipio", d.municipio); pega("uf", /^[A-Z]{2}$/.test(d.uf) ? d.uf : "");
  if (!Object.keys(campos).length) continue;
  const e = await gravar(c.id, campos);
  if (e) { console.error(`${c.name}: ${e.message}`); continue; }
  completados++;
}
console.log(`Consulta pública: ${consultados} CNPJs consultados · ${completados} clientes completados.`);
