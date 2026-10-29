#!/usr/bin/env node
/**
 * ============================================================================
 * Pecsil Business OS — Correção pontual de NF-e repetida (29/10/2026)
 *
 * A NF 11170 (saída, out/2026, R$ 51.500,00) foi anexada DUAS vezes no Portal do escritório (29/10, 10h06,
 * o mesmo arquivo com 9 s de diferença): virou dois documentos em Documentos › Fiscal e duas leituras
 * (IBS/CBS e receita do Presumido; conferência de entradas). Fica o primeiro documento; o segundo é apagado,
 * com o que depende dele (leituras, texto, ligações, o anexo repetido no portal) e o arquivo no armazenamento.
 *
 * A NF 1079 (White Martins) também aparece duas vezes, mas são dois documentos legítimos (Fiscal e recebimento
 * do Almoxarifado): a migração 202610290005 já marcou a leitura do Almoxarifado como repetida. Nada a apagar.
 *
 * Confere o banco antes (diferente do esperado = nada é feito), guarda cópia do que sai, faz numa transação e
 * registra na Auditoria (fiscal.nota.repetida_removida).
 *
 * Uso (simulação por padrão; nada é gravado sem --apply):
 *   node scripts/corrigir-fiscal-repetidas-29-10.mjs [--url http://host:8000] [--backup arquivo.json]
 *   node scripts/corrigir-fiscal-repetidas-29-10.mjs --apply --backup arquivo.json
 * Requer SUPABASE_SERVICE_ROLE_KEY e a migração 202610290005 aplicada. Usa /pg/query e o armazenamento.
 * ============================================================================
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i === -1) continue;
    const key = t.slice(0, i).trim();
    if (process.env[key] === undefined) env[key] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const arg = (nome) => { const i = args.indexOf(nome); return i !== -1 ? args[i + 1] : null; };
const base = (arg("--url") || env.SUPABASE_INTERNAL_URL || "").replace(/\/$/, "");
const backup = arg("--backup");
if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Defina a URL do Supabase (--url ou SUPABASE_INTERNAL_URL) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
if (apply && !backup) { console.error("Com --apply, informe --backup <arquivo.json> para guardar a cópia do que sai."); process.exit(2); }
const cabecalho = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

async function sql(query) {
  const r = await fetch(`${base}/pg/query`, { method: "POST", headers: { ...cabecalho, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`/pg/query ${r.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const CHAVE = "35261046839106000184550010000111701000132765";
const FICA = "ead85314-f63b-4f36-b54b-0e1ff07766c2"; // anexado às 10h06m05
const SAI = "12741ca3-294c-4701-a079-6e565691e2d8"; // o mesmo arquivo, às 10h06m14

const docs = await sql(`select id, module_code, feature_code, original_name, sha256, storage_path, created_at::text, archived_at, uploaded_by_name
  from public.company_documents where id in (${q(FICA)}, ${q(SAI)}) order by created_at`);
const leituras = await sql(`select id, document_id, repetida_de, lado, competencia, v_nf from public.fiscal_ibscbs_notas where chave = ${q(CHAVE)} order by lido_em`);
const entradas = await sql(`select id, document_id, repetida_de, situacao from public.fiscal_entradas where chave = ${q(CHAVE)}`);
const anexos = await sql(`select id, document_id, competencia_id, nome, enviado_por_nome, created_at::text from public.fiscal_portal_anexos where document_id in (${q(FICA)}, ${q(SAI)})`);

const fica = docs.find((d) => d.id === FICA);
const sai = docs.find((d) => d.id === SAI);
const leituraFica = leituras.find((l) => l.document_id === FICA);
const leituraSai = leituras.find((l) => l.document_id === SAI);
const confere = [
  ["os dois documentos existem, ativos, no Fiscal", fica && sai && !fica.archived_at && !sai.archived_at && fica.module_code === "fiscal" && sai.module_code === "fiscal"],
  ["são o mesmo arquivo (sha256)", fica && sai && fica.sha256 === sai.sha256],
  ["o que fica foi guardado antes", fica && sai && fica.created_at < sai.created_at],
  ["2 leituras da nota: a do que fica vale, a do que sai é repetida", leituras.length === 2 && leituraFica && !leituraFica.repetida_de && leituraSai?.repetida_de === leituraFica?.id],
  ["conferência de entradas: 2 leituras", entradas.length === 2],
  ["2 anexos no portal, um de cada documento", anexos.length === 2 && anexos.some((a) => a.document_id === SAI)],
];
console.log(`${apply ? "GRAVANDO" : "SIMULAÇÃO (use --apply para gravar)"}\n`);
for (const [o, ok] of confere) console.log(`${ok ? "✔" : "✖"} ${o}`);
console.log(`\nFica: ${FICA} (${fica?.original_name}, ${fica?.created_at}, ${fica?.uploaded_by_name})`);
console.log(`Sai:  ${SAI} (${sai?.created_at}) + leitura ${leituraSai?.id} + anexo ${anexos.find((a) => a.document_id === SAI)?.id} + arquivo ${sai?.storage_path}`);
if (confere.some(([, ok]) => !ok)) { console.error("\nO banco não está como o esperado. Nada foi feito."); process.exit(1); }

const repetidasValendo = async () => (await sql(`select count(*)::int n from (select organization_id, chave from public.fiscal_ibscbs_notas where chave is not null and repetida_de is null group by 1, 2 having count(*) > 1) x`))[0].n;
const receitaOut = async () => (await sql(`select coalesce(sum((receita->'porCfop'->>'6101')::numeric), 0)::text v from public.fiscal_ibscbs_notas where competencia = '2026-10' and lado = 'saida'`))[0].v;
console.log(`\nAntes: venda 6101 de out/2026 somando todas as linhas = R$ ${await receitaOut()}`);
if (!apply) process.exit(0);

// Cópia do que sai (o documento e tudo o que é apagado junto).
const copia = {
  feito_em: new Date().toISOString(), documento: sai,
  leitura: await sql(`select * from public.fiscal_ibscbs_notas where document_id = ${q(SAI)}`),
  entrada: await sql(`select * from public.fiscal_entradas where document_id = ${q(SAI)}`),
  anexo: await sql(`select * from public.fiscal_portal_anexos where document_id = ${q(SAI)}`),
  texto: await sql(`select document_id, length(content) tamanho from public.company_document_texts where document_id = ${q(SAI)}`).catch(() => []),
};
writeFileSync(backup, JSON.stringify(copia, null, 2));
console.log(`Cópia guardada em ${backup}`);

await sql(`begin;
delete from public.company_documents where id = ${q(SAI)} and sha256 = ${q(fica.sha256)} and created_at > ${q(fica.created_at)}::timestamptz;
insert into public.audit_logs (organization_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
select organization_id, 'fiscal', 'fiscal.nota.repetida_removida', 'company_documents', ${q(SAI)}::uuid, 'medium',
  jsonb_build_object('chave', ${q(CHAVE)}, 'numero', '11170', 'documento_que_fica', ${q(FICA)},
    'motivo', 'O mesmo arquivo anexado duas vezes no Portal do escritório (29/10, 10h06); a nota contava em dobro. Correção pedida pelo proprietário.')
from public.company_documents where id = ${q(FICA)};
commit;`);
const { error: eArq } = await fetch(`${base}/storage/v1/object/empresa-documentos`, {
  method: "DELETE", headers: { ...cabecalho, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [sai.storage_path] }),
}).then(async (r) => ({ error: r.ok ? null : await r.text() }));
console.log(eArq ? `Arquivo duplicado NÃO saiu do armazenamento: ${eArq}` : "Arquivo duplicado apagado do armazenamento.");

const depois = await sql(`select (select count(*)::int from public.fiscal_ibscbs_notas where chave = ${q(CHAVE)}) leituras,
  (select count(*)::int from public.fiscal_entradas where chave = ${q(CHAVE)}) entradas,
  (select count(*)::int from public.fiscal_portal_anexos where document_id in (${q(FICA)}, ${q(SAI)})) anexos,
  (select count(*)::int from public.company_documents where id = ${q(SAI)}) documento`);
console.log(`\nGravado. NF 11170: ${depois[0].leituras} leitura, ${depois[0].entradas} na conferência, ${depois[0].anexos} anexo, documento repetido ${depois[0].documento ? "AINDA EXISTE" : "apagado"}.`);
console.log(`Notas com duas leituras valendo: ${await repetidasValendo()}. Venda 6101 de out/2026 somando todas as linhas = R$ ${await receitaOut()}`);
