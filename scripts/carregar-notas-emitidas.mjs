#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Carga de XMLs de notas EMITIDAS (GRV) de um mês, por pasta
 *
 * O mesmo caminho do campo Fiscal › Notas emitidas › "Enviar notas do mês", para quando os arquivos estão
 * no computador de quem opera a plataforma: classifica cada arquivo (lib/fiscal/emitidas-envio.ts), não guarda
 * o que já está na plataforma (mesmo arquivo ou mesma chave), nem nota de outro mês ou de outra empresa, e
 * guarda o resto em Documentos › Fiscal ligado ao mês, com a leitura na hora (IBS/CBS, receita do Presumido).
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/carregar-notas-emitidas.mjs --pasta ~/Downloads --mes 2026-01 \
 *     [--filtro '^46839106000184_'] [--autor "Proprietário (carga de jan/2026)"] [--apply]
 * Requer SUPABASE_SERVICE_ROLE_KEY e SUPABASE_INTERNAL_URL (ou NEXT_PUBLIC_SUPABASE_URL).
 * ============================================================================
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i === -1) continue;
    const key = t.slice(0, i).trim();
    if (process.env[key] === undefined) process.env[key] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const args = process.argv.slice(2);
const arg = (nome) => { const i = args.indexOf(nome); return i !== -1 ? args[i + 1] : null; };
const apply = args.includes("--apply");
const pasta = (arg("--pasta") ?? "").replace(/^~/, homedir());
const mes = arg("--mes") ?? "";
const filtro = new RegExp(arg("--filtro") ?? ".", "i");
const autor = arg("--autor") ?? "Carga de notas emitidas";
if (!pasta || !existsSync(pasta) || !/^\d{4}-\d{2}$/.test(mes)) {
  console.error("Informe --pasta <pasta com os XML> e --mes AAAA-MM.");
  process.exit(2);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error("Defina SUPABASE_SERVICE_ROLE_KEY e SUPABASE_INTERNAL_URL.");
  process.exit(2);
}

// "server-only" só existe dentro do Next: aqui vira um módulo vazio.
const { registerHooks } = await import("node:module");
registerHooks({ resolve: (specifier, context, next) => (specifier === "server-only" ? { url: "data:text/javascript,", shortCircuit: true } : next(specifier, context)) });
await import("../tests/ts-resolver.mjs");
const { createClient } = await import("@supabase/supabase-js");
const { classificarEnvio, lacunasDaNumeracao, lerEventoNfe, lerNfeEmitida, numeroDaChave, rotuloMes } = await import("../lib/fiscal/emitidas-envio.ts");
const { guardarOriginalSistema, sha256 } = await import("../lib/documentos/guardar.ts");

const admin = createClient(process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: cfgs } = await admin.from("fiscal_config").select("organization_id, cnpj");
if ((cfgs ?? []).length !== 1) { console.error(`Esperava uma empresa com o Fiscal configurado, achei ${(cfgs ?? []).length}. Nada foi feito.`); process.exit(1); }
const org = cfgs[0].organization_id;
const cnpj = String(cfgs[0].cnpj ?? "").replace(/\D/g, "");

const nomes = readdirSync(pasta).filter((f) => /\.xml$/i.test(f) && filtro.test(f)).sort();
const lidos = nomes.map((nome) => {
  const dados = new Uint8Array(readFileSync(join(pasta, nome)));
  const xml = new TextDecoder("utf-8").decode(dados);
  return { nome, dados, lido: lerNfeEmitida(nome, xml, cnpj) ?? lerEventoNfe(nome, xml) ?? { nome, tipo: "erro", erro: "Não é XML de NF-e nem evento da NF-e." } };
});
const chaves = [...new Set(lidos.flatMap(({ lido }) => (lido.tipo === "nfe" && lido.chave ? [lido.chave] : [])))];
const hashes = lidos.map(({ dados }) => sha256(dados));
const [{ data: ja }, { data: emitidas }, { data: iguais }] = await Promise.all([
  admin.from("fiscal_ibscbs_notas").select("chave").eq("organization_id", org).in("chave", chaves.length ? chaves : ["-"]).is("repetida_de", null),
  admin.from("fiscal_nfe").select("chave").eq("organization_id", org).eq("ambiente", "producao").eq("situacao", "autorizada").in("chave", chaves.length ? chaves : ["-"]),
  admin.from("company_documents").select("sha256").eq("organization_id", org).eq("module_code", "fiscal").in("sha256", hashes).is("superseded_by", null).is("archived_at", null),
]);
const jaNaPlataforma = new Set([...(ja ?? []), ...(emitidas ?? [])].map((x) => String(x.chave)));
const guardados = new Set((iguais ?? []).map((x) => String(x.sha256)));
const linhas = classificarEnvio(lidos.map((l) => l.lido), { mes, cnpjEmpresa: cnpj, jaNaPlataforma, arquivoJaGuardado: hashes.map((h) => guardados.has(h)) });

