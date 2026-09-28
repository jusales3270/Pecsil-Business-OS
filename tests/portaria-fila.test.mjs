import assert from "node:assert/strict";
import test from "node:test";
import { compactarFila, resolverAlvo } from "../modules/portaria/src/lib/offlineQueueCore.ts";

const op = (id, type, payload, tempId) => ({ id, type, payload, tempId });

test("criar, encerrar e excluir o mesmo provisório: nada é gravado", () => {
  // Caso real encontrado na fila do navegador (04/09): teste com efeito nulo.
  const { fila, descartadas } = compactarFila([
    op("1", "insert_terceiro", { nome: "Pessoa A", data: "2026-09-04" }, "temp-1"),
    op("2", "encerrar_terceiro", { id: "temp-1", horaSaida: "x", minutosTrabalhados: 0 }),
    op("3", "delete_terceiro", { id: "temp-1" }),
  ]);
  assert.equal(fila.length, 0);
  assert.equal(descartadas.length, 3);
});

test("só a criação e o encerramento: ficam, e o encerramento usa o id real", () => {
  const { fila } = compactarFila([
    op("1", "insert_terceiro", { nome: "Pessoa B" }, "temp-2"),
    op("2", "encerrar_terceiro", { id: "temp-2", horaSaida: "y" }),
  ]);
  assert.equal(fila.length, 2);
  assert.deepEqual(resolverAlvo(fila[1], new Map(), new Set(["temp-2"])), { acao: "aguardar" });
  assert.deepEqual(resolverAlvo(fila[1], new Map([["temp-2", "uuid-real"]]), new Set()), { acao: "executar", payload: { id: "uuid-real", horaSaida: "y" } });
});

test("excluir registro real não é descartado; provisório sem criação é órfão", () => {
  const { fila } = compactarFila([op("1", "delete_terceiro", { id: "uuid-existente" })]);
  assert.equal(fila.length, 1);
  assert.equal(resolverAlvo(fila[0], new Map(), new Set()).acao, "executar");
  assert.equal(resolverAlvo(op("2", "encerrar_terceiro", { id: "temp-9" }), new Map(), new Set()).acao, "orfa");
});

test("outros registros da fila não são afetados pela compactação", () => {
  const { fila } = compactarFila([
    op("1", "insert_terceiro", { nome: "A" }, "temp-a"),
    op("2", "delete_terceiro", { id: "temp-a" }),
    op("3", "insert_visita", { visitante: "B" }, "temp-b"),
  ]);
  assert.deepEqual(fila.map((o) => o.id), ["3"]);
});
