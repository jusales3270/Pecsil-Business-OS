#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Importação das entregas de EPI (ficha de EPI, NR-6)
 *
 * Lê o Markdown transcrito da exportação do ponto biométrico ("Entrega EPI",
 * uma seção `## Nome` por funcionário) e grava:
 *   rh_ppe_items       — catálogo (nome + CA), criado conforme aparece
 *   rh_ppe_deliveries  — cada entrega, com quantidade, data e assinatura
 *
 * O colaborador é casado PELO CPF contra rh_employee_personal_data (tabela
 * restrita), só aqui dentro. O CPF não é gravado em tabela nova nem aparece
 * no terminal ou no relatório. O arquivo tem dado pessoal — NÃO o coloque no
 * repositório e não envie nada dele a serviço externo.
 *
 * Reexecutável: cada linha tem chave estável (`source_key`); rodar de novo
 * atualiza, não duplica. Entrega importada antes e que sumiu do arquivo sai,
 * sempre só entre as desta importação.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-rh-epi.mjs --file ~/Downloads/entrega_epi_pecsil.md
 *   node scripts/import-rh-epi.mjs --file … --apply
 *
 * Opções: --url <supabase> · --report <arquivo> (padrão: ao lado do --file)
 * Requer SUPABASE_SERVICE_ROLE_KEY.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEntregasEpi } from "../lib/rh/epi-parser.ts";

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
const SOURCE = "importacao-epi-ponto";
/** Assinatura mais de N dias depois da entrega: sinal de carga em lote. */
const ATRASO_ASSINATURA = 7;

