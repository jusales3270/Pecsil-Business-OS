#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga do cadastro de materiais do GRV (Almoxarifado › Materiais)
 *
 * docs/PLANO-ALMOXARIFADO.md, M1. Lê as quatro exportações do cadastro de itens do GRV
 * (MATERIA PRIMA, EMBALAGEM, PRODUTO INTERMEDIÁRIO, MATERIAL DE USO E CONSUMO .xlsx) e grava:
 *   - material_groups: um por prefixo-grupo do código (2-07, 8-10…), com o próximo número;
 *   - materials: um por código, com unidade padronizada, NCM, plano de contas, custo e o saldo
 *     do GRV só como referência (o estoque abre com contagem, M4).
 *
 * Decisões (15/10/2026):
 *   A1 — importa tudo; entra inativo quem não tem saldo, custo nem compra na plataforma;
 *   A2 — controla estoque: matéria-prima, embalagem, produto intermediário, EPI e Produção;
 *   A7 — ativo imobilizado entra inativo e sem estoque.
 *
 * Roda UMA vez com --apply. Rodar de novo só acrescenta código que ainda não existe (nunca
 * sobrescreve o que foi editado na plataforma).
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-almoxarifado-materiais.mjs [--dir ~/Downloads] [--url http://<supabase>]
 *        [--arquivos "ATIVO IMOBILIZADO.xlsx"] [--relatorio <arquivo.csv>] [--apply]
 *
 * --arquivos troca a lista de planilhas (ex.: a do ativo imobilizado, que ficou fora da carga de
 * 15/10; pela decisão A7 entra inativa e sem estoque). Só acrescenta o que ainda não existe.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { lerXlsx } from "../lib/arquivos/xlsx.ts";
import { FAMILIAS, PENDENCIAS, gruposDaCarga, prepararMaterial } from "../lib/almoxarifado/materiais-carga.ts";

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
const dir = (arg("--dir") ?? "~/Downloads").replace(/^~/, homedir());
const relatorio = (arg("--relatorio") ?? "~/Desktop/PecSil - Materiais do GRV (pendências).csv").replace(/^~/, homedir());
const ARQUIVOS = arg("--arquivos")?.split(",").map((s) => s.trim()).filter(Boolean)
  ?? ["MATERIA PRIMA.xlsx", "EMBALAGEM.xlsx", "PRODUTO INTERMEDIÁRIO.xlsx", "MATERIAL DE USO E CONSUMO.xlsx"];
const HOJE = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

// Decisão A2 (por empresa; aqui, a da PecSil).
const REGRAS = {
  familiasComEstoque: new Set(["materia_prima", "embalagem", "produto_intermediario"]),
  gruposComEstoque: new Set(["EPI", "PRODUÇÃO"]),
};

// --- Planilhas -----------------------------------------------------------------------------------
const linhas = [];
for (const nome of ARQUIVOS) {
  const caminho = join(dir, nome);
  if (!existsSync(caminho)) { console.error(`Planilha não encontrada: ${caminho}`); process.exit(1); }
  const [cabeca, ...resto] = lerXlsx(readFileSync(caminho));
  const colunas = (cabeca ?? []).map((c) => String(c ?? "").trim());
  if (!colunas.includes("Código Interno") || !colunas.includes("*Item")) { console.error(`${nome}: não é a exportação do cadastro de itens do GRV.`); process.exit(1); }
  let n = 0;
  for (const r of resto) {
    if (!r.some((c) => c !== null && String(c).trim() !== "")) continue;
    linhas.push({ arquivo: nome, dados: Object.fromEntries(colunas.map((c, i) => [c, r[i] ?? null])) });
    n++;
  }
  console.log(`${nome}: ${n} itens`);
}

// --- Banco: o que já foi comprado/cotado (nunca entra inativo) e o que já existe ----------------------
const supabaseUrl = arg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL;
if (!env.SUPABASE_SERVICE_ROLE_KEY || !supabaseUrl?.startsWith("http")) { console.error("\nSem SUPABASE_SERVICE_ROLE_KEY ou --url."); process.exit(1); }
const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: orgs, error: erroOrg } = await supabase.from("organizations").select("id");
if (erroOrg || orgs?.length !== 1) { console.error("A carga precisa de exatamente uma empresa no banco (use outro script para multiempresa)."); process.exit(1); }
const org = orgs[0].id;

