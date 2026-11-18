#!/usr/bin/env node
/**
 * Espelho do GRV (docs/PLANO-VIRADA-FISCAL.md, trava 1): cada NF-e autorizada da pasta é refeita pela plataforma e
 * comparada campo a campo. Só lê os arquivos; nada é gravado nem enviado. As notas reais ficam FORA do repositório.
 *
 *   node scripts/fiscal-espelho.mjs <pasta-com-xml> [--detalhe] [--esquema]
 *
 * --detalhe  lista cada diferença de cada nota
 * --esquema  confere também o XML da plataforma no esquema oficial (biblioteca do transmissor, sem certificado)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import "../tests/ts-resolver.mjs";

const { espelhar } = await import("../lib/fiscal/emissao/espelho.ts");
const { assinaturaDeTreino } = await import("../lib/fiscal/emissao/xml.ts");

const [pasta, ...opcoes] = process.argv.slice(2);
if (!pasta) { console.error("Uso: node scripts/fiscal-espelho.mjs <pasta-com-xml> [--detalhe] [--esquema]"); process.exit(1); }
const detalhe = opcoes.includes("--detalhe");
let validar = null;
if (opcoes.includes("--esquema")) {
  for (const nivel of ["error", "warn", "log", "info", "debug"]) { const o = console[nivel].bind(console); console[nivel] = (...a) => { if (typeof a[0] === "string" && a[0].startsWith("[winston]")) return; o(...a); }; }
  const { NFE_SchemaValidate } = await import("../services/transmissor-nfe/node_modules/nfewizard-io/dist/index.mjs");
  validar = async (xml) => { try { return await NFE_SchemaValidate(xml, "NFeAutorizacao", { validator: "validateSchemaJsBased" }); } catch (e) { return e && typeof e === "object" && "errors" in e ? e : { success: false, errors: [{ message: String(e?.message ?? e) }] }; } };
}

const arquivos = readdirSync(pasta).filter((n) => /\.xml$/i.test(n) && !/-cce\.xml$/i.test(n)).sort();
const porCaminho = new Map();
const porNota = [];
const motivos = new Map();
let iguais = 0;
for (const nome of arquivos) {
  const xml = readFileSync(join(pasta, nome), "utf8");
  if (!/<infNFe[\s>]/.test(xml)) continue;
  let r;
  try { r = espelhar(xml); } catch (e) { porNota.push({ nome, erro: e.message }); continue; }
  const cfops = [...new Set(r.lida.nota.itens.map((i) => i.cfop))].join(",");
  const esquema = validar ? await validar(r.xmlNosso.replace("</infNFe></NFe>", `</infNFe>${assinaturaDeTreino(r.lida.chave)}</NFe>`)) : null;
  const reprovadas = r.vereditos.filter((v) => !v.aceita).map((v) => v.diferenca);
  porNota.push({ nome, numero: r.lida.numero, cfops, difs: reprovadas.length, aceitas: r.vereditos.length - reprovadas.length, esquema: esquema ? (esquema.success ? "ok" : (esquema.errors ?? []).slice(0, 3).map((x) => x.humanized ?? x.message ?? x.raw).join(" | ")) : "" });
  if (r.bate) iguais++;
  for (const v of r.vereditos) if (v.aceita) motivos.set(v.motivo, (motivos.get(v.motivo) ?? 0) + 1);
  for (const d of reprovadas) {
    const chave = d.caminho.replace(/\[\d+\]/g, "[*]");
    const g = porCaminho.get(chave) ?? { notas: new Set(), exemplos: [] };
    g.notas.add(r.lida.numero);
    if (g.exemplos.length < 3) g.exemplos.push(`${r.lida.numero}: nosso=${JSON.stringify(d.nosso)} deles=${JSON.stringify(d.deles)}`);
    porCaminho.set(chave, g);
  }
  if (detalhe && r.diferencas.length) {
    console.log(`\n== ${nome} (nº ${r.lida.numero}, CFOP ${cfops}) — ${reprovadas.length} reprovada(s), ${r.vereditos.length - reprovadas.length} aceita(s)`);
    for (const v of r.vereditos) console.log(`  ${v.aceita ? "aceita " : "REPROVA"} ${v.diferenca.caminho}: nosso=${JSON.stringify(v.diferenca.nosso)} deles=${JSON.stringify(v.diferenca.deles)}`);
  }
}

const esquemaRuim = porNota.filter((n) => n.esquema && n.esquema !== "ok").length;
console.log(`\nNotas: ${porNota.length} · batem: ${iguais} · reprovadas: ${porNota.filter((n) => n.difs).length} · com erro: ${porNota.filter((n) => n.erro).length}${validar ? ` · fora do esquema: ${esquemaRuim}` : ""}`);
console.log("\nPor nota:");
for (const n of porNota) console.log(`  ${n.nome}: ${n.erro ? `ERRO ${n.erro}` : `CFOP ${n.cfops} · ${n.difs ? `${n.difs} REPROVADA(S)` : "bate"} · ${n.aceitas} aceita(s)${n.esquema ? ` · esquema: ${n.esquema}` : ""}`}`);
console.log("\nDiferenças aceitas (quantas vezes) e o motivo:");
for (const [m, q] of [...motivos].sort((a, b) => b[1] - a[1])) console.log(`  ${String(q).padStart(4)}  ${m}`);
console.log("\nDiferenças que reprovam (quantas notas):");
for (const [k, g] of [...porCaminho].sort((a, b) => b[1].notas.size - a[1].notas.size || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(g.notas.size).padStart(3)}  ${k}`);
  for (const e of g.exemplos) console.log(`         ${e.slice(0, 220)}`);
}
