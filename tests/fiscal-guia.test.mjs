import assert from "node:assert/strict";
import test from "node:test";
import { lerGuia, linhaDigitavelDe, tipoDaGuia, valorDoCodigo } from "../lib/fiscal/guia-parser.ts";

// Linha digitável de arrecadação com valor real (3º dígito 6) de R$ 1.234,56 nas posições 5–15.
// Barras (44): 8 1 6 X 00000123456 ... — os DVs de bloco não são conferidos pela leitura.
const barras = "8167" + "00000123456" + "0385" + "2026102" + "0".repeat(18);
assert.equal(barras.length, 44);
const blocos = [0, 1, 2, 3].map((i) => barras.slice(i * 11, i * 11 + 11) + "0");
const linha = blocos.join(" ");

test("guia: tipo pela cara do documento", () => {
  assert.equal(tipoDaGuia("Documento de Arrecadação de Receitas Federais - DARF"), "DARF");
  assert.equal(tipoDaGuia("DARF numerado DCTFWeb · Receita Federal"), "DCTFWeb");
  assert.equal(tipoDaGuia("Documento de Arrecadação do Simples Nacional"), "DAS");
  assert.equal(tipoDaGuia("GARE-ICMS Guia de Arrecadação Estadual"), "GARE");
  assert.equal(tipoDaGuia("Guia do FGTS Digital - GFD"), "FGTS");
  assert.equal(tipoDaGuia("nada aqui"), null);
});

test("guia: linha digitável e o valor dentro do código de barras", () => {
  assert.equal(linhaDigitavelDe(`Código de barras: ${linha}`)?.length, 48);
  assert.equal(valorDoCodigo(linhaDigitavelDe(linha)), 1234.56);
  assert.equal(linhaDigitavelDe("12345 67890"), null);
});

test("guia: lê valor, vencimento e competência do DARF", () => {
  const texto = `Documento de Arrecadação de Receitas Federais DARF
Período de Apuração 30/09/2026  Data de Vencimento 20/10/2026
Código da Receita 0561  Valor Total do Documento 1.234,56
${linha}`;
  const g = lerGuia(texto);
  assert.equal(g.tipo, "DARF");
  assert.equal(g.valor, 1234.56);
  assert.equal(g.vencimento, "2026-10-20");
  assert.equal(g.competencia, "2026-09");
  assert.equal(g.avisos.length, 0);
});

test("guia: avisa quando o texto e o código de barras discordam, e quando falta o vencimento", () => {
  const g = lerGuia(`Simples Nacional DAS  Valor Total do Documento 999,00 ${linha}`);
  assert.equal(g.tipo, "DAS");
  assert.ok(g.avisos.some((a) => /diferente do código de barras/.test(a)));
  assert.ok(g.avisos.some((a) => /vencimento/.test(a)));
  const s = lerGuia("Guia do FGTS Digital  Pagar até 07/11/2026  Valor a recolher 3.210,00  Competência 10/2026");
  assert.equal(s.tipo, "FGTS"); assert.equal(s.valor, 3210); assert.equal(s.vencimento, "2026-11-07"); assert.equal(s.competencia, "2026-10");
  assert.ok(s.avisos.some((a) => /linha digitável/.test(a)));
});

test("guia: vira conta a pagar em aprovação, com o aviso para quem aprova no Financeiro", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/migrations/202610170005_fiscal_guias.sql", import.meta.url), "utf8");
  const enviar = sql.slice(sql.indexOf("function public.fiscal_portal_guia_enviar"), sql.indexOf("function public.fiscal_portal_guia_cancelar"));
  assert.match(enviar, /public\.fiscal_portal_exigir\(\)/, "os dois lados do portal, com o termo aceito");
  assert.match(enviar, /'pending_approval', 'fiscal'/, "a conta nasce em aprovação");
  assert.match(enviar, /notify_feature\(org, 'financeiro\.pagar', 'aprovar'/, "avisa quem aprova contas a pagar, não o proprietário");
  assert.doesNotMatch(enviar, /is_owner\(\)/, "sem exceção do proprietário");
  const cancelar = sql.slice(sql.indexOf("function public.fiscal_portal_guia_cancelar"));
  assert.match(cancelar, /settled_amount > 0/, "guia paga não se cancela pelo portal");
  assert.match(cancelar, /cancelled_at = now\(\)/);
  assert.match(sql, /revoke all on public\.fiscal_guias from anon, authenticated/, "o escritório lê só pela função, nunca o Financeiro");
  const rota = readFileSync(new URL("../app/api/fiscal/portal/guia/route.ts", import.meta.url), "utf8");
  assert.match(rota, /remove\(\[caminho\]\)/, "se o registro falhar, o arquivo é apagado");
});

test("guia: valor digitado no formato brasileiro", async () => {
  const { valorDigitado } = await import("../lib/fiscal/guia-parser.ts");
  assert.equal(valorDigitado("1.234,56"), 1234.56);
  assert.equal(valorDigitado("1234,56"), 1234.56);
  assert.equal(valorDigitado("1234.56"), 1234.56);
  assert.equal(valorDigitado("R$ 12.345.678,90"), 12345678.9);
  assert.equal(valorDigitado("950"), 950);
  assert.equal(valorDigitado("1.234"), 1234);
  assert.equal(valorDigitado("1.23"), 1.23);
  assert.ok(Number.isNaN(valorDigitado("1.234.56")));
  assert.ok(Number.isNaN(valorDigitado("abc")));
});