// porEmpresa=false: tabela sem organization_id (itens da cotação herdam pela cotação; a carga exige uma empresa só).
const todas = async (tabela, colunas, porEmpresa = true) => {
  const out = [];
  for (let de = 0; ; de += 1000) {
    let consulta = supabase.from(tabela).select(colunas).order("id").range(de, de + 999);
    if (porEmpresa) consulta = consulta.eq("organization_id", org);
    const { data, error } = await consulta;
    if (error) { console.error(`Falha ao ler ${tabela}:`, error.message); process.exit(1); }
    out.push(...data);
    if (data.length < 1000) return out;
  }
};
const normal = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^0-9A-Z]+/g, " ").trim();
const textos = [...(await todas("cotacao_produtos", "id, produto", false)).map((r) => r.produto), ...(await todas("compras", "id, produto")).map((r) => r.produto)];
const codigosNoTexto = new Set(textos.flatMap((t) => [...String(t ?? "").matchAll(/\b(\d{1,2}-\d{2}-\d{5})\b/g)].map((m) => m[1])));
const nomesComprados = new Set(textos.map(normal));
const comprados = new Set(linhas.map((l) => String(l.dados["Código Interno"] ?? "").trim().toUpperCase())
  .filter((c, i) => codigosNoTexto.has(c) || nomesComprados.has(normal(linhas[i].dados["*Item"]))));

const materiais = [];
const recusados = [];
for (const l of linhas) {
  const m = prepararMaterial(l.dados, { ...REGRAS, comprados });
  if (m) materiais.push({ ...m, arquivo: l.arquivo }); else recusados.push(l.dados["Código Interno"]);
}
const repetidos = materiais.filter((m, i) => materiais.findIndex((x) => x.codigo === m.codigo) !== i).map((m) => m.codigo);
if (repetidos.length) { console.error(`Códigos repetidos entre as planilhas: ${repetidos.slice(0, 10).join(", ")}`); process.exit(1); }
const grupos = gruposDaCarga(materiais, REGRAS);

// --- Resumo --------------------------------------------------------------------------------------
const conta = (lista, f) => lista.reduce((a, x) => a + (f(x) ? 1 : 0), 0);
console.log(`\nMateriais: ${materiais.length}${recusados.length ? ` · ${recusados.length} linha(s) com código ou nome inválido ficam de fora: ${recusados.slice(0, 5).join(", ")}` : ""}`);
console.log("Família · itens · ativos · inativos · controla estoque");
for (const [f, rotulo] of Object.entries(FAMILIAS)) {
  const l = materiais.filter((m) => m.familia === f);
  if (l.length) console.log(`  ${rotulo.padEnd(28)} ${String(l.length).padStart(5)} ${String(conta(l, (m) => m.ativo)).padStart(6)} ${String(conta(l, (m) => !m.ativo)).padStart(6)} ${String(conta(l, (m) => m.controla_estoque)).padStart(6)}`);
}
console.log(`Já comprados/cotados na plataforma (ficam ativos): ${conta(materiais, (m) => comprados.has(m.codigo))}`);
console.log(`Grupos: ${grupos.length} (${conta(grupos, (g) => g.controla_estoque)} controlam estoque)`);
for (const g of grupos) console.log(`  ${g.prefixo}-${g.codigo}  ${g.nome.padEnd(24)} ${FAMILIAS[g.familia]?.padEnd(26) ?? ""} próximo ${String(g.proximo).padStart(5, "0")}${g.controla_estoque ? " · estoque" : ""}`);
console.log("Pendências:");
for (const [p, rotulo] of Object.entries(PENDENCIAS)) console.log(`  ${rotulo.padEnd(34)} ${conta(materiais, (m) => m.pendencias.includes(p))}`);

