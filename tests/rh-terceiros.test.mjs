import assert from "node:assert/strict";
import test from "node:test";
import {
  contabilizar,
  diaDaSemana,
  formatarHoras,
  horaDoApontamento,
  limitesDoMes,
  minutosDaPassagem,
  montarRelatorio,
  naFabrica,
  saidaParaExibir,
} from "../lib/rh/terceiros-core.ts";

// Nomes fictícios. O formato da hora é o que a Portaria grava hoje. Os
// minutos são os que a Portaria calculou na saída (null = não calculou).
const ap = (id, nome, data, entrada, saida, minutos) => ({
  id, nome, data,
  entrada: `${data}T${entrada}:00+00:00`,
  saida: saida ? (saida.includes("T") ? saida : `${data}T${saida}:00+00:00`) : null,
  minutos: minutos === undefined ? null : minutos,
});

test("a hora vem do texto do apontamento, sem conversão de fuso", () => {
  assert.equal(horaDoApontamento("2026-08-24T08:37:00.000Z"), "08:37");
  assert.equal(horaDoApontamento("06:05"), "06:05");
  assert.equal(horaDoApontamento(""), null);
  assert.equal(horaDoApontamento(null), null);
});

test("duração de cada passagem e formato do total", () => {
  assert.equal(minutosDaPassagem("06:33", "17:25"), 652);
  assert.equal(minutosDaPassagem("07:16", "07:45"), 29);
  assert.equal(minutosDaPassagem("22:00", "02:00"), 240, "virou a meia-noite");
  assert.equal(minutosDaPassagem("07:00", null), null);
  assert.equal(formatarHoras(13222), "220h22");
  assert.equal(formatarHoras(29), "0h29");
  assert.equal(formatarHoras(0), "0h00");
});

test("dia da semana e limites do mês", () => {
  assert.equal(diaDaSemana("2026-08-03"), "Seg");
  assert.equal(diaDaSemana("2026-08-08"), "Sáb");
  assert.equal(diaDaSemana("2026-08-09"), "Dom");
  assert.deepEqual(limitesDoMes("2026-08"), { inicio: "2026-08-01", fim: "2026-08-31" });
  assert.deepEqual(limitesDoMes("2028-02"), { inicio: "2028-02-01", fim: "2028-02-29" });
});

test("soma os minutos da Portaria, sem corrigir (almoço e passagens a mais inclusos)", () => {
  const rel = montarRelatorio("2026-08", [
    ap("1", "Pessoa B", "2026-08-03", "08:52", "12:11", 199),
    ap("2", "Pessoa B", "2026-08-03", "12:36", "22:10", 574),
    // Passagem dentro de outra: o RH não interpreta, soma como está.
    ap("3", "Pessoa B", "2026-08-03", "15:00", "17:25", 145),
    ap("4", "Pessoa A", "2026-08-04", "07:00", "17:00", 600),
    ap("5", " Pessoa A ", "2026-08-03", "07:00", "12:00", 300),
  ]);
  assert.deepEqual(rel.pessoas.map((p) => p.nome), ["Pessoa A", "Pessoa B"]);
  const [a, b] = rel.pessoas;
  assert.deepEqual(a.linhas.map((l) => l.data), ["2026-08-03", "2026-08-04"], "ordenado por data");
  assert.equal(formatarHoras(a.totalMinutos), "15h00");
  assert.equal(formatarHoras(b.totalMinutos), "15h18", "3h19 + 9h34 + 2h25");
  assert.equal(formatarHoras(rel.totalMinutos), "30h18");
  assert.equal(rel.semSaida, 0);
  assert.equal(rel.naoContabilizadas, 0);
});

test("passagem sem saída aparece, não soma e é contada", () => {
  const rel = montarRelatorio("2026-09", [ap("1", "Pessoa C", "2026-09-02", "07:48", null)]);
  assert.equal(rel.pessoas[0].linhas[0].minutos, null);
  assert.equal(rel.pessoas[0].linhas[0].situacao, "sem-saida");
  assert.equal(rel.totalMinutos, 0);
  assert.equal(rel.semSaida, 1);
});

test("saída registrada em outro dia: a Portaria não calcula, o RH mostra e não soma", () => {
  // Esqueceram de fechar em 20/08; a saída só foi marcada em 24/08.
  const esquecida = ap("1", "Pessoa D", "2026-08-20", "08:42", "2026-08-24T06:01:58+00:00", null);
  const normal = ap("2", "Pessoa D", "2026-08-21", "07:00", "17:00", 600);
  const zerada = ap("3", "Pessoa D", "2026-08-22", "14:23", "14:23", 0);
  assert.deepEqual(contabilizar(esquecida), { situacao: "nao-contabilizada", minutos: null });
  assert.deepEqual(contabilizar(zerada), { situacao: "nao-contabilizada", minutos: null });
  assert.equal(saidaParaExibir(esquecida), "24/08 06:01");
  assert.equal(saidaParaExibir(normal), "17:00");
  const rel = montarRelatorio("2026-08", [esquecida, normal, zerada]);
  assert.equal(rel.pessoas[0].linhas.length, 3, "todas aparecem");
  assert.equal(formatarHoras(rel.totalMinutos), "10h00", "só a passagem com minutos soma");
  assert.equal(rel.naoContabilizadas, 2);
});

test("na fábrica agora: entrada sem saída, em ordem de chegada", () => {
  const lista = naFabrica([
    ap("1", "Pessoa A", "2026-09-27", "07:30", null),
    ap("2", "Pessoa B", "2026-09-27", "06:45", null),
    ap("3", "Pessoa C", "2026-09-27", "06:00", "12:00"),
  ]);
  assert.deepEqual(lista.map((a) => a.nome), ["Pessoa B", "Pessoa A"]);
});
