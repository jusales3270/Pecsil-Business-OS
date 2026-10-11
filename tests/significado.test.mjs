import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { dividirEmTrechos, escolherPorSentido, TAM_TRECHO } = await import("../lib/significado/trechos.ts");

test("significado: trechos de até ~800 caracteres, cortando em espaço, com sobreposição", () => {
  const palavras = Array.from({ length: 600 }, (_, i) => `palavra${i}`).join(" ");
  const trechos = dividirEmTrechos(palavras);
  assert.ok(trechos.length > 3);
  for (const t of trechos) {
    assert.ok(t.length <= TAM_TRECHO, `${t.length}`);
    assert.match(t, /^palavra\d+/, "começa numa palavra inteira");
    assert.match(t, /palavra\d+$/, "termina numa palavra inteira");
  }
  // Sobreposição: o fim de um trecho reaparece no começo do seguinte.
  const ultima = trechos[0].split(" ").at(-1);
  assert.ok(trechos[1].includes(ultima), "sobreposição");
  assert.deepEqual(dividirEmTrechos("ab"), []);
  assert.deepEqual(dividirEmTrechos("Contrato   de\nmanutenção"), ["Contrato de manutenção"]);
  assert.equal(dividirEmTrechos(palavras.repeat(50)).length, 100, "no máximo 100 trechos");
});

test("significado: corte relativo ao melhor (as notas do modelo ficam próximas)", () => {
  const lista = [
    { id: "contrato", similaridade: 0.833 }, { id: "cotacao", similaridade: 0.815 },
    { id: "holerite", similaridade: 0.812 }, { id: "extrato", similaridade: 0.802 },
  ];
  assert.deepEqual(escolherPorSentido(lista).map((x) => x.id), ["contrato", "cotacao", "holerite"]);
  assert.deepEqual(escolherPorSentido(lista, { margem: 0.01 }).map((x) => x.id), ["contrato"]);
  assert.deepEqual(escolherPorSentido([{ id: "x", similaridade: 0.75 }]), [], "abaixo do piso: nada");
  assert.equal(escolherPorSentido(Array.from({ length: 9 }, (_, i) => ({ id: String(i), similaridade: 0.86 }))).length, 5, "no máximo 5");
});

test("significado: palavras primeiro, depois sentido, depois parecidos (sentido ganha do parecido)", async () => {
  const { juntarComSentido } = await import("../lib/significado/trechos.ts");
  const palavras = [{ id: "a", trecho: "x", como: "palavras" }, { id: "b", trecho: "y", como: "parecido" }];
  assert.deepEqual(juntarComSentido(palavras, [{ id: "b", trecho: "z" }, { id: "c", trecho: "w" }, { id: "a", trecho: "k" }]).map((x) => `${x.id}:${x.como}`),
    ["a:palavras", "b:significado", "c:significado"]);
  assert.deepEqual(juntarComSentido([{ id: "b", trecho: "y", como: "parecido" }], []).map((x) => x.como), ["parecido"]);
});
