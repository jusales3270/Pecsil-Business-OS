#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga das jornadas de trabalho (horários do Secullum)
 *
 * Fonte: relatório "Distribuição de Horários" do Secullum RH (Soroponto),
 * emitido em 28/10/2026 16:36 — 13 horários e 63 colaboradores. Grava:
 *   rh_jornadas         — um registro por horário (número do Secullum + texto)
 *   employees.jornada_id — a jornada de cada colaborador, casado pela matrícula
 *                          (o "Nº folha" do Secullum é a matrícula do cadastro)
 *
 * Os textos dos horários seguem o Secullum, só com o espaçamento padronizado
 * ("14: 00" → "14:00", "7:00" → "07:00", "SAB 07:00-11:00" → "SAB 07:00 - 11:00").
 * Reexecutável: o horário é casado pelo número (atualiza o texto) e a jornada
 * do colaborador é sobrescrita. Matrícula que não existir no cadastro é
 * listada e não grava nada dela.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-rh-jornadas-secullum.mjs
 *   node scripts/import-rh-jornadas-secullum.mjs --apply
 * Opções: --url <supabase>. Requer SUPABASE_SERVICE_ROLE_KEY.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i === -1) continue;
    const key = t.slice(0, i).trim();
    if (process.env[key] === undefined) env[key] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const urlIdx = args.indexOf("--url");
const url = (urlIdx !== -1 && args[urlIdx + 1]) || env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Defina a URL do Supabase (--url ou SUPABASE_INTERNAL_URL) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

/** Número do horário no Secullum → [horário, matrículas]. */
const JORNADAS = {
  3: ["07:00 - 11:30 - 12:30 - 17:00", [70, 142]],
  4: ["07:30 - 12:30 - 13:30 - 17:30", [274, 17, 183, 15]],
  7: ["07:00 - 12:00 - 13:00 - 16:00 (SAB 07:00 - 11:00)", [57, 20, 330, 296, 153, 133, 173]],
  9: ["07:00 - 11:30 - 12:30 - 16:00 (SAB 07:00 - 11:00)", [5, 172, 149, 334]],
  11: ["07:00 - 12:30 - 13:30 - 16:00 (SAB 07:00 - 11:00)", [143, 295, 167, 31]],
  13: ["14:00 - 19:00 - 20:00 - 22:17 (SAB 11:00 - 19:20)", [240]],
  15: ["18:00 - 21:00 - 22:00 - 03:04", [24]],
  17: ["07:00 - 12:00 - 13:00 - 16:00 (Semana Espanhola)", [325, 290]],
  22: ["16:00 - 19:00 - 20:00 - 00:38 (Semana Espanhola)", [335]],
  23: ["15:45 - 19:00 - 20:00 - 00:24 (SAB 16:00 - 20:00)", [256]],
  25: ["07:00 - 12:00 - 13:00 - 17:00", [124, 219, 204, 80, 215, 3, 220, 48, 210, 21, 284, 333, 176, 277, 287, 305, 304, 140, 280, 322, 132, 321, 79, 8, 11, 137]],
  27: ["07:00 - 12:30 - 13:30 - 17:00", [166, 12, 120, 49, 226, 320, 327, 2, 307]],
  32: ["SEG. A SEX. 08:00 - 17:00 (SAB 08:00 - 12:00)", [46]],
};
const TOTAL_ESPERADO = 63;

const sb = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: emps, error } = await sb.from("employees").select("id, organization_id, employee_number, full_name, active").limit(5000);
if (error) throw error;
const orgs = [...new Set(emps.map((e) => e.organization_id))];
if (orgs.length !== 1) { console.error(`Esperava uma empresa no cadastro, achei ${orgs.length}. Nada foi feito.`); process.exit(1); }
const org = orgs[0];
const porMatricula = new Map();
for (const e of emps) {
  const k = /^\d+$/.test(String(e.employee_number)) ? String(Number(e.employee_number)) : String(e.employee_number);
  porMatricula.set(k, [...(porMatricula.get(k) ?? []), e]);
}

let total = 0;
const problemas = [];
const plano = [];
for (const [numero, [nome, matriculas]] of Object.entries(JORNADAS)) {
  for (const m of matriculas) {
    total++;
    const achados = porMatricula.get(String(m)) ?? [];
    if (achados.length !== 1) { problemas.push(`matrícula ${m}: ${achados.length ? "mais de um cadastro" : "não existe no cadastro"}`); continue; }
    const e = achados[0];
    if (!e.active) problemas.push(`matrícula ${m} (${e.full_name}): está desligado no cadastro (a jornada é gravada mesmo assim)`);
    plano.push({ numero: Number(numero), nome, employee: e });
  }
}
if (total !== TOTAL_ESPERADO) problemas.push(`o relatório tem ${TOTAL_ESPERADO} colaboradores e a lista daqui tem ${total}`);

console.log(`${apply ? "GRAVANDO" : "SIMULAÇÃO (use --apply para gravar)"} · ${Object.keys(JORNADAS).length} jornadas · ${plano.length} colaboradores`);
for (const [numero, [nome]] of Object.entries(JORNADAS)) {
  const doHorario = plano.filter((x) => x.numero === Number(numero));
  console.log(`\nNº ${numero} · ${nome} (${doHorario.length})`);
  for (const x of doHorario) console.log(`   ${String(x.employee.employee_number).padStart(4)}  ${x.employee.full_name}`);
}
const fora = emps.filter((e) => !plano.some((x) => x.employee.id === e.id));
if (fora.length) console.log(`\nNo cadastro e fora do relatório (jornada não muda): ${fora.map((e) => `${e.employee_number} ${e.full_name}${e.active ? "" : " (desligado)"}`).join(" · ")}`);
if (problemas.length) console.log(`\nAtenção:\n - ${problemas.join("\n - ")}`);
if (!apply) process.exit(0);
if (problemas.some((p) => !p.includes("desligado"))) { console.error("\nHá matrículas sem cadastro único. Nada foi gravado."); process.exit(1); }

const { data: jornadas, error: eJ } = await sb.from("rh_jornadas")
  .upsert(Object.entries(JORNADAS).map(([numero, [nome]]) => ({ organization_id: org, numero: Number(numero), nome, ativo: true })), { onConflict: "organization_id,numero" })
  .select("id, numero");
if (eJ) throw eJ;
const idDo = new Map(jornadas.map((j) => [j.numero, j.id]));
let gravados = 0;
for (const x of plano) {
  const { error: eE } = await sb.from("employees").update({ jornada_id: idDo.get(x.numero) }).eq("id", x.employee.id);
  if (eE) throw eE;
  gravados++;
}
console.log(`\nGravado: ${jornadas.length} jornadas, ${gravados} colaboradores com a jornada.`);
