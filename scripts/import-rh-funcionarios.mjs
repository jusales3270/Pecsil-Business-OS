#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Importação da relação de funcionários (arquivo da folha)
 *
 * Lê o TXT de largura fixa exportado pela folha e popula o cadastro mestre:
 *   units (Matriz) · departments · teams · positions · employees
 *   rh_employee_personal_data (CPF, PIS, CTPS — tabela restrita ao RH)
 *
 * Setor "USINAGEM/TORNO CNC" → departamento Usinagem + equipe Torno CNC.
 * Setor sem barra ("LIMPEZA") → só departamento.
 *
 * Idempotente: upsert por matrícula / código. Nunca imprime CPF, PIS ou CTPS.
 * O arquivo contém dados pessoais — NÃO o coloque no repositório.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-rh-funcionarios.mjs --file ~/Downloads/Funcionários.txt
 *   node scripts/import-rh-funcionarios.mjs --file ~/Downloads/Funcionários.txt --apply
 *
 * Opções: --url <supabase> (padrão SUPABASE_INTERNAL_URL/NEXT_PUBLIC_SUPABASE_URL)
 * Requer SUPABASE_SERVICE_ROLE_KEY.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const apply = args.includes("--apply");
const filePath = getArg("--file");
const url = getArg("--url") || env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!filePath || !existsSync(filePath)) {
  console.error("❌ Informe o arquivo da folha: --file <caminho>");
  process.exit(1);
}
if (!url || !serviceKey) {
  console.error("❌ Informe a URL do Supabase (--url) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

// --- Leitura do layout de largura fixa ---------------------------------------

const onlyDigits = value => value.replace(/\D/g, "");
const stripZeros = value => value.replace(/^0+/, "");

const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);
const UPPER_WORDS = new Set(["CNC", "RH", "TI", "SST"]);

/** "PREPARADOR E OPERADOR MULT CNC A" → "Preparador e Operador Mult CNC A" */
function titleCase(text) {
  const words = text.trim().replace(/\s+/g, " ").split(" ");
  const capitalize = part => {
    const lower = part.toLocaleLowerCase("pt-BR");
    return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
  };
  return words
    .map((word, index) => {
      if (UPPER_WORDS.has(word) || /\d/.test(word)) return word;
      // Letra isolada no fim é o nível do cargo ("Operador de CNC A")
      if (/^[A-Z]$/.test(word) && index === words.length - 1) return word;
      const lower = word.toLocaleLowerCase("pt-BR");
      if (index > 0 && LOWER_WORDS.has(lower)) return lower;
      return word.split("/").map(capitalize).join("/");
    })
    .join(" ");
}

/** Código estável e sem acento: "Torno CNC" → "TORNO-CNC" */
function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** "66298/00280", "04460/00220/SP", "05443815/08818SP", "5340310/001-0" */
function parseCtps(raw) {
  const match = raw.trim().match(/^(\d+)\/([\d-]+?)(?:\/?([A-Z]{2}))?$/);
  if (!match) return { ctps_number: raw.trim() || null, ctps_series: null, ctps_uf: null };
  return { ctps_number: match[1], ctps_series: match[2], ctps_uf: match[3] ?? null };
}

function parseDate(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split("/");
  return y && m && d ? `${y}-${m}-${d}` : null;
}

function cpfValid(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  for (const n of [9, 10]) {
    const sum = [...cpf.slice(0, n)].reduce((acc, digit, i) => acc + Number(digit) * (n + 1 - i), 0);
    if (((sum * 10) % 11) % 10 !== Number(cpf[n])) return false;
  }
  return true;
}

function parseLine(line) {
  const sector = line.slice(246, 296).trim().replace(/\s*-\s*/, "/");
  const [departmentRaw, teamRaw] = sector.split("/").map(part => part?.trim()).filter(Boolean);
  return {
    employeeNumber: stripZeros(line.slice(0, 22)),
    pis: stripZeros(line.slice(42, 62)) || null,
    fullName: line.slice(62, 122).trim().replace(/\s+/g, " "),
    ctps: parseCtps(line.slice(122, 172)),
    cnpj: line.slice(172, 192).trim(),
    position: titleCase(line.slice(196, 246)),
    department: titleCase(departmentRaw ?? ""),
    team: teamRaw ? titleCase(teamRaw) : null,
    admissionDate: parseDate(line.slice(296, 306)),
    cpf: onlyDigits(line.slice(571, 585)),
  };
}

const lines = readFileSync(filePath, "utf8").split(/\r?\n/).filter(line => line.trim());
const records = lines.map(parseLine);

const problems = [];
records.forEach((r, i) => {
  if (!r.employeeNumber) problems.push(`linha ${i + 1}: sem matrícula`);
  if (!r.fullName) problems.push(`linha ${i + 1}: sem nome`);
  if (!cpfValid(r.cpf)) problems.push(`linha ${i + 1} (mat. ${r.employeeNumber}): CPF inválido`);
  if (r.pis && !/^\d{11}$/.test(r.pis)) problems.push(`linha ${i + 1} (mat. ${r.employeeNumber}): PIS com formato inesperado`);
  if (!r.admissionDate) problems.push(`linha ${i + 1} (mat. ${r.employeeNumber}): admissão inválida`);
  if (!r.department) problems.push(`linha ${i + 1} (mat. ${r.employeeNumber}): sem setor`);
});
if (problems.length) {
  console.error("❌ O arquivo tem problemas; nada foi gravado:\n  " + problems.join("\n  "));
  process.exit(1);
}

// --- Mapeamento para a estrutura existente ------------------------------------

/** Departamentos do provisionamento que o arquivo reaproveita (por nome). */
const REUSE_DEPARTMENTS = { "Recursos Humanos": "RH", Qualidade: "QUAL", "Administração": "ADMIN" };
/** Genéricos do provisionamento sem correspondente no arquivo → inativos. */
const RETIRE_DEPARTMENTS = ["PROD"];
const RETIRE_TEAMS = ["OPERACAO"];
const RETIRE_POSITIONS = ["ANALISTA", "DIRETOR", "GESTOR", "OPERADOR"];

const departmentCode = name => REUSE_DEPARTMENTS[name] ?? slug(name);
const teamCode = (department, team) => `${slug(department)}-${slug(team)}`;
const positionLevel = name => (name.match(/ ([A-E])$/)?.[1] ? `Nível ${name.match(/ ([A-E])$/)[1]}` : null);

const departments = [...new Set(records.map(r => r.department))].sort();
const teams = [...new Map(records.filter(r => r.team).map(r => [teamCode(r.department, r.team), r])).values()]
  .map(r => ({ department: r.department, team: r.team }))
  .sort((a, b) => `${a.department}${a.team}`.localeCompare(`${b.department}${b.team}`));
const positions = [...new Set(records.map(r => r.position))].sort();
const cnpjs = [...new Set(records.map(r => r.cnpj))];

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function must(promise, context) {
  const { data, error } = await promise;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}

async function run() {
  console.log("==========================================================");
  console.log(`👥 IMPORTAÇÃO DE FUNCIONÁRIOS ${apply ? "" : "(SIMULAÇÃO — use --apply para gravar)"}`);
  console.log("==========================================================");
  console.log(`Destino: ${url}`);
  console.log(`Arquivo: ${records.length} colaboradores · ${records.filter(r => !r.pis).length} sem PIS · CNPJ ${cnpjs.join(", ")}\n`);

  const orgs = await must(db.from("organizations").select("id, display_name, tax_id"), "organizações");
  if (orgs.length !== 1) throw new Error(`Esperada 1 organização, encontradas ${orgs.length}.`);
  const org = orgs[0];

  const unit = (await must(db.from("units").select("id, code").eq("organization_id", org.id).eq("code", "MATRIZ"), "unidade"))[0];
  if (!unit) throw new Error("Unidade MATRIZ não encontrada.");

  const existingEmployees = await must(db.from("employees").select("employee_number").eq("organization_id", org.id), "colaboradores");
  const existingNumbers = new Set(existingEmployees.map(e => e.employee_number));

  console.log(`Organização: ${org.display_name} · CNPJ atual: ${org.tax_id ?? "(vazio)"}${cnpjs.length === 1 && !org.tax_id ? ` → ${cnpjs[0]}` : ""}`);
  console.log(`Departamentos (${departments.length}): ${departments.map(d => `${d} [${departmentCode(d)}]`).join(" · ")}`);
  console.log(`Equipes (${teams.length}): ${teams.map(t => `${t.department}/${t.team}`).join(" · ")}`);
  console.log(`Cargos (${positions.length})`);
  console.log(`Colaboradores: ${records.filter(r => !existingNumbers.has(r.employeeNumber)).length} novos · ${records.filter(r => existingNumbers.has(r.employeeNumber)).length} atualizados`);
  console.log(`Inativar genéricos: departamentos ${RETIRE_DEPARTMENTS.join(", ")} · equipes ${RETIRE_TEAMS.join(", ")} · cargos ${RETIRE_POSITIONS.join(", ")}\n`);

  if (!apply) {
    console.log("Simulação concluída. Nada foi gravado.");
    return;
  }

  if (cnpjs.length === 1 && !org.tax_id) {
    await must(db.from("organizations").update({ tax_id: cnpjs[0] }).eq("id", org.id), "CNPJ da organização");
  }

  // Departamentos: os reaproveitados mantêm nome e só são garantidos ativos na
  // Matriz (upsert em lote gravaria `name = null` nas linhas sem nome).
  const reusedCodes = departments.map(departmentCode).filter(code => Object.values(REUSE_DEPARTMENTS).includes(code));
  if (reusedCodes.length) {
    await must(
      db.from("departments").update({ unit_id: unit.id, active: true }).eq("organization_id", org.id).in("code", reusedCodes),
      "departamentos reaproveitados",
    );
  }
  await must(
    db.from("departments").upsert(
      departments
        .filter(name => !reusedCodes.includes(departmentCode(name)))
        .map(name => ({ organization_id: org.id, unit_id: unit.id, code: departmentCode(name), name, active: true })),
      { onConflict: "organization_id,code" },
    ),
    "departamentos",
  );
  const departmentRows = await must(db.from("departments").select("id, code").eq("organization_id", org.id), "departamentos");
  const departmentId = Object.fromEntries(departmentRows.map(d => [d.code, d.id]));

  // Equipes
  await must(
    db.from("teams").upsert(
      teams.map(t => ({
        organization_id: org.id,
        department_id: departmentId[departmentCode(t.department)],
        code: teamCode(t.department, t.team),
        name: t.team,
        active: true,
      })),
      { onConflict: "organization_id,code" },
    ),
    "equipes",
  );
  const teamRows = await must(db.from("teams").select("id, code").eq("organization_id", org.id), "equipes");
  const teamId = Object.fromEntries(teamRows.map(t => [t.code, t.id]));

  // Cargos
  await must(
    db.from("positions").upsert(
      positions.map(name => ({ organization_id: org.id, code: slug(name), name, level: positionLevel(name), active: true })),
      { onConflict: "organization_id,code" },
    ),
    "cargos",
  );
  const positionRows = await must(db.from("positions").select("id, code").eq("organization_id", org.id), "cargos");
  const positionId = Object.fromEntries(positionRows.map(p => [p.code, p.id]));

  // Colaboradores
  await must(
    db.from("employees").upsert(
      records.map(r => ({
        organization_id: org.id,
        employee_number: r.employeeNumber,
        full_name: r.fullName,
        unit_id: unit.id,
        department_id: departmentId[departmentCode(r.department)],
        team_id: r.team ? teamId[teamCode(r.department, r.team)] : null,
        position_id: positionId[slug(r.position)],
        admission_date: r.admissionDate,
        active: true,
      })),
      { onConflict: "organization_id,employee_number" },
    ),
    "colaboradores",
  );
  const employeeRows = await must(db.from("employees").select("id, employee_number").eq("organization_id", org.id), "colaboradores");
  const employeeId = Object.fromEntries(employeeRows.map(e => [e.employee_number, e.id]));

  // Documentos pessoais (tabela restrita)
  await must(
    db.from("rh_employee_personal_data").upsert(
      records.map(r => ({
        employee_id: employeeId[r.employeeNumber],
        organization_id: org.id,
        cpf: r.cpf,
        pis: r.pis,
        ...r.ctps,
        source: "importacao-folha",
      })),
      { onConflict: "employee_id" },
    ),
    "documentos pessoais",
  );

  // Genéricos sem uso → inativos (não apaga: podem ser referenciados no futuro)
  await must(db.from("teams").update({ active: false }).eq("organization_id", org.id).in("code", RETIRE_TEAMS), "equipes genéricas");
  await must(db.from("departments").update({ active: false }).eq("organization_id", org.id).in("code", RETIRE_DEPARTMENTS), "departamentos genéricos");
  await must(db.from("positions").update({ active: false }).eq("organization_id", org.id).in("code", RETIRE_POSITIONS), "cargos genéricos");

  const count = async table => {
    const { count: total } = await db.from(table).select("*", { count: "exact", head: true }).eq("organization_id", org.id);
    return total;
  };
  console.log("✓ Gravado. Totais no banco:");
  console.log(`  colaboradores ${await count("employees")} · documentos ${await count("rh_employee_personal_data")} · departamentos ${await count("departments")} · equipes ${await count("teams")} · cargos ${await count("positions")}`);
  console.log("\n🎉 Importação concluída.");
}

run().catch(err => {
  console.error("Erro fatal:", err.message ?? err);
  process.exit(1);
});
