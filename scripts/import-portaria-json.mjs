#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Importação do histórico da Portaria para o banco
 *
 * Lê o snapshot extraído do Supabase Cloud por migrate-portaria-cloud-to-local
 * (padrão ~/.config/pecsil/portaria-snapshot.json, fora do repositório) e
 * grava em visitantes, visitas, frota, terceiros e encomendas do Supabase da
 * Pecsil, vinculando tudo à organização.
 *
 * Idempotente: upsert por `id`. IDs que não são UUID (terceiros vindos do CSV,
 * "terc-csv-N") viram um UUID determinístico — rodar de novo não duplica.
 *
 * Terceiros: o histórico até 02/09 entrou pela planilha da Portaria, com ids
 * próprios. Quando o snapshot traz o mesmo apontamento (nome, dia e hora de
 * entrada) com o id original da nuvem, a linha da planilha é substituída
 * pela original, que traz os minutos calculados pela Portaria.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-portaria-json.mjs
 *   node scripts/import-portaria-json.mjs --apply
 *
 * Opções:
 *   --url <url>     Supabase de destino (padrão: SUPABASE_INTERNAL_URL ou
 *                   NEXT_PUBLIC_SUPABASE_URL do ambiente/.env.local)
 *   --org-id <id>   Organização (obrigatório se houver mais de uma)
 *   --in <arquivo>  Snapshot (padrão ~/.config/pecsil/portaria-snapshot.json)
 * Requer SUPABASE_SERVICE_ROLE_KEY.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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
const url = getArg("--url") || env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("❌ Informe a URL do Supabase (--url) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stableUuid(table, id) {
  if (UUID.test(String(id))) return String(id);
  const hex = createHash("sha1").update(`pecsil:portaria:${table}:${id}`).digest("hex");
  // Formato UUID v5 (variante RFC 4122).
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const nf = list => (Array.isArray(list) ? list.filter(n => n && (n.numero || Number(n.valor) > 0)) : []);

const snapshotPath = resolve(getArg("--in") || resolve(process.env.HOME || "", ".config/pecsil/portaria-snapshot.json"));
if (!existsSync(snapshotPath)) {
  console.error(`❌ Snapshot não encontrado: ${snapshotPath}. Rode antes scripts/migrate-portaria-cloud-to-local.mjs.`);
  process.exit(1);
}
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

/** Mesmo apontamento de terceiro: nome (sem acento/caixa), dia e hora de entrada. */
const hhmm = value => (String(value ?? "").match(/(?:T|^)(\d{2}:\d{2})/) || [])[1] ?? "";
const plain = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const terceiroKey = row => `${plain(row.nome)}|${row.data}|${hhmm(row.hora_entrada)}`;

async function readAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function resolveOrganization() {
  const forced = getArg("--org-id");
  if (forced) return forced;
  const { data, error } = await db.from("organizations").select("id, display_name");
  if (error) throw new Error(`Falha ao ler organizações: ${error.message}`);
  if (data.length !== 1) {
    console.error(`❌ ${data.length} organizações encontradas. Informe --org-id:`);
    for (const org of data) console.error(`   ${org.id}  ${org.display_name}`);
    process.exit(1);
  }
  return data[0].id;
}

function buildRows(organizationId) {
  return {
    visitantes: (snapshot.visitantes ?? []).map(v => ({
      id: stableUuid("visitantes", v.id),
      organization_id: organizationId,
      nome: v.nome,
      empresa: v.empresa ?? "",
      documento: v.documento ?? "",
      contato: v.contato ?? "",
      face_descriptor: v.face_descriptor ?? null,
      created_at: v.created_at ?? undefined,
    })),
    visitas: (snapshot.visitas ?? []).map(v => ({
      id: stableUuid("visitas", v.id),
      organization_id: organizationId,
      data: v.data,
      empresa: v.empresa ?? "",
      visitante: v.visitante ?? "",
      horario_entrada: v.horarioEntrada || null,
      horario_saida: v.horarioSaida || null,
      documento: v.documento ?? "",
      contato: v.contato ?? "",
      responsavel: v.responsavel ?? "",
      placa_veiculo: v.placaVeiculo || "-",
      notas_fiscais: nf(v.notasFiscais),
      descricao: v.descricao ?? "",
      foto_base64: v.fotoBase64 || null,
    })),
    frota: (snapshot.frota ?? []).map(v => ({
      id: stableUuid("frota", v.id),
      organization_id: organizationId,
      data: v.data,
      responsavel: v.motorista ?? "",
      veiculo: v.veiculo ?? "",
      horario_saida: v.horarioSaida || null,
      data_retorno: v.dataRetorno || null,
      horario_retorno: v.horarioRetorno || null,
      km_rodados: Math.max(0, Number(v.kmRodados || 0)),
      km_saida: Number(v.kmSaida || 0),
      km_entrada: Number(v.kmEntrada || 0),
      destino: v.destino ?? "",
      notas_fiscais: nf(v.notasFiscais),
    })),
    terceiros: (snapshot.terceiros ?? []).map(t => ({
      id: stableUuid("terceiros", t.id),
      organization_id: organizationId,
      nome: t.nome,
      data: t.data,
      hora_entrada: t.horaEntrada || "",
      hora_saida: t.horaSaida || null,
      // Minutos da própria Portaria; vazio quando ela não calculou.
      minutos_trabalhados: t.minutosTrabalhados === null || t.minutosTrabalhados === undefined ? null : Number(t.minutosTrabalhados),
    })),
    encomendas: (snapshot.encomendas ?? []).map(e => ({
      id: stableUuid("encomendas", e.id),
      organization_id: organizationId,
      data: e.data,
      hora_registro: e.hora_registro ?? e.horaRegistro ?? "",
      remetente: e.remetente ?? "",
      destinatario: e.destinatario ?? "",
      descricao: e.descricao ?? "",
      foto_base64: e.foto_base64 ?? e.fotoBase64 ?? null,
    })),
  };
}

/** Lotes limitados por tamanho: as visitas carregam fotos em base64. */
function* batches(rows, maxBytes = 800_000, maxRows = 200) {
  let batch = [];
  let size = 0;
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length;
    if (batch.length && (size + rowSize > maxBytes || batch.length >= maxRows)) {
      yield batch;
      batch = [];
      size = 0;
    }
    batch.push(row);
    size += rowSize;
  }
  if (batch.length) yield batch;
}

