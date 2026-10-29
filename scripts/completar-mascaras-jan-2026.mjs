#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Máscaras de impostos completadas pelas notas de jan/2026 (29/10/2026, F2 do
 * docs/PLANO-EMISSAO-NFE.md)
 *
 * As máscaras de conserto e retorno de conserto (5915, 5916, 6916) vieram do GRV só com o CFOP e o CST do ICMS.
 * Os itens das notas de janeiro dessas operações (6 notas, 14 itens) mostram, iguais em todos, o CST do IPI (53), o do PIS e da COFINS (49)
 * e o texto legal da não incidência do ICMS. Só os campos VAZIOS são preenchidos (nada do que existe muda), a
 * origem passa a "nota" e a máscara continua sem confirmação: quem confirma é o Jefferson, em Fiscal › Máscaras.
 *
 * Fica de fora o que as notas não mostram igual: as alíquotas de PIS/COFINS da 5915 (uma nota com 0,65%/3%,
 * outra com 0%) e a 1101 (as de janeiro são a entrada de sucata do art. 392, caso especial).
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/completar-mascaras-jan-2026.mjs [--apply]
 * Requer SUPABASE_SERVICE_ROLE_KEY e SUPABASE_INTERNAL_URL.
 * ============================================================================
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim(); const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i === -1) continue;
    const key = t.slice(0, i).trim();
    if (process.env[key] === undefined) env[key] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const apply = process.argv.includes("--apply");
const url = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Defina SUPABASE_INTERNAL_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
const sb = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NAO_INCIDENCIA = "ICMS - NAO INCIDENCIA DE ICMS NOS TERMOS DO ART. 7. INCISO X, DECRETO 45490/00 RICMS.";
const NOTA_INTERNA = "Campos vazios completados pelas notas emitidas de jan/2026 (29/10/2026): conferir e confirmar.";
/** Código da máscara (= CFOP) → o que as notas de janeiro mostram (em quantas notas e itens). */
const PELAS_NOTAS = {
  5915: { notas: "1 nota, 2 itens", campos: { ipi_cst: "53", pis_cst: "49", cofins_cst: "49", obs_nota: `${NAO_INCIDENCIA} MERCADORIA NOSSA PROPRIEDADE QUE ORA SEGUE PARA CONSERTO DEVENDO RETORNAR POSTERIORMENTE AO NOSSO ESTABELECIMENTO.` } },
  5916: { notas: "1 nota, 2 itens", campos: { ipi_cst: "53", pis_cst: "49", pis_aliquota: 0, cofins_cst: "49", cofins_aliquota: 0, obs_nota: `${NAO_INCIDENCIA} RETORNO DE MERCADORIA DE PROPRIEDADE DO DESTINATARIO RECEBIDA PARA REPARO.` } },
  6916: { notas: "4 notas, 10 itens", campos: { ipi_cst: "53", pis_cst: "49", pis_aliquota: 0, cofins_cst: "49", cofins_aliquota: 0, obs_nota: `${NAO_INCIDENCIA} RETORNO DE MERCADORIA DE PROPRIEDADE DO DESTINATARIO RECEBIDA PARA REPARO.` } },
};

const { data: mascaras, error } = await sb.from("fiscal_mascaras").select("*").in("codigo", Object.keys(PELAS_NOTAS));
if (error) throw error;
console.log(`${apply ? "GRAVANDO" : "SIMULAÇÃO (use --apply para gravar)"}\n`);
const planos = [];
for (const [codigo, { notas, campos }] of Object.entries(PELAS_NOTAS)) {
  const m = mascaras.find((x) => x.codigo === codigo);
  if (!m) { console.log(`✖ máscara ${codigo}: não existe. Nada muda nela.`); continue; }
  if (m.confirmada_em) { console.log(`= máscara ${codigo}: já confirmada por ${m.confirmada_por_nome}. Nada muda.`); continue; }
  const novos = Object.fromEntries(Object.entries(campos).filter(([k]) => m[k] === null || m[k] === undefined || m[k] === ""));
  if (!Object.keys(novos).length) { console.log(`= máscara ${codigo}: nada vazio para completar.`); continue; }
  console.log(`✔ máscara ${codigo} (${m.descricao}), pelas notas de janeiro (${notas}):`);
  for (const [k, v] of Object.entries(novos)) console.log(`     ${k}: ${JSON.stringify(v)}`);
  planos.push({ id: m.id, codigo, novos, interna: m.observacao_interna });
}
if (!apply || !planos.length) process.exit(0);
for (const p of planos) {
  const { error: e } = await sb.from("fiscal_mascaras").update({
    ...p.novos, origem_dados: "nota", observacao_interna: [p.interna, NOTA_INTERNA].filter(Boolean).join(" ").slice(0, 1000),
    updated_by_name: "Carga das notas de jan/2026", updated_at: new Date().toISOString(),
  }).eq("id", p.id).is("confirmada_em", null);
  if (e) throw e;
  console.log(`Gravado: máscara ${p.codigo}.`);
}
