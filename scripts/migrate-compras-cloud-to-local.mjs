#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Migração de Dados: Compras Cloud ➔ Supabase Oficial
 *
 * Extrai cotações, produtos e compras do projeto Supabase Cloud e injeta
 * no Supabase oficial da Pecsil preservando integridade referencial e IDs.
 *
 * Uso:
 *   node scripts/migrate-compras-cloud-to-local.mjs \
 *     --cloud-url "https://vfnyyyzsicgiweisgamt.supabase.co" \
 *     --cloud-key "SUA_CHAVE_SERVICE_OU_ANON_CLOUD"
 *
 * Ou via variáveis de ambiente no .env.local:
 *   COMPRAS_CLOUD_URL=...
 *   COMPRAS_CLOUD_KEY=...
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Carrega .env.local
const envPath = resolve(process.cwd(), ".env.local");
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = val;
    }
  }
}

// Argumentos de linha de comando
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const cloudUrl = getArg("--cloud-url") || env.COMPRAS_CLOUD_URL || "https://vfnyyyzsicgiweisgamt.supabase.co";
const cloudKey = getArg("--cloud-key") || env.COMPRAS_CLOUD_KEY;

const localUrl = getArg("--local-url") || "http://127.0.0.1:54331";
const localServiceKey = getArg("--local-key") || env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("==========================================================");
console.log("🚀 MIGRAÇÃO DE DADOS: COMPRAS CLOUD ➔ PECSIL BUSINESS OS");
console.log("==========================================================");
console.log(`Origem (Cloud):  ${cloudUrl}`);
console.log(`Destino (Local):  ${localUrl}`);
console.log("----------------------------------------------------------");

if (!cloudKey) {
  console.error("❌ ERRO: Chave do Supabase Cloud não informada!");
  console.error("Passe --cloud-key <chave> ou defina COMPRAS_CLOUD_KEY no .env.local");
  process.exit(1);
}

if (!localUrl || !localServiceKey) {
  console.error("❌ ERRO: Credenciais locais (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) ausentes!");
  process.exit(1);
}

const cloudClient = createClient(cloudUrl, cloudKey, { auth: { persistSession: false } });
const localClient = createClient(localUrl, localServiceKey, { auth: { persistSession: false } });

async function runMigration() {
  // 1. Obtém organization_id da Pecsil
  const { data: org, error: orgError } = await localClient
    .from("organizations")
    .select("id, display_name")
    .limit(1)
    .single();

  if (orgError || !org) {
    console.error("❌ Não foi possível obter a organização oficial no banco local:", orgError?.message);
    process.exit(1);
  }

  const organizationId = org.id;
  console.log(`✓ Organização vinculada: ${org.display_name} (${organizationId})`);
  console.log("\nExtraindo dados do Supabase Cloud...");

  // 2. Extrai Cotações
  const { data: cloudCotacoes, error: cotErr } = await cloudClient.from("cotacoes").select("*");
  if (cotErr) {
    console.error("❌ Falha ao ler 'cotacoes' da nuvem:", cotErr.message);
    process.exit(1);
  }

  // 3. Extrai Itens de Cotação
  const { data: cloudProdutos, error: prodErr } = await cloudClient.from("cotacao_produtos").select("*");
  if (prodErr) {
    console.error("❌ Falha ao ler 'cotacao_produtos' da nuvem:", prodErr.message);
    process.exit(1);
  }

  // 4. Extrai Compras
  const { data: cloudCompras, error: compErr } = await cloudClient.from("compras").select("*");
  if (compErr) {
    console.error("❌ Falha ao ler 'compras' da nuvem:", compErr.message);
    process.exit(1);
  }

  console.log(`\nRegistros identificados na nuvem:`);
  console.log(`- Cotações:          ${cloudCotacoes?.length || 0}`);
  console.log(`- Itens de Cotação:  ${cloudProdutos?.length || 0}`);
  console.log(`- Compras:           ${cloudCompras?.length || 0}`);

  console.log("\nIniciando gravação no banco oficial Pecsil...");

  // Grava cotações
  let cotacoesGravadas = 0;
  if (cloudCotacoes && cloudCotacoes.length > 0) {
    const payload = cloudCotacoes.map((row) => ({
      ...row,
      organization_id: organizationId,
    }));

    const { error: insertCotErr } = await localClient.from("cotacoes").upsert(payload, { onConflict: "id" });
    if (insertCotErr) {
      console.error("❌ Erro ao gravar cotações no banco local:", insertCotErr.message);
    } else {
      cotacoesGravadas = payload.length;
    }
  }

  // Grava itens de cotação
  let produtosGravados = 0;
  if (cloudProdutos && cloudProdutos.length > 0) {
    const { error: insertProdErr } = await localClient
      .from("cotacao_produtos")
      .upsert(cloudProdutos, { onConflict: "id" });
    if (insertProdErr) {
      console.error("❌ Erro ao gravar itens no banco local:", insertProdErr.message);
    } else {
      produtosGravados = cloudProdutos.length;
    }
  }

  // Grava compras
  let comprasGravadas = 0;
  if (cloudCompras && cloudCompras.length > 0) {
    const payload = cloudCompras.map((row) => ({
      ...row,
      organization_id: organizationId,
    }));

    const { error: insertCompErr } = await localClient.from("compras").upsert(payload, { onConflict: "id" });
    if (insertCompErr) {
      console.error("❌ Erro ao gravar compras no banco local:", insertCompErr.message);
    } else {
      comprasGravadas = payload.length;
    }
  }

  console.log("\n==========================================================");
  console.log("📊 RELATÓRIO FINAL DE MIGRAÇÃO");
  console.log("==========================================================");
  console.log(`Tabela             | Origem (Cloud) | Gravados (Pecsil) | Status`);
  console.log(`-------------------+----------------+-------------------+--------`);
  console.log(
    `cotacoes           | ${String(cloudCotacoes?.length || 0).padEnd(14)} | ${String(cotacoesGravadas).padEnd(17)} | ${cotacoesGravadas === (cloudCotacoes?.length || 0) ? "✅ 100% OK" : "⚠️ ATENÇÃO"}`,
  );
  console.log(
    `cotacao_produtos   | ${String(cloudProdutos?.length || 0).padEnd(14)} | ${String(produtosGravados).padEnd(17)} | ${produtosGravados === (cloudProdutos?.length || 0) ? "✅ 100% OK" : "⚠️ ATENÇÃO"}`,
  );
  console.log(
    `compras            | ${String(cloudCompras?.length || 0).padEnd(14)} | ${String(comprasGravadas).padEnd(17)} | ${comprasGravadas === (cloudCompras?.length || 0) ? "✅ 100% OK" : "⚠️ ATENÇÃO"}`,
  );
  console.log("==========================================================");
  console.log("🎉 Migração concluída com sucesso!");
}

runMigration().catch((err) => {
  console.error("Erro fatal durante migração:", err);
  process.exit(1);
});
