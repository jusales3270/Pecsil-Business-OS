#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Migração de Dados: Portaria Cloud ➔ Business OS
 *
 * Extrai visitantes (com biometria facial), visitas, frota, terceiros e
 * encomendas do projeto Supabase Cloud da Portaria para um snapshot JSON,
 * que scripts/import-portaria-json.mjs grava no banco da PecSil.
 *
 * O snapshot tem biometria e dados pessoais: fica FORA do repositório
 * (padrão ~/.config/pecsil/portaria-snapshot.json, permissão 600).
 *
 * Chave: PORTARIA_CLOUD_KEY no ambiente ou o arquivo
 * ~/.config/pecsil/portaria-cloud-key (permissão 600).
 * Uso: node scripts/migrate-portaria-cloud-to-local.mjs [--out <arquivo>]
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CLOUD_URL = process.env.PORTARIA_CLOUD_URL || "https://hukhlzcrjbtqseszfxyq.supabase.co";
const KEY_FILE = resolve(process.env.HOME || "", ".config/pecsil/portaria-cloud-key");
const CLOUD_KEY = process.env.PORTARIA_CLOUD_KEY || (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : "");
const outArg = process.argv.indexOf("--out");
const OUTPUT = outArg !== -1 && process.argv[outArg + 1]
  ? resolve(process.argv[outArg + 1])
  : resolve(process.env.HOME || "", ".config/pecsil/portaria-snapshot.json");

if (!CLOUD_KEY) {
  console.error(`❌ Defina PORTARIA_CLOUD_KEY ou salve a chave em ${KEY_FILE} (a chave nunca fica no código).`);
  process.exit(1);
}

console.log("==========================================================");
console.log("🚀 MIGRAÇÃO DE DADOS: PORTARIA CLOUD ➔ BUSINESS OS");
console.log("==========================================================");
console.log(`Origem (Cloud): ${CLOUD_URL}`);

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });

/** Lê a tabela inteira: o PostgREST devolve no máximo 1000 linhas por vez. */
async function readAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await cloud.from(table).select("*").order("id").range(from, from + 999);
    if (error) return { data: null, error };
    rows.push(...data);
    if (data.length < 1000) return { data: rows, error: null };
  }
}