console.log(`${apply ? "GRAVANDO" : "SIMULAÇÃO (use --apply para gravar)"} · ${rotuloMes(mes)} · ${nomes.length} arquivos de ${pasta}\n`);
const conta = {};
for (const l of linhas) { const k = `${l.situacao}${l.natureza ? ` (${l.natureza})` : ""}`; conta[k] = (conta[k] ?? 0) + 1; }
for (const [k, v] of Object.entries(conta)) console.log(`  ${String(v).padStart(3)}  ${k}`);
for (const l of linhas.filter((x) => !x.entra)) console.log(`  não entra: ${l.arquivo} — ${l.nota}`);
const nf = lidos.filter((x, i) => linhas[i].entra && x.lido.tipo === "nfe").map((x) => x.lido.numero);
const lac = lacunasDaNumeracao(nf, linhas.filter((l) => l.situacao === "evento").map((l) => l.numero));
console.log(`\nEntram: ${linhas.filter((l) => l.entra).length}. Números que faltam: ${lac.map((x) => `${x.numero}${x.soEvento ? " (só o evento)" : ""}`).join(", ") || "nenhum"}`);
if (!apply) process.exit(0);

let guardadas = 0, existentes = 0;
const falhas = [];
for (let i = 0; i < lidos.length; i++) {
  if (!linhas[i].entra) continue;
  const { nome, dados, lido } = lidos[i];
  const numero = linhas[i].numero ?? (lido.tipo === "evento" ? numeroDaChave(lido.chave) : null);
  const titulo = lido.tipo === "evento"
    ? `${lido.evento === "110110" ? "Carta de correção" : "Evento"} da NF ${numero ?? "?"} (${rotuloMes(mes)})`
    : `NF ${numero ?? "?"}${linhas[i].destinatario ? ` · ${linhas[i].destinatario}` : ""} (XML)`;
  try {
    const r = await guardarOriginalSistema(admin, org, {
      modulo: "fiscal", feature: "fiscal.nfe", origem: "emissao", autor, titulo: titulo.slice(0, 200),
      entidade: { tipo: "fiscal_emitidas_mes", id: mes }, arquivo: { nome, tipo: "text/xml", dados },
    });
    if (r.existente) existentes++; else guardadas++;
  } catch (e) {
    falhas.push(`${nome}: ${e instanceof Error ? e.message : e}`);
  }
}
const { data: depois } = await admin.from("fiscal_ibscbs_notas").select("lado, repetida_de").eq("organization_id", org).eq("competencia", mes).eq("emitente_cnpj", cnpj);
console.log(`\nGravado: ${guardadas} guardados, ${existentes} já existiam, ${falhas.length} falhas.${falhas.length ? `\n  ${falhas.join("\n  ")}` : ""}`);
console.log(`Leituras da empresa em ${mes}: ${(depois ?? []).filter((x) => !x.repetida_de).length} valendo (${(depois ?? []).filter((x) => !x.repetida_de && x.lado === "saida").length} saídas, ${(depois ?? []).filter((x) => !x.repetida_de && x.lado === "entrada").length} entradas), ${(depois ?? []).filter((x) => x.repetida_de).length} repetidas.`);
