#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Importação do histórico de férias e afastamentos
 *
 * Lê o Markdown gerado da planilha "HISTÓRICO FUNCIONÁRIOS ATUAIS" (uma seção
 * `## NOME` por colaborador) e grava:
 *   rh_vacation_balances  — um por período aquisitivo (com abono pecuniário)
 *   rh_absences           — cada gozo de férias e cada afastamento
 *   rh_absence_clinical   — diagnóstico, CID e observação de saúde (restrito)
 *
 * A seção de salário é ignorada. A leitura e as regras estão em
 * lib/rh/historico-parser.ts (testado em tests/rh-historico-parser.test.mjs).
 *
 * O arquivo contém dado de saúde (LGPD art. 11) — NÃO o coloque no repositório
 * e não envie nada dele a serviço externo. O relatório nunca mostra CID nem
 * diagnóstico.
 *
 * Reexecutável: cada linha tem uma chave estável (`source_key`); rodar de novo
 * atualiza, não duplica. Registro importado antes e que sumiu do arquivo (linha
 * corrigida) é removido, sempre só entre os que vieram desta importação.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-rh-historico.mjs --file ~/Downloads/historico_funcionarios.md
 *   node scripts/import-rh-historico.mjs --file … --alias "NOME NA PLANILHA=NOME NO CADASTRO" --apply
 *
 * Opções: --url <supabase> · --report <arquivo> (padrão: ao lado do --file)
 *         --hoje AAAA-MM-DD (data de corte entre gozado e programado)
 * Requer SUPABASE_SERVICE_ROLE_KEY.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizarNome, parseHistorico } from "../lib/rh/historico-parser.ts";