if (!filePath || !existsSync(filePath)) {
  console.error("❌ Informe o arquivo de entregas: --file <caminho>");
  process.exit(1);
}
if (!url || !serviceKey) {
  console.error("❌ Informe a URL do Supabase (--url) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const reportPath = getArg("--report") || resolve(dirname(filePath), "relatorio-importacao-epi.txt");
if (resolve(reportPath).startsWith(resolve(process.cwd()))) {
  console.error("❌ O relatório não pode ficar dentro do repositório.");
  process.exit(1);
}

const hash = text => createHash("sha256").update(text).digest("hex").slice(0, 20);
const chunks = (list, size = 400) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const itemKey = (key, ca) => `${key}#${ca ?? ""}`;
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function must(promise, context) {
  const { data, error } = await promise;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}

async function todas(build, context) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await must(build().range(from, from + 999), context);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function run() {
  const parsed = parseEntregasEpi(readFileSync(filePath, "utf8"));

  const orgs = await must(db.from("organizations").select("id"), "organizações");
  if (orgs.length !== 1) throw new Error(`Esperada 1 organização, encontradas ${orgs.length}.`);
  const org = orgs[0];

  // CPF → colaborador, só em memória.
  const documentos = await todas(
    () => db.from("rh_employee_personal_data").select("cpf, employee_id, employees!inner(full_name, active)").eq("organization_id", org.id),
    "documentos",
  );
  const porCpf = new Map(documentos.map(d => [d.cpf, { id: d.employee_id, nome: d.employees.full_name, ativo: d.employees.active }]));

  const casados = [];
  const semPar = [];
  for (const pessoa of parsed.employees) {
    const employee = pessoa.cpf ? porCpf.get(pessoa.cpf) : null;
    if (employee) casados.push({ pessoa, employee });
    else semPar.push({ pessoa, motivo: pessoa.cpf ? "CPF não está no cadastro" : "sem CPF no arquivo" });
  }

  // Catálogo: o que já existe, e o que a importação vai criar.
  const itensExistentes = await todas(
    () => db.from("rh_ppe_items").select("id, normalized_name, ca_number").eq("organization_id", org.id),
    "catálogo",
  );
  const itemId = new Map(itensExistentes.map(i => [itemKey(i.normalized_name, i.ca_number), i.id]));
  const novosItens = new Map();
  for (const { pessoa } of casados) {
    for (const entrega of pessoa.deliveries) {
      const key = itemKey(entrega.itemKey, entrega.caNumber);
      if (!itemId.has(key) && !novosItens.has(key)) {
        novosItens.set(key, { organization_id: org.id, name: entrega.itemName, normalized_name: entrega.itemKey, ca_number: entrega.caNumber });
      }
    }
  }

  const entregas = casados.flatMap(({ pessoa, employee }) =>
    pessoa.deliveries.map(entrega => ({ entrega, employee, pessoa })));
  const semAssinatura = entregas.filter(({ entrega }) => !entrega.signedOn);
  const assinadasTarde = entregas.filter(({ entrega }) => entrega.signedOn && dias(entrega.deliveredOn, entrega.signedOn) > ATRASO_ASSINATURA);
  const semCa = new Set(entregas.filter(({ entrega }) => !entrega.caNumber).map(({ entrega }) => entrega.itemName));
  const inativos = casados.filter(c => !c.employee.ativo);
  const porPessoaSemAssinatura = semAssinatura.reduce((acc, { pessoa }) => acc.set(pessoa.name, (acc.get(pessoa.name) ?? 0) + 1), new Map());

  const linhas = [
    `IMPORTAÇÃO DAS ENTREGAS DE EPI ${apply ? "" : "(SIMULAÇÃO)"}`,
    `Arquivo: ${filePath}`,
    "",
    `Funcionários no arquivo: ${parsed.employees.length} · casados pelo CPF: ${casados.length} · sem par: ${semPar.length}`,
    `Entregas a gravar: ${entregas.length} (de ${parsed.employees.reduce((s, e) => s + e.deliveries.length, 0)} no arquivo)`,
    `Itens no catálogo: ${itensExistentes.length} existentes · ${novosItens.size} novos`,
    `Itens sem CA (${semCa.size}): ${[...semCa].join(" · ") || "nenhum"}`,
    `Entregas sem assinatura: ${semAssinatura.length}`,
    `Assinadas mais de ${ATRASO_ASSINATURA} dias depois da entrega: ${assinadasTarde.length}`,
    `Linhas repetidas descartadas: ${parsed.employees.reduce((s, e) => s + e.duplicates, 0)}`,
    inativos.length ? `Casados com colaborador inativo: ${inativos.map(c => c.pessoa.name).join(" · ")}` : "",
    "",
    `SEM PAR NO CADASTRO (${semPar.length}) — as entregas deles não entram; cadastre e rode de novo`,
    ...semPar.map(({ pessoa, motivo }) => `  linha ${pessoa.line} · ${pessoa.name} · ${pessoa.role ?? "—"} · ${pessoa.deliveries.length} entrega(s) · ${motivo}`),
    "",
    `ENTREGAS SEM ASSINATURA POR PESSOA (${porPessoaSemAssinatura.size})`,
    ...[...porPessoaSemAssinatura].map(([nome, n]) => `  ${nome}: ${n}`),
    "",
    `LINHAS FORA DA IMPORTAÇÃO (${parsed.problems.length})`,
    ...parsed.problems.map(p => `  linha ${p.line} · ${p.employee} · ${p.message}`),
    "",
  ].filter(line => line !== "" || true);
  writeFileSync(reportPath, linhas.join("\n"), { mode: 0o600 });
  console.log(linhas.slice(0, 12).filter(Boolean).join("\n"));
  console.log(`\nRelatório completo: ${reportPath}`);

  if (!apply) {
    console.log("\nSimulação concluída. Nada foi gravado.");
    return;
  }

  // --- Gravação --------------------------------------------------------------
  for (const part of chunks([...novosItens.values()])) {
    const criados = await must(db.from("rh_ppe_items").insert(part).select("id, normalized_name, ca_number"), "catálogo");
    for (const i of criados) itemId.set(itemKey(i.normalized_name, i.ca_number), i.id);
  }

  const rows = entregas.map(({ entrega, employee }) => ({
    organization_id: org.id,
    employee_id: employee.id,
    item_id: itemId.get(itemKey(entrega.itemKey, entrega.caNumber)),
    quantity: entrega.quantity,
    delivered_on: entrega.deliveredOn,
    signed_on: entrega.signedOn,
    signature_method: entrega.signedOn ? "biometria" : null,
    source: SOURCE,
    source_key: `epi:${employee.id}:${hash(entrega.fingerprint)}`,
  }));
  if (rows.some(r => !r.item_id)) throw new Error("entrega sem item no catálogo");
  for (const part of chunks(rows)) {
    await must(db.from("rh_ppe_deliveries").upsert(part, { onConflict: "organization_id,source_key" }), "entregas");
  }

  const gravadas = await todas(
    () => db.from("rh_ppe_deliveries").select("id, source_key, employee_id").eq("organization_id", org.id).eq("source", SOURCE),
    "entregas gravadas",
  );
  const atuais = new Set(rows.map(r => r.source_key));
  const empregados = new Set(casados.map(c => c.employee.id));
  const orfas = gravadas.filter(g => empregados.has(g.employee_id) && !atuais.has(g.source_key)).map(g => g.id);
  for (const part of chunks(orfas)) {
    await must(db.from("rh_ppe_deliveries").delete().in("id", part), "entregas antigas");
  }

  const { count: total } = await db.from("rh_ppe_deliveries").select("*", { count: "exact", head: true }).eq("organization_id", org.id).eq("source", SOURCE);
  const { count: itens } = await db.from("rh_ppe_items").select("*", { count: "exact", head: true }).eq("organization_id", org.id);
  console.log(`\n✓ Gravado. No banco: entregas ${total} · itens no catálogo ${itens} · removidas por não estarem mais no arquivo: ${orfas.length}`);
}

run().catch(err => {
  console.error("Erro fatal:", err.message ?? err);
  process.exit(1);
});