async function run() {
  console.log("==========================================================");
  console.log(`📥 IMPORTAÇÃO DA PORTARIA ${apply ? "" : "(SIMULAÇÃO — use --apply para gravar)"}`);
  console.log("==========================================================");
  console.log(`Destino: ${url}`);

  const organizationId = await resolveOrganization();
  console.log(`Organização: ${organizationId}\n`);

  const tables = buildRows(organizationId);
  let failures = 0;

  for (const [table, rows] of Object.entries(tables)) {
    const { count: before, error: countError } = await db.from(table).select("id", { count: "exact", head: true });
    if (countError) {
      console.error(`❌ ${table}: tabela inacessível (${countError.message}). A migration 202609040002 foi aplicada?`);
      failures++;
      continue;
    }
    const existing = await readAll(table, table === "terceiros" ? "id, nome, data, hora_entrada" : "id");
    const existingIds = new Set(existing.map(row => row.id));
    const snapshotIds = new Set(rows.map(row => row.id));
    // Linhas da planilha que o snapshot traz com o id original: substituir.
    let replaced = [];
    if (table === "terceiros") {
      const snapshotKeys = new Set(rows.map(terceiroKey));
      replaced = existing.filter(row => !snapshotIds.has(row.id) && snapshotKeys.has(terceiroKey(row))).map(row => row.id);
    }
    const replacedKeys = new Set(existing.filter(row => replaced.includes(row.id)).map(terceiroKey));
    const updates = rows.filter(row => existingIds.has(row.id)).length;
    const inserts = rows.length - updates;
    const reallyNew = table === "terceiros" ? rows.filter(row => !existingIds.has(row.id) && !replacedKeys.has(terceiroKey(row))).length : inserts;
    const onlyInDb = existing.filter(row => !snapshotIds.has(row.id) && !replaced.includes(row.id)).length;
    console.log(`• ${table.padEnd(11)} snapshot ${String(rows.length).padStart(5)} · banco ${before} · novos ${reallyNew} · atualizados ${updates}` +
      (replaced.length ? ` · planilha substituída pelo original ${replaced.length}` : "") +
      (onlyInDb ? ` · só no banco (mantidos) ${onlyInDb}` : ""));
    if (!apply) continue;
    let written = 0;
    for (const batch of batches(rows)) {
      const { error } = await db.from(table).upsert(batch, { onConflict: "id" });
      if (error) {
        console.error(`❌ ${table}: lote falhou após ${written} registros — ${error.message}`);
        failures++;
        break;
      }
      written += batch.length;
    }
    if (replaced.length && written === rows.length) {
      for (let i = 0; i < replaced.length; i += 200) {
        const { error } = await db.from(table).delete().in("id", replaced.slice(i, i + 200));
        if (error) {
          console.error(`❌ ${table}: falha ao remover linhas da planilha — ${error.message}`);
          failures++;
          break;
        }
      }
    }
    const { count: after } = await db.from(table).select("id", { count: "exact", head: true });
    console.log(`✓ ${table.padEnd(11)} ${written}/${rows.length} gravados · banco: ${before} → ${after}`);
  }

  if (failures) {
    console.error(`\n⚠️ Concluído com ${failures} falha(s).`);
    process.exit(1);
  }
  console.log(apply ? "\n🎉 Importação concluída." : "\nSimulação concluída. Nada foi gravado.");
}

run().catch(err => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
