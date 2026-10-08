#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga do extrato bancário e conciliação (linha de comando)
 *
 * Mesma lógica da tela Financeiro › Bancos e conciliação › "Enviar extrato"
 * (lib/finance/extrato-carga.ts): lê o arquivo (OFX de qualquer banco, planilha
 * .xlsx do Santander ou PDF do Itaú), confere os saldos, classifica cada
 * lançamento (CPF sai do texto), casa as saídas com as baixas do contas a pagar
 * que ainda não têm conta e grava em lotes. Reexecutável: a chave de cada
 * lançamento é estável, e o que já entrou é pulado.
 *
 * O extrato tem folha e pagamentos a pessoas: NÃO o coloque no repositório nem
 * envie nada dele a serviço externo. O relatório da simulação também é local.
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/import-extrato-ofx.mjs --file "~/Desktop/extrato.ofx" --url http://<supabase>
 *   node scripts/import-extrato-ofx.mjs --file … --url … --apply
 * Opções: --out <pasta> (relatório; padrão: ao lado do arquivo, modo 0600)
 * Requer SUPABASE_SERVICE_ROLE_KEY (.env.local).
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { ROTULO_CATEGORIA } from "../lib/finance/extrato-classificar.ts";
import { NAO_E_PAGAMENTO, buscarBaixasLivres, casarComBaixas, chavesJaImportadas, conferirSaldos, contaDoExtrato, lerExtratoDoArquivo, montarLotes, prepararLancamentos, resumoPorCategoria } from "../lib/finance/extrato-carga.ts";

const envPath = resolve(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (process.env[key] === undefined) env[key] = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};
const apply = args.includes("--apply");
const file = getArg("--file")?.replace(/^~/, homedir());
if (!file || !existsSync(file)) {
  console.error("Informe o extrato: --file <caminho>");
  process.exit(1);
}
const outDir = resolve(getArg("--out")?.replace(/^~/, homedir()) ?? dirname(file));
const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// --- 1. Leitura e conferência ------------------------------------------------------
const extrato = await lerExtratoDoArquivo(new Uint8Array(readFileSync(file)));
const conf = conferirSaldos(extrato);
const conta = contaDoExtrato(extrato);
console.log(`\nExtrato ${extrato.nomeBanco} (${extrato.formato}) · ag. ${conta.branch} conta ${conta.account_number}${conta.account_digit ? "-" + conta.account_digit : ""} · ${extrato.lancamentos.length} lançamentos · ${extrato.inicio} a ${extrato.fim}`);
console.log(`Saldos do dia conferidos: ${conf.dias} · divergentes: ${conf.divergentes.length}${extrato.saldoCorridoDivergente ? ` · saldo corrido com erro: ${extrato.saldoCorridoDivergente}` : ""}`);
if (conf.divergentes.length || extrato.saldoCorridoDivergente) {
  console.error("\nA leitura NÃO fecha com os saldos do banco. Nada será gravado.");
  conf.divergentes.slice(0, 20).forEach((d) => console.error(`  - ${d.data}: banco ${brl(d.esperado)} · calculado ${brl(d.calculado)}`));
  process.exit(1);
}
for (const a of extrato.avisos ?? []) console.log(`AVISO: ${a}`);
const dif = extrato.saldoFinal === null ? 0 : extrato.saldoFinal - conf.saldoCalculado;
console.log(`Saldo final: calculado ${brl(conf.saldoCalculado)}${extrato.saldoFinal === null ? "" : ` · informado ${brl(extrato.saldoFinal)}`}${dif ? ` (diferença do próprio banco: ${brl(dif)})` : ""}`);

