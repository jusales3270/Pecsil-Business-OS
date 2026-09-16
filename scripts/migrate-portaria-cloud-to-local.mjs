#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Migração de Dados: Portaria Cloud ➔ Business OS
 *
 * Extrai visitantes (com biometria facial), visitas, frota, terceiros e
 * encomendas do projeto Supabase Cloud da Portaria e armazena localmente
 * em dados-migrados.json e atualiza dados.ts para hidratação completa.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CLOUD_URL = process.env.PORTARIA_CLOUD_URL || "https://hukhlzcrjbtqseszfxyq.supabase.co";
const CLOUD_KEY = process.env.PORTARIA_CLOUD_KEY;

if (!CLOUD_KEY) {
  console.error("❌ Defina PORTARIA_CLOUD_KEY no ambiente (a chave nunca fica no código).");
  process.exit(1);
}

console.log("==========================================================");
console.log("🚀 MIGRAÇÃO DE DADOS: PORTARIA CLOUD ➔ BUSINESS OS");
console.log("==========================================================");
console.log(`Origem (Cloud): ${CLOUD_URL}`);

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });

async function run() {
  console.log("\n1. Extraindo Visitantes (Biometria Facial)...");
  const { data: visitantes, error: vErr } = await cloud
    .from("visitantes")
    .select("*")
    .order("created_at", { ascending: false });

  if (vErr) {
    console.error("❌ Erro ao extrair visitantes:", vErr.message);
  } else {
    console.log(`✓ Visitantes extraídos: ${visitantes.length}`);
  }

  console.log("\n2. Extraindo Histórico de Visitas...");
  const { data: visitas, error: visErr } = await cloud
    .from("visitas")
    .select("*")
    .order("created_at", { ascending: false });

  if (visErr) {
    console.error("❌ Erro ao extrair visitas:", visErr.message);
  } else {
    console.log(`✓ Visitas extraídas: ${visitas.length}`);
  }

  console.log("\n3. Extraindo Controle de Frota...");
  const { data: frota, error: fErr } = await cloud
    .from("frota")
    .select("*")
    .order("created_at", { ascending: false });

  if (fErr) {
    console.error("❌ Erro ao extrair frota:", fErr.message);
  } else {
    console.log(`✓ Registros de frota extraídos: ${frota.length}`);
  }

  console.log("\n4. Extraindo Prestadores Terceiros...");
  const { data: terceirosCloud } = await cloud.from("terceiros").select("*");
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
  const { data: encomendasCloud } = await cloud.from("encomendas").select("*");
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
  }));

  const formattedTerceiros = terceiros.map((t) => ({
    id: t.id,
    nome: t.nome,
    data: t.data,
    horaEntrada: t.hora_entrada,
    horaSaida: t.hora_saida || undefined,
    minutosTrabalhados: t.minutos_trabalhados || 0,
  }));

  const snapshot = {
    visitantes: visitantes || [],
    visitas: formattedVisitas,
    frota: formattedFrota,
    terceiros: formattedTerceiros,
    encomendas,
    migratedAt: new Date().toISOString(),
  };

  const outputPath = resolve("modules/portaria/src/data/dados-migrados.json");
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`\n💾 Snapshot consolidado gravado em: ${outputPath}`);

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