async function run() {
  console.log("\n1. Extraindo Visitantes (Biometria Facial)...");
  const { data: visitantes, error: vErr } = await readAll("visitantes");

  if (vErr) {
    console.error("❌ Erro ao extrair visitantes:", vErr.message);
  } else {
    console.log(`✓ Visitantes extraídos: ${visitantes.length}`);
  }

  console.log("\n2. Extraindo Histórico de Visitas...");
  const { data: visitas, error: visErr } = await readAll("visitas");

  if (visErr) {
    console.error("❌ Erro ao extrair visitas:", visErr.message);
  } else {
    console.log(`✓ Visitas extraídas: ${visitas.length}`);
  }

  console.log("\n3. Extraindo Controle de Frota...");
  const { data: frota, error: fErr } = await readAll("frota");

  if (fErr) {
    console.error("❌ Erro ao extrair frota:", fErr.message);
  } else {
    console.log(`✓ Registros de frota extraídos: ${frota.length}`);
  }

  console.log("\n4. Extraindo Prestadores Terceiros...");
  const { data: terceirosCloud, error: tErr } = await readAll("terceiros");
  if (tErr) console.error("❌ Erro ao extrair terceiros:", tErr.message);
  let terceiros = terceirosCloud || [];

  // Se a tabela em nuvem estiver vazia, carrega o arquivo de backup CSV mais recente
  if (terceiros.length === 0) {
    const csvPath = resolve(process.env.HOME || "", "Downloads/controle_terceiros_2026-09-02.csv");
    if (existsSync(csvPath)) {
      console.log(`ℹ️ Carregando registros de terceiros a partir do backup CSV: ${csvPath}`);
      const csvLines = readFileSync(csvPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
      // Header: Nome;Data;Dia da Semana;Entrada;Saída;Horas no Dia;Acumulado Semanal;Acumulado Mensal
      for (let i = 1; i < csvLines.length; i++) {
        const parts = csvLines[i].split(";");
        if (parts.length >= 5) {
          const [nome, dataRaw, , entrada, saida] = parts;
          if (!nome || !dataRaw) continue;
          // dataRaw: dd/mm/aaaa -> aaaa-mm-dd
          const [d, m, y] = dataRaw.split("/");
          const dataIso = y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : dataRaw;
          terceiros.push({
            id: `terc-csv-${i}`,
            nome: nome.trim(),
            data: dataIso,
            hora_entrada: entrada ? `${dataIso}T${entrada.trim()}:00.000Z` : "",
            hora_saida: saida && saida !== "-" ? `${dataIso}T${saida.trim()}:00.000Z` : null,
            minutos_trabalhados: 0,
          });
        }
      }
      console.log(`✓ Terceiros carregados do backup CSV: ${terceiros.length}`);
    }
  } else {
    console.log(`✓ Terceiros extraídos: ${terceiros.length}`);
  }

  console.log("\n5. Extraindo Encomendas / Recebidos...");
  const { data: encomendasCloud } = await readAll("encomendas");
  const encomendas = encomendasCloud || [];
  console.log(`✓ Encomendas extraídas: ${encomendas.length}`);

  // Formata os dados para o formato interno do módulo Portaria
  const formattedVisitas = (visitas || []).map((v) => ({
    id: v.id,
    data: v.data,
    empresa: v.empresa || "",
    visitante: v.visitante || "",
    horarioEntrada: v.horario_entrada || "",
    horarioSaida: v.horario_saida || "",
    documento: v.documento || "",
    contato: v.contato || "",
    responsavel: v.responsavel || "",
    placaVeiculo: v.placa_veiculo || "-",
    notasFiscais: Array.isArray(v.notas_fiscais) && v.notas_fiscais.length > 0
      ? v.notas_fiscais
      : (v.nota_fiscal && v.nota_fiscal !== "-"
        ? [{ numero: v.nota_fiscal, valor: Number(v.valor_nfe || 0) }]
        : [{ numero: "", valor: 0 }]),
    descricao: v.descricao || "",
    fotoBase64: v.foto_base64 || undefined,
    createdAt: v.created_at,
  }));

  const formattedFrota = (frota || []).map((v) => ({
    id: v.id,
    data: v.data,
    motorista: v.responsavel || "",
    veiculo: v.veiculo || "",
    horarioSaida: v.horario_saida || "",
    dataRetorno: v.data_retorno || "",
    horarioRetorno: v.horario_retorno || "",
    kmRodados: Math.max(0, Number(v.km_rodados || 0)),
    kmSaida: Number(v.km_saida || 0),
    kmEntrada: Number(v.km_entrada || 0),
    destino: v.destino || "",
    notasFiscais: Array.isArray(v.notas_fiscais) && v.notas_fiscais.length > 0
      ? v.notas_fiscais
      : (v.nota_fiscal && v.nota_fiscal !== ""
        ? [{ numero: v.nota_fiscal, valor: Number(v.valor_nfe || 0) }]
        : [{ numero: "", valor: 0 }]),
    createdAt: v.created_at,
  }));

  const formattedTerceiros = terceiros.map((t) => ({
    id: t.id,
    nome: t.nome,
    data: t.data,
    horaEntrada: t.hora_entrada,
    horaSaida: t.hora_saida || undefined,
    // Minutos calculados pela própria Portaria na saída; vazio quando ela
    // não calculou (saída registrada em outro dia). Não recalcular aqui.
    minutosTrabalhados: t.minutos_trabalhados ?? null,
    // A Portaria ordena as listas por created_at: preservar o original.
    createdAt: t.created_at,
  }));

  const snapshot = {
    visitantes: visitantes || [],
    visitas: formattedVisitas,
    frota: formattedFrota,
    terceiros: formattedTerceiros,
    encomendas,
    migratedAt: new Date().toISOString(),
  };

  if ([vErr, visErr, fErr, tErr].some(Boolean)) {
    console.error("\n❌ Extração incompleta: nenhum snapshot gravado.");
    process.exit(1);
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
  chmodSync(OUTPUT, 0o600);
  console.log(`\n💾 Snapshot gravado em: ${OUTPUT} (permissão 600)`);

  console.log("\n==========================================================");
  console.log("📊 RESUMO TOTAL DA MIGRAÇÃO");
  console.log("==========================================================");
  console.log(`Visitantes (Faces) : ${snapshot.visitantes.length}`);
  console.log(`Histórico Visitas  : ${snapshot.visitas.length}`);
  console.log(`Registros de Frota : ${snapshot.frota.length}`);
  console.log(`Prestadores        : ${snapshot.terceiros.length}`);
  console.log(`Encomendas         : ${snapshot.encomendas.length}`);
  console.log("==========================================================");
  console.log("🎉 Migração dos dados da Portaria concluída com sucesso!");
}

run().catch((err) => {
  console.error("Erro fatal durante migração:", err);
  process.exit(1);
});