// Relatório para o Jefferson/contador: só os itens com pendência fiscal.
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const fiscais = materiais.filter((m) => m.pendencias.some((p) => p !== "unidade_ajustada"));
writeFileSync(relatorio, "﻿" + [
  ["Código", "Item", "Família", "Grupo", "Unidade", "NCM", "Plano de contas", "Tipo do item", "Custo", "Ativo", "Pendências"].map(csv).join(";"),
  ...fiscais.map((m) => [m.codigo, m.descricao, FAMILIAS[m.familia], m.grupo_nome, m.unidade, m.ncm, m.plano_contas, m.tipo_item, String(m.custo_referencia).replace(".", ","), m.ativo ? "sim" : "não",
    m.pendencias.filter((p) => p !== "unidade_ajustada").map((p) => PENDENCIAS[p]).join(", ")].map(csv).join(";")),
].join("\n"));
console.log(`\nRelatório de pendências (${fiscais.length} itens): ${relatorio}`);

// --- Gravação ------------------------------------------------------------------------------------
// Antes da migração (simulação) a tabela ainda não existe: conta como vazia.
const { error: semTabela } = await supabase.from("materials").select("id").limit(1);
if (semTabela && apply) { console.error("A tabela materials não existe: aplique a migração 202610160001 antes do --apply."); process.exit(1); }
const jaExistem = new Set(semTabela ? [] : (await todas("materials", "id, codigo")).map((r) => r.codigo));
if (semTabela) console.log("\n(Tabela materials ainda não existe: a migração 202610160001 não foi aplicada.)");
const novos = materiais.filter((m) => !jaExistem.has(m.codigo));
console.log(`\nBanco: ${jaExistem.size} material(is) já cadastrado(s) · a gravar: ${novos.length}`);
if (!apply) { console.log("\nSIMULAÇÃO: nada foi gravado. Para gravar, rode de novo com --apply."); process.exit(0); }

const { error: erroGrupos } = await supabase.from("material_groups").upsert(
  grupos.map((g) => ({ organization_id: org, prefixo: g.prefixo, codigo: g.codigo, nome: g.nome, familia: g.familia, proximo: g.proximo, controla_estoque: g.controla_estoque })),
  { onConflict: "organization_id,prefixo,codigo", ignoreDuplicates: true },
);
if (erroGrupos) { console.error("Falha nos grupos:", erroGrupos.message); process.exit(1); }
const idDoGrupo = new Map((await todas("material_groups", "id, prefixo, codigo")).map((g) => [`${g.prefixo}-${g.codigo}`, g.id]));
// Grupo que já existia: o próximo só sobe (nunca volta para trás).
for (const g of grupos) {
  const { error } = await supabase.from("material_groups").update({ proximo: g.proximo }).eq("organization_id", org).eq("prefixo", g.prefixo).eq("codigo", g.codigo).lt("proximo", g.proximo);
  if (error) { console.error(`Falha no próximo do grupo ${g.prefixo}-${g.codigo}:`, error.message); process.exit(1); }
}

const linhasBanco = novos.map((m) => ({
  organization_id: org, codigo: m.codigo, descricao: m.descricao, group_id: m.grupo ? idDoGrupo.get(`${m.grupo.prefixo}-${m.grupo.codigo}`) ?? null : null,
  familia: m.familia, grupo_nome: m.grupo_nome, subgrupo: m.subgrupo, unidade: m.unidade, unidade_compra: m.unidade_compra, ncm: m.ncm,
  plano_contas: m.plano_contas, tipo_item: m.tipo_item, custo_referencia: m.custo_referencia, saldo_grv: m.saldo_grv,
  controla_estoque: m.controla_estoque, ativo: m.ativo, origem: "grv", pendencias: m.pendencias, created_by_name: arg("--arquivos") ? `GRV (carga de ${HOJE})` : "GRV (carga de 15/10/2026)",
}));
for (let i = 0; i < linhasBanco.length; i += 500) {
  const { error } = await supabase.from("materials").upsert(linhasBanco.slice(i, i + 500), { onConflict: "organization_id,codigo", ignoreDuplicates: true });
  if (error) { console.error(`Falha no lote ${i / 500 + 1} (os anteriores ficaram; rode de novo para continuar):`, error.message); process.exit(1); }
}
console.log(`\nGRAVADO: ${grupos.length} grupos e ${linhasBanco.length} materiais.`);