// --- 2. Classificação e conciliação ---------------------------------------------------
const lancamentos = prepararLancamentos(extrato);
const url = getArg("--url") ?? env.SUPABASE_INTERNAL_URL ?? env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam a URL do Supabase (--url) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const { existentes } = await chavesJaImportadas(supabase, conta, lancamentos.map((l) => l.externalId));
const novos = lancamentos.filter((l) => !existentes.has(l.externalId));
console.log(`Já importados: ${existentes.size} · novos: ${novos.length}`);
const baixas = await buscarBaixasLivres(supabase, extrato.inicio, extrato.fim);
// Só os lançamentos novos procuram baixa (o que já estava no banco não é mexido).
const resultado = casarComBaixas(novos, baixas);
const porId = new Map(lancamentos.map((l) => [l.id, l]));
const saidas = lancamentos.filter((l) => l.centavos < 0 && !NAO_E_PAGAMENTO.has(l.categoria));
const valorSaidas = saidas.reduce((s, l) => s - l.centavos, 0);
const valorCasado = resultado.vinculos.reduce((s, v) => s - porId.get(v.entradaId).centavos, 0);
const niveis = { 1: 0, 2: 0, 3: 0 };
for (const v of resultado.vinculos) niveis[v.nivel]++;

console.log(`\n=== Lançamentos por categoria ===`);
for (const r of resumoPorCategoria(lancamentos)) console.log(`  ${String(r.quantidade).padStart(5)}  ${ROTULO_CATEGORIA[r.categoria].padEnd(36)} entradas ${brl(r.entradas).padStart(18)}  saídas ${brl(r.saidas).padStart(18)}`);
console.log(`\n=== Conciliação das saídas (${saidas.length} lançamentos, ${brl(valorSaidas)}; ${baixas.length} baixas livres na janela) ===`);
console.log(`  Conciliadas: ${resultado.vinculos.length} · ${brl(valorCasado)} — nível 1: ${niveis[1]} · nível 2: ${niveis[2]} · nível 3: ${niveis[3]}`);
console.log(`  Sem baixa correspondente: ${resultado.entradasSemVinculo.length} · lotes grandes demais para testar a soma: ${resultado.lotesGrandesIgnorados}`);

// --- 3. Relatório local -------------------------------------------------------------
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const vinc = new Map(resultado.vinculos.map((v) => [v.entradaId, v]));
const linhasCsv = [["data", "valor", "categoria", "descricao", "contraparte", "situacao", "nivel", "baixas"].join(";")];
for (const l of lancamentos) {
  const v = vinc.get(l.id);
  linhasCsv.push([l.data, (l.centavos / 100).toFixed(2).replace(".", ","), ROTULO_CATEGORIA[l.categoria], l.descricao, l.contraparte ?? "", v ? "conciliado" : "sem vínculo", v?.nivel ?? "", v ? v.baixaIds.length : ""].map(csv).join(";"));
}
const relatorio = resolve(outDir, `conciliacao-${basename(file).replace(/\.\w+$/, "").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.csv`);
writeFileSync(relatorio, linhasCsv.join("\n"), { mode: 0o600 });
console.log(`\nRelatório (local, não vai ao Git): ${relatorio}`);
if (!apply) {
  console.log("\nSimulação: nada foi gravado. Rode com --apply depois de conferir o relatório.");
  process.exit(0);
}

// --- 4. Gravação ----------------------------------------------------------------------
const { data: org, error: orgError } = await supabase.from("organizations").select("id").limit(1).single();
if (orgError) {
  console.error("Organização não encontrada:", orgError.message);
  process.exit(1);
}
const lotes = montarLotes(lancamentos, resultado, baixas, extrato.formato, existentes);
let inseridos = 0, ignorados = 0, vinculados = 0;
for (const [i, lote] of lotes.entries()) {
  const ultimo = i === lotes.length - 1;
  const resumo = ultimo ? { arquivo: basename(file), lancamentos: lancamentos.length, inicio: extrato.inicio, fim: extrato.fim, conciliados: resultado.vinculos.length } : null;
  const { data: r, error } = await supabase.rpc("finance_import_bank_entries", { p_org: org.id, p_account: conta, p_entries: lote.entries, p_links: lote.links, p_summary: resumo });
  if (error) {
    console.error(`\nFalha no lote ${i + 1}: ${error.message}\nOs lotes anteriores ficaram gravados; rode de novo para continuar.`);
    process.exit(1);
  }
  inseridos += r.inserted; ignorados += r.skipped; vinculados += r.linked;
  console.log(`  lote ${i + 1}: ${r.inserted} gravados · ${r.skipped} já existiam · ${r.linked} conciliados`);
}
console.log(`\nConcluído: ${inseridos} lançamentos gravados · ${ignorados} já existiam · ${vinculados} conciliações.`);
