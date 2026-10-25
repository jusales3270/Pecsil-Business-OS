import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { vigente, atuais, historico, problemasDaNovaVigencia } = await import("../lib/contabil/parametros.ts");
const { inssSegurado, irrfMensal } = await import("../lib/contabil/folha.ts");

// A semente de 2026 (a mesma que a migração carrega), como o banco devolve as linhas.
const semente = JSON.parse(readFileSync(new URL("../docs/contabil/parametros-2026.json", import.meta.url), "utf8"));
const linhas = semente.parametros.map((p) => ({ id: `${p.chave}:${p.vigente_de}`, codigo_municipio: null, uf: null, observacao: null, ...p }));
const valor = (chave) => linhas.find((p) => p.chave === chave).valor;
const conferido = (rows) => rows.map((p) => ({ ...p, situacao: "conferido" }));

test("a semente: toda linha tem título, fonte com link, confiança e entra como rascunho", () => {
  assert.equal(linhas.length, 34);
  for (const p of linhas) {
    assert.ok(p.titulo, `${p.chave} sem título`);
    assert.match(p.fonte.url, /^https?:\/\//, `${p.chave} sem link`);
    assert.ok(p.fonte.norma.length > 5, `${p.chave} sem norma`);
    assert.ok(["alta", "media", "baixa"].includes(p.confianca), `${p.chave} sem confiança`);
    assert.equal(p.situacao, "rascunho");
    assert.match(p.vigente_de, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(new Set(linhas.map((p) => p.chave)).size, linhas.length, "chave repetida");
});

// O pacote "57 Agents Contabilidade" errava estes pontos (PLANO-CONTABIL-FISCAL §1).
test("os erros do pacote não se repetem na semente", () => {
  assert.equal(valor("salario_minimo").mensal, 1621, "salário mínimo 2026 é R$ 1.621");
  assert.equal(valor("inss_segurado_tabela").teto_salario_contribuicao, 8475.55, "teto do INSS 2026");
  assert.match(valor("prazo_dctfweb").prazo, /último dia útil/, "DCTFWeb vence no último dia útil");
  assert.match(valor("fgts").vencimento_mensal, /dia 20/, "FGTS Digital vence no dia 20");
  assert.equal(valor("retencao_csrf_tomador_pj").dispensa_ate, 10, "dispensa de CSRF: DARF até R$ 10");
  assert.equal(valor("retencao_irrf_tomador_pj").dispensa_ate, 10);
  assert.match(valor("codigos_darf")["8301"], /folha/, "8301 é PIS sobre folha");
  assert.match(valor("codigos_darf")["6912"], /não cumulativo/);
  assert.match(valor("gia_sp").situacao, /dispensada/, "GIA-SP dispensada desde 2026");
  assert.equal(valor("pis_cofins_aliquotas").extincao.slice(0, 10), "2027-01-01", "PIS e COFINS acabam juntos em 2027");
  assert.ok(valor("irrf_reducao_lei_15270").isencao_ate === 5000, "redução da Lei 15.270 presente");
});

const P = (extra) => ({ id: extra.id ?? "x", chave: "k", titulo: "K", escopo: "legal", uf: null, codigo_municipio: null, valor: 1, vigente_de: "2026-01-01", vigente_ate: null, fonte: { norma: "Lei", url: "https://x" }, confianca: "alta", observacao: null, situacao: "conferido", ...extra });

test("precedência: exceção da empresa > município > UF > legal", () => {
  const rows = [P({ id: "l", valor: "legal" }), P({ id: "u", escopo: "uf", uf: "SP", valor: "uf" }), P({ id: "m", escopo: "municipio", codigo_municipio: "3550308", valor: "mun" })];
  assert.equal(vigente(rows, "k", "2026-05-01").valor, "legal");
  assert.equal(vigente(rows, "k", "2026-05-01", { uf: "SP" }).valor, "uf");
  assert.equal(vigente(rows, "k", "2026-05-01", { uf: "RJ" }).valor, "legal");
  assert.equal(vigente(rows, "k", "2026-05-01", { uf: "SP", codigoMunicipio: "3550308" }).valor, "mun");
  const exc = [{ id: "e", chave: "k", valor: "empresa", vigente_de: "2026-03-01", vigente_ate: null, motivo: "liminar" }];
  const v = vigente(rows, "k", "2026-05-01", { uf: "SP" }, exc);
  assert.equal(v.valor, "empresa");
  assert.equal(v.camada, "excecao");
  assert.equal(vigente(rows, "k", "2026-02-01", { uf: "SP" }, exc).valor, "uf", "exceção só no período dela");
});

test("vigência pela data do fato gerador; conferido vence rascunho; descartado nunca entra", () => {
  const rows = [
    P({ id: "a", valor: 1, vigente_de: "2025-01-01", vigente_ate: "2025-12-31" }),
    P({ id: "b", valor: 2, vigente_de: "2026-01-01" }),
    P({ id: "c", valor: 3, vigente_de: "2026-06-01", situacao: "rascunho" }),
    P({ id: "d", valor: 4, vigente_de: "2026-07-01", situacao: "descartado" }),
  ];
  assert.equal(vigente(rows, "k", "2025-08-10").valor, 1);
  assert.equal(vigente(rows, "k", "2026-03-10").valor, 2);
  const julho = vigente(rows, "k", "2026-07-10");
  assert.equal(julho.valor, 2, "o rascunho não passa na frente do conferido");
  assert.equal(julho.aConferir, false);
  assert.equal(vigente(rows, "k", "2024-01-01"), null);
  const soRascunho = vigente([P({ situacao: "rascunho", valor: 9 })], "k", "2026-02-02");
  assert.equal(soRascunho.valor, 9);
  assert.equal(soRascunho.aConferir, true, "sem conferido, usa o rascunho e avisa");
  assert.deepEqual(historico(rows, "k").map((r) => r.id), ["d", "c", "b", "a"]);
  assert.deepEqual(atuais(rows, "2026-03-10").map((r) => r.id), ["b"]);
});

test("INSS 2026: progressivo por faixa e limitado ao teto", () => {
  const rows = conferido(linhas);
  assert.equal(inssSegurado(rows, "2026-10-01", 8475.55).resultado.inss, 988.09);
  assert.equal(inssSegurado(rows, "2026-10-01", 20000).resultado.inss, 988.09, "acima do teto não muda");
  assert.equal(inssSegurado(rows, "2026-10-01", 3000).resultado.inss, 248.6);
  assert.equal(inssSegurado(rows, "2026-10-01", 1621).resultado.inss, 121.58);
  const r = inssSegurado(rows, "2026-10-01", 3000);
  assert.ok(r.memoria.length >= 4, "memória de cálculo por faixa");
  assert.equal(r.aConferir.length, 0);
});

test("IRRF 2026: até R$ 5 mil zera pela Lei 15.270; na faixa parcial reduz; acima de R$ 7.350 não", () => {
  const rows = conferido(linhas);
  const cinco = irrfMensal(rows, "2026-10-01", { rendimentoTributavel: 5000, inss: 501.51 });
  assert.equal(cinco.resultado.imposto, 0);
  assert.equal(cinco.resultado.modelo, "simplificado");
  const seis = irrfMensal(rows, "2026-10-01", { rendimentoTributavel: 6000, inss: 641.51 });
  assert.equal(seis.resultado.modelo, "deducoes");
  assert.equal(seis.resultado.reducao, 179.75);
  assert.equal(seis.resultado.imposto, 385.1);
  const oito = irrfMensal(rows, "2026-10-01", { rendimentoTributavel: 8000, inss: 908.86 });
  assert.equal(oito.resultado.reducao, 0);
  assert.equal(oito.resultado.imposto, oito.resultado.impostoDaTabela);
});

test("IRRF antes de 2026 não aplica a redução; parâmetro em rascunho vem marcado para conferir", () => {
  const dez25 = irrfMensal(conferido(linhas), "2025-12-15", { rendimentoTributavel: 5000, inss: 0 });
  assert.equal(dez25.resultado.reducao, 0);
  assert.ok(dez25.resultado.imposto > 0, "em 2025 ainda havia imposto em R$ 5 mil");
  const rascunho = irrfMensal(linhas, "2026-10-01", { rendimentoTributavel: 6000, inss: 641.51 });
  assert.deepEqual(rascunho.aConferir.map((v) => v.chave).sort(), ["irrf_reducao_lei_15270", "irrf_tabela_mensal"]);
});

test("nova vigência: valida o que chega da tela", () => {
  const ok = { chave: "salario_minimo", escopo: "legal", vigente_de: "2027-01-01", norma: "Decreto 99.999/2026", url: "https://www.in.gov.br/x", confianca: "alta", valor: { mensal: 1700 } };
  assert.deepEqual(problemasDaNovaVigencia(ok), []);
  assert.ok(problemasDaNovaVigencia({ ...ok, url: "sem link" }).includes("link da fonte obrigatório"));
  assert.ok(problemasDaNovaVigencia({ ...ok, escopo: "uf" }).includes("UF obrigatória"));
  assert.ok(problemasDaNovaVigencia({ ...ok, vigente_ate: "2026-01-01" }).includes("fim da vigência inválido"));
});
