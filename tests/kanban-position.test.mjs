import assert from "node:assert/strict";
import test from "node:test";
import {
  LIMITE_PRECISAO,
  PASSO,
  casasDecimais,
  pontoMedio,
  precisaRenumerar,
  renumerar,
} from "../lib/kanban/fractional-indexing.ts";

test("coluna vazia, topo e fim", () => {
  assert.equal(pontoMedio(null, null), PASSO);
  assert.equal(pontoMedio(null, 1000), 0);
  assert.equal(pontoMedio(3000, null), 4000);
});

test("entre dois cards fica no meio, e a ordem se mantém", () => {
  assert.equal(pontoMedio(1000, 2000), 1500);
  assert.equal(pontoMedio(1000, 1500), 1250);
  const posicoes = [1000, 2000, 3000];
  const nova = pontoMedio(posicoes[0], posicoes[1]);
  const ordenado = [...posicoes, nova].sort((a, b) => a - b);
  assert.deepEqual(ordenado, [1000, 1500, 2000, 3000]);
});

test("vizinhos empatados não têm espaço entre si", () => {
  assert.ok(Number.isNaN(pontoMedio(1000, 1000)));
  assert.equal(precisaRenumerar(pontoMedio(1000, 1000)), true);
});

test("dividir ao meio muitas vezes obriga a renumerar", () => {
  let anterior = 0;
  let seguinte = 1000;
  let divisoes = 0;
  while (!precisaRenumerar(pontoMedio(anterior, seguinte)) && divisoes < 200) {
    seguinte = pontoMedio(anterior, seguinte);
    divisoes += 1;
  }
  assert.ok(divisoes > 10, `aguentou poucas divisões: ${divisoes}`);
  assert.ok(divisoes < 200, "nunca pediu renumeração");
  assert.equal(precisaRenumerar(pontoMedio(anterior, seguinte)), true);
});

test("contagem de casas decimais", () => {
  assert.equal(casasDecimais(1000), 0);
  assert.equal(casasDecimais(1500.5), 1);
  assert.equal(casasDecimais(1.0009765625), 10);
  assert.ok(casasDecimais(Number.NaN) === Infinity);
});

test("renumerar dá posições limpas e crescentes", () => {
  assert.deepEqual(renumerar(3), [1000, 2000, 3000]);
  assert.deepEqual(renumerar(0), []);
  const limpas = renumerar(5);
  assert.ok(limpas.every((valor, i) => i === 0 || valor > limpas[i - 1]));
  assert.ok(limpas.every((valor) => casasDecimais(valor) <= LIMITE_PRECISAO));
});
