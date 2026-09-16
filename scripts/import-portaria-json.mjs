#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Importação do histórico da Portaria para o banco
 *
 * Lê o snapshot extraído do Supabase Cloud (modules/portaria/src/data/
 * dados-migrados.json) e grava em visitantes, visitas, frota, terceiros e
 * encomendas do Supabase da Pecsil, vinculando tudo à organização.
 *
 * Idempotente: upsert por `id`. IDs que não são UUID (terceiros vindos do CSV,
 * "terc-csv-N") viram um UUID determinístico — rodar de novo não duplica.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-portaria-json.mjs
 *   node scripts/import-portaria-json.mjs --apply
 *
 * Opções:
 *   --url <url>     Supabase de destino (padrão: SUPABASE_INTERNAL_URL ou
 *                   NEXT_PUBLIC_SUPABASE_URL do ambiente/.env.local)
 *   --org-id <id>   Organização (obrigatório se houver mais de uma)
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

const snapshot = JSON.parse(readFileSync(resolve("modules/portaria/src/data/dados-migrados.json"), "utf8"));

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function resolveOrganization() {
  const forced = getArg("--org-id");
  if (forced) return forced;
  const { data, error } = await db.from("organizations").select("id, name");
  if (error) throw new Error(`Falha ao ler organizações: ${error.message}`);
  if (data.length !== 1) {
    console.error(`❌ ${data.length} organizações encontradas. Informe --org-id:`);
    for (const org of data) console.error(`   ${org.id}  ${org.name}`);
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
      minutos_trabalhados: Number(t.minutosTrabalhados || 0),
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
    if (!apply) {
      console.log(`• ${table.padEnd(11)} ${String(rows.length).padStart(5)} no snapshot · ${before} já no banco`);
      continue;
    }
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