const envPath = resolve(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (process.env[key] === undefined) {
      env[key] = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

const args = process.argv.slice(2);
const getArg = flag => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};
const getAll = flag => args.flatMap((arg, idx) => (arg === flag && args[idx + 1] ? [args[idx + 1]] : []));
const apply = args.includes("--apply");
const filePath = getArg("--file");
const url = getArg("--url") || env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const hoje = getArg("--hoje") || new Date().toISOString().slice(0, 10);
const SOURCE = "importacao-historico";

if (!filePath || !existsSync(filePath)) {
  console.error("❌ Informe o arquivo do histórico: --file <caminho>");
  process.exit(1);
}
if (!url || !serviceKey) {
  console.error("❌ Informe a URL do Supabase (--url) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const reportPath = getArg("--report") || resolve(dirname(filePath), "relatorio-importacao-historico.txt");
if (resolve(reportPath).startsWith(resolve(process.cwd()))) {
  console.error("❌ O relatório não pode ficar dentro do repositório.");
  process.exit(1);
}

/** "NOME NA PLANILHA=NOME NO CADASTRO", para grafias diferentes da mesma pessoa. */
const aliases = new Map(
  getAll("--alias").map(pair => {
    const [planilha, cadastro] = pair.split("=");
    return [normalizarNome(planilha ?? ""), normalizarNome(cadastro ?? "")];
  }),
);

const TIPO = {
  vacation: "Férias",
  medical_certificate: "Atestado médico",
  attendance_statement: "Consulta ou exame",
  family_care: "Acompanhamento de familiar",
  occupational_exam: "Exame ocupacional",
  legal_leave: "Ausência legal",
  justified_absence: "Ausência justificada",
  inss_leave: "Afastamento INSS",
  work_accident: "Acidente de trabalho",
  maternity_leave: "Licença-maternidade",
};

const hash = text => createHash("sha256").update(text).digest("hex").slice(0, 20);
const chunks = (list, size = 400) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function must(promise, context) {
  const { data, error } = await promise;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}

/** Lê tudo, paginando (o PostgREST corta em 1000 linhas). */
async function todas(build, context) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await must(build().range(from, from + 999), context);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function run() {
  const parsed = parseHistorico(readFileSync(filePath, "utf8"));

  const orgs = await must(db.from("organizations").select("id, display_name"), "organizações");
  if (orgs.length !== 1) throw new Error(`Esperada 1 organização, encontradas ${orgs.length}.`);
  const org = orgs[0];

  const cadastro = await must(
    db.from("employees").select("id, full_name, unit_id, department_id").eq("organization_id", org.id),
    "colaboradores",
  );
  const porNome = new Map();
  for (const employee of cadastro) {
    const key = normalizarNome(employee.full_name);
    porNome.set(key, [...(porNome.get(key) ?? []), employee]);
  }

  // --- Casamento de nomes ----------------------------------------------------
  const semPar = [];
  const casados = [];
  for (const history of parsed.employees) {
    const key = aliases.get(normalizarNome(history.name)) ?? normalizarNome(history.name);
    const matches = porNome.get(key) ?? [];
    if (matches.length === 1) casados.push({ history, employee: matches[0] });
    else semPar.push({ history, motivo: matches.length ? "mais de um colaborador com esse nome" : "não encontrado no cadastro" });
  }
  const parecidos = nome => {
    const partes = normalizarNome(nome).split(" ");
    return cadastro
      .map(e => ({ nome: e.full_name, comum: normalizarNome(e.full_name).split(" ").filter(p => p.length > 2 && partes.includes(p)).length }))
      .filter(c => c.comum >= 2)
      .sort((a, b) => b.comum - a.comum)
      .slice(0, 2)
      .map(c => c.nome);
  };

  // --- Linhas a gravar -------------------------------------------------------
  const balances = [];
  const absences = [];
  const clinical = [];
  for (const { history, employee } of casados) {
    for (const vacation of history.vacations) {
      const gozados = vacation.gozos.filter(g => g.start <= hoje).reduce((s, g) => s + g.days, 0);
      const programados = vacation.gozos.filter(g => g.start > hoje).reduce((s, g) => s + g.days, 0);
      balances.push({
        organization_id: org.id,
        employee_id: employee.id,
        acquisition_start: vacation.acquisitionStart,
        acquisition_end: vacation.acquisitionEnd,
        entitled_days: vacation.entitledDays,
        taken_days: gozados,
        scheduled_days: programados,
        pecuniary_days: vacation.pecuniaryDays,
        expires_at: vacation.expiresAt,
        source: SOURCE,
      });
      for (const gozo of vacation.gozos) {
        absences.push({
          row: {
            organization_id: org.id,
            employee_id: employee.id,
            unit_id: employee.unit_id,
            department_id: employee.department_id,
            absence_type: "vacation",
            start_date: gozo.start,
            end_date: gozo.end,
            days: gozo.days,
            status: "registered",
            reason: vacation.gozos.length > 1 ? "Férias (fracionadas)" : "Férias",
            requested_at: `${gozo.start}T12:00:00Z`,
            source: SOURCE,
            source_key: `hist:ferias:${employee.id}:${gozo.start}:${gozo.end}`,
          },
          balanceKey: `${employee.id}:${vacation.acquisitionStart}`,
        });
      }
    }
    for (const absence of history.absences) {
      const sourceKey = `hist:aus:${employee.id}:${hash(absence.fingerprint)}`;
      absences.push({
        row: {
          organization_id: org.id,
          employee_id: employee.id,
          unit_id: employee.unit_id,
          department_id: employee.department_id,
          absence_type: absence.type,
          start_date: absence.start,
          end_date: absence.end,
          days: absence.days,
          hours: absence.hours,
          day_part: absence.dayPart,
          status: "registered",
          reason: absence.reason,
          requested_at: `${absence.start}T12:00:00Z`,
          source: SOURCE,
          source_key: sourceKey,
        },
      });
      if (absence.clinical) clinical.push({ sourceKey, ...absence.clinical });
    }
  }

  // --- Relatório (sem CID nem diagnóstico) -----------------------------------
  const bloqueios = parsed.problems.filter(p => p.blocking);
  const avisos = parsed.problems.filter(p => p.warning);
  const fora = parsed.problems.filter(p => !p.warning);
  const porTipo = absences.reduce((acc, { row }) => ({ ...acc, [row.absence_type]: (acc[row.absence_type] ?? 0) + 1 }), {});
  const vencidos = balances.filter(b => b.expires_at < hoje && b.taken_days + b.scheduled_days + b.pecuniary_days < b.entitled_days);
  const linhas = [
    `IMPORTAÇÃO DO HISTÓRICO DE FÉRIAS E AFASTAMENTOS ${apply ? "" : "(SIMULAÇÃO)"}`,
    `Arquivo: ${filePath}`,
    `Data de corte (gozado × programado): ${hoje}`,
    "",
    `Colaboradores na planilha: ${parsed.employees.length} · casados com o cadastro: ${casados.length} · sem par: ${semPar.length}`,
    `Períodos aquisitivos: ${balances.length} · com abono: ${balances.filter(b => b.pecuniary_days).length}`,
    `Ausências: ${absences.length}`,
    ...Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([tipo, n]) => `  ${TIPO[tipo] ?? tipo}: ${n}`),
    `Registros com dado clínico (tabela restrita): ${clinical.length}`,
    `Linhas repetidas descartadas: ${parsed.employees.reduce((s, e) => s + e.duplicates, 0)}`,
    `Períodos com saldo e concessivo vencido: ${vencidos.length}`,
    "",
    `COLABORADORES SEM PAR (${semPar.length}) — nada deles é gravado; use --alias se for a mesma pessoa`,
    ...semPar.map(({ history, motivo }) => {
      const sugestao = parecidos(history.name);
      return `  linha ${history.line} · ${history.name} · ${motivo}${sugestao.length ? ` · parecido(s): ${sugestao.join(" | ")}` : ""}`;
    }),
    "",
    `LINHAS FORA DA IMPORTAÇÃO (${fora.length})${bloqueios.length ? ` — ${bloqueios.length} BLOQUEIAM a gravação` : ""}`,
    ...fora.map(p => `  ${p.blocking ? "[BLOQUEIA] " : ""}linha ${p.line} · ${p.employee} · ${p.section} · ${p.message}`),
    "",
    `AVISOS — a linha entra, mas vale conferir (${avisos.length})`,
    ...avisos.map(p => `  linha ${p.line} · ${p.employee} · ${p.section} · ${p.message}`),
    "",
  ];
  writeFileSync(reportPath, linhas.join("\n"), { mode: 0o600 });
  console.log(linhas.slice(0, 18 + Object.keys(porTipo).length).join("\n"));
  console.log(`\nRelatório completo: ${reportPath}`);

  if (!apply) {
    console.log("\nSimulação concluída. Nada foi gravado.");
    return;
  }
  if (bloqueios.length) {
    console.error(`\n❌ ${bloqueios.length} motivo(s) sem classificação. Corrija ou inclua a regra antes de gravar.`);
    process.exit(1);
  }

  // --- Gravação --------------------------------------------------------------
  const empregados = casados.map(c => c.employee.id);

  for (const part of chunks(balances)) {
    await must(db.from("rh_vacation_balances").upsert(part, { onConflict: "employee_id,acquisition_start" }), "períodos aquisitivos");
  }
  const balanceRows = await todas(
    () => db.from("rh_vacation_balances").select("id, employee_id, acquisition_start, source").eq("organization_id", org.id).eq("source", SOURCE),
    "períodos gravados",
  );
  const balanceId = new Map(balanceRows.map(b => [`${b.employee_id}:${b.acquisition_start}`, b.id]));

  const absenceRows = absences.map(({ row, balanceKey }) => ({
    hours: null,
    day_part: null,
    ...row,
    vacation_balance_id: balanceKey ? balanceId.get(balanceKey) ?? null : null,
  }));
  for (const part of chunks(absenceRows)) {
    await must(db.from("rh_absences").upsert(part, { onConflict: "organization_id,source_key" }), "ausências");
  }

  const gravadas = await todas(
    () => db.from("rh_absences").select("id, source_key, employee_id").eq("organization_id", org.id).eq("source", SOURCE),
    "ausências gravadas",
  );
  const absenceId = new Map(gravadas.map(a => [a.source_key, a.id]));

  const clinicalRows = clinical.map(c => ({
    organization_id: org.id,
    absence_id: absenceId.get(c.sourceKey),
    cid_codes: c.cidCodes,
    diagnosis: c.diagnosis,
    note: c.note,
  }));
  if (clinicalRows.some(c => !c.absence_id)) throw new Error("dado clínico sem ausência correspondente");
  for (const part of chunks(clinicalRows)) {
    await must(db.from("rh_absence_clinical").upsert(part, { onConflict: "absence_id" }), "dado clínico");
  }

  // Ausência importada antes que não está mais no arquivo (linha corrigida ou
  // removida): sai, junto com o clínico dela. Só entre os desta importação.
  const atuais = new Set(absenceRows.map(r => r.source_key));
  const orfas = gravadas.filter(a => empregados.includes(a.employee_id) && !atuais.has(a.source_key)).map(a => a.id);
  for (const part of chunks(orfas)) {
    await must(db.from("rh_absences").delete().in("id", part), "ausências antigas");
  }
  const periodosAtuais = new Set(balances.map(b => `${b.employee_id}:${b.acquisition_start}`));
  const periodosOrfaos = balanceRows
    .filter(b => empregados.includes(b.employee_id) && !periodosAtuais.has(`${b.employee_id}:${b.acquisition_start}`))
    .map(b => b.id);
  for (const part of chunks(periodosOrfaos)) {
    await must(db.from("rh_vacation_balances").delete().in("id", part), "períodos antigos");
  }

  const count = async (table, filter = q => q) => {
    const { count: total } = await filter(db.from(table).select("*", { count: "exact", head: true }).eq("organization_id", org.id));
    return total;
  };
  console.log("\n✓ Gravado. No banco (origem = importação do histórico):");
  console.log(`  períodos ${await count("rh_vacation_balances", q => q.eq("source", SOURCE))} · ausências ${await count("rh_absences", q => q.eq("source", SOURCE))} · dado clínico ${await count("rh_absence_clinical")}`);
  console.log(`  removidos por não estarem mais no arquivo: ${orfas.length} ausência(s), ${periodosOrfaos.length} período(s)`);
}

run().catch(err => {
  console.error("Erro fatal:", err.message ?? err);
  process.exit(1);
});
