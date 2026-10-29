#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Correção pontual de períodos de férias (29/10/2026)
 *
 * A importação do histórico (25/09/2026, scripts/import-rh-historico.mjs) copiou
 * a planilha "HISTÓRICO FUNCIONÁRIOS ATUAIS" como estava, e 7 períodos apareceram
 * como "Vencido" em RH › Férias a vencer sem estarem (confirmado pelo proprietário):
 *
 *   matr. 280  o mesmo período escrito de duas formas (17/09 e 18/09/2024; a
 *              admissão é 18/09) → um período só, com 7 + 23 = 30 dias gozados;
 *   matr. 153  o 2º bloco de 15 dias (11/06/2026) estava no período 2025/26 →
 *              completa o 2024/25 (gozado antes do prazo de 28/06/2026);
 *   quitados sem registro no histórico (planilha incompleta): matr. 17 períodos
 *              2000/01 e 2001/02, matr. 8 período 2007/08, matr. 153 período 2023/24.
 *
 * Confere os valores atuais antes de mudar (diferente do esperado = nada é gravado),
 * faz tudo numa transação e registra na Auditoria. Os períodos corrigidos passam a
 * source = 'correcao-rh-29-10-2026' (a importação do histórico não os toca).
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/corrigir-rh-ferias-29-10.mjs [--url http://host:8000]
 *   node scripts/corrigir-rh-ferias-29-10.mjs --apply
 * Requer SUPABASE_SERVICE_ROLE_KEY. Usa /pg/query (SQL com a chave de serviço).
 * ============================================================================
 */

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
const base = ((urlIdx !== -1 && args[urlIdx + 1]) || env.SUPABASE_INTERNAL_URL || "").replace(/\/$/, "");
if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Defina a URL do Supabase (--url ou SUPABASE_INTERNAL_URL) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

async function sql(query) {
  const r = await fetch(`${base}/pg/query`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`/pg/query ${r.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

const FONTE = "correcao-rh-29-10-2026";
const MOTIVO = "Quitado sem registro no histórico (planilha incompleta); confirmado pelo proprietário em 29/10/2026";
const QUEM = "Proprietário (correção do histórico, 29/10/2026)";
/** Os períodos que mudam e o que se espera encontrar neles hoje (dias gozados). */
const ESPERADO = [
  { mat: "280", inicio: "2024-09-17", gozados: 7, acao: "duplicado: o gozo vai para o período de 18/09/2024 e este sai" },
  { mat: "280", inicio: "2024-09-18", gozados: 23, acao: "fica com 30 dias gozados" },
  { mat: "153", inicio: "2024-06-29", gozados: 15, acao: "recebe o bloco de 11/06/2026 e fica com 30" },
  { mat: "153", inicio: "2025-06-29", gozados: 15, acao: "fica com 0 gozados (saldo 30, prazo 28/06/2027)" },
  { mat: "153", inicio: "2023-06-29", gozados: 24, acao: "quitado (6 dias sem registro)" },
  { mat: "17", inicio: "2000-03-01", gozados: 18, acao: "quitado (12 dias sem registro)" },
  { mat: "17", inicio: "2001-03-01", gozados: 0, acao: "quitado (30 dias sem registro)" },
  { mat: "8", inicio: "2007-04-02", gozados: 20, acao: "quitado (10 dias sem registro)" },
];

const atual = await sql(`select e.employee_number mat, e.full_name nome, b.id, b.acquisition_start::text inicio, b.taken_days gozados, b.pecuniary_days abono,
  b.entitled_days - b.taken_days - b.scheduled_days - b.pecuniary_days saldo, b.expires_at::text prazo, b.quitado_em, b.source
  from public.rh_vacation_balances b join public.employees e on e.id = b.employee_id
  where (e.employee_number, b.acquisition_start::text) in (${ESPERADO.map((x) => `('${x.mat}', '${x.inicio}')`).join(", ")})`);
const ausencias = await sql(`select e.employee_number mat, a.start_date::text inicio, a.days, b.acquisition_start::text periodo
  from public.rh_absences a join public.employees e on e.id = a.employee_id left join public.rh_vacation_balances b on b.id = a.vacation_balance_id
  where a.absence_type = 'vacation' and ((e.employee_number = '280' and b.acquisition_start = '2024-09-17') or (e.employee_number = '153' and a.start_date = '2026-06-11'))`);

let ok = true;
console.log(`${apply ? "GRAVANDO" : "SIMULAÇÃO (use --apply para gravar)"}\n`);
for (const x of ESPERADO) {
  const r = atual.find((a) => String(a.mat) === x.mat && a.inicio === x.inicio);
  const confere = r && Number(r.gozados) === x.gozados && !r.quitado_em;
  if (!confere) ok = false;
  console.log(`${confere ? "✔" : "✖"} matr. ${x.mat.padStart(3)} ${r?.nome ?? "?"} · período ${x.inicio.split("-").reverse().join("/")} · gozados ${r?.gozados ?? "?"} (esperado ${x.gozados}) · saldo ${r?.saldo ?? "?"} · prazo ${r?.prazo ?? "?"}\n     → ${x.acao}`);
}
console.log(`\nAusências que trocam de período (${ausencias.length}, esperado 2):`);
for (const a of ausencias) console.log(`   matr. ${a.mat} · gozo de ${a.inicio} (${a.days} dias), hoje no período ${a.periodo}`);
if (ausencias.length !== 2) ok = false;
if (!ok) { console.error("\nO banco não está como o esperado. Nada foi gravado."); process.exit(1); }
if (!apply) process.exit(0);

const id = (mat, inicio) => atual.find((a) => String(a.mat) === mat && a.inicio === inicio).id;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
await sql(`begin;
-- Matr. 280: um período só (18/09/2024), com o gozo de 7 dias que estava no duplicado.
update public.rh_absences set vacation_balance_id = ${q(id("280", "2024-09-18"))} where vacation_balance_id = ${q(id("280", "2024-09-17"))};
update public.rh_vacation_balances set taken_days = 30, source = ${q(FONTE)} where id = ${q(id("280", "2024-09-18"))} and taken_days = 23;
delete from public.rh_vacation_balances where id = ${q(id("280", "2024-09-17"))} and taken_days = 7;
-- Matr. 153: o bloco de 11/06/2026 completa o período 2024/25.
update public.rh_absences set vacation_balance_id = ${q(id("153", "2024-06-29"))}
  where vacation_balance_id = ${q(id("153", "2025-06-29"))} and start_date = '2026-06-11' and absence_type = 'vacation';
update public.rh_vacation_balances set taken_days = 30, source = ${q(FONTE)} where id = ${q(id("153", "2024-06-29"))} and taken_days = 15;
update public.rh_vacation_balances set taken_days = 0, source = ${q(FONTE)} where id = ${q(id("153", "2025-06-29"))} and taken_days = 15;
-- Quitados sem registro no histórico.
update public.rh_vacation_balances set quitado_em = now(), quitado_motivo = ${q(MOTIVO)}, quitado_por_nome = ${q(QUEM)}, source = ${q(FONTE)}
  where id in (${["153:2023-06-29", "17:2000-03-01", "17:2001-03-01", "8:2007-04-02"].map((k) => q(id(...k.split(":")))).join(", ")}) and quitado_em is null;
insert into public.audit_logs (organization_id, module_code, event_type, entity_type, risk_level, metadata)
select organization_id, 'rh', 'rh.ferias.correcao_historico', 'rh_vacation_balances', 'medium',
  jsonb_build_object('fonte', ${q(FONTE)}, 'motivo', 'Planilha do histórico com período duplicado, gozo no período errado e períodos sem registro; confirmado pelo proprietário',
    'periodos', ${q(JSON.stringify(ESPERADO.map((x) => ({ matricula: x.mat, inicio: x.inicio, acao: x.acao }))))}::jsonb)
from public.employees where employee_number = '280' limit 1;
commit;`);

const depois = await sql(`select count(*) filter (where b.entitled_days - b.taken_days - b.scheduled_days - b.pecuniary_days > 0 and b.expires_at < current_date and b.quitado_em is null) vencidos,
  count(*) filter (where b.quitado_em is not null) quitados, count(*) filter (where b.source = ${q(FONTE)}) corrigidos, count(*) total from public.rh_vacation_balances b`);
console.log(`\nGravado. Agora: ${depois[0].vencidos} períodos vencidos com saldo · ${depois[0].quitados} quitados · ${depois[0].corrigidos} corrigidos · ${depois[0].total} períodos no total.`);
