import assert from "node:assert/strict";
import test from "node:test";
import { chaveItem, parseAssinatura, parseEntregasEpi } from "../lib/rh/epi-parser.ts";

// Dados fictícios: nenhum nome ou CPF daqui existe no arquivo real.
const secao = (nome, cpf, linhas) => `## ${nome}

- **CPF:** ${cpf}
- **Cargo:** Operador Teste
- **Registros:** ${linhas.length}

| EPI | CA | Quantidade | Data Última Entrega | Assinatura |
|---|---|---|---|---|
${linhas.join("\n")}
`;

test("entrega assinada, sem assinatura e sem CA", () => {
  const { employees, problems } = parseEntregasEpi(secao("FULANO DE TAL", "12345678901", [
    "| LUVA  TESTE CA 111 | 111 | 2 | 30/01/2026 | Assinado Biometricamente em 06/02/2026 |",
    "| Luva de látex |  | 1 | 30/01/2026 |  |",
  ]));
  assert.deepEqual(problems, []);
  const [pessoa] = employees;
  assert.equal(pessoa.cpf, "12345678901");
  assert.equal(pessoa.role, "Operador Teste");
  const [assinada, semAssinatura] = pessoa.deliveries;
  assert.equal(assinada.itemName, "LUVA TESTE CA 111");
  assert.equal(assinada.caNumber, "111");
  assert.equal(assinada.quantity, 2);
  assert.equal(assinada.deliveredOn, "2026-01-30");
  assert.equal(assinada.signedOn, "2026-02-06");
  assert.equal(semAssinatura.caNumber, null);
  assert.equal(semAssinatura.signedOn, null);
  assert.equal(semAssinatura.itemKey, "LUVA DE LATEX");
});

test("sem CPF, a pessoa entra sem documento (fica sem par no cadastro)", () => {
  const { employees } = parseEntregasEpi(secao("SEM DOCUMENTO", "", [
    "| LUVA | 111 | 1 | 01/02/2026 | Assinado Biometricamente em 01/02/2026 |",
  ]));
  assert.equal(employees[0].cpf, null);
  assert.equal(employees[0].deliveries.length, 1);
});

test("linha repetida é descartada; data quebrada vai para o relatório sem CPF", () => {
  const linha = "| LUVA | 111 | 1 | 01/02/2026 | Assinado Biometricamente em 01/02/2026 |";
  const { employees, problems } = parseEntregasEpi(secao("FULANO", "12345678901", [
    linha,
    linha,
    "| LUVA | 111 | 1 | 31/02/2026 | Assinado Biometricamente em 01/03/2026 |",
    "| LUVA | 111 | 0 | 01/02/2026 |  |",
  ]));
  assert.equal(employees[0].deliveries.length, 1);
  assert.equal(employees[0].duplicates, 1);
  assert.deepEqual(problems.map((p) => p.message), ["data de entrega inválida", "quantidade inválida"]);
  assert.ok(problems.every((p) => !JSON.stringify(p).includes("12345678901")), "CPF nunca aparece em problema");
});

test("assinatura e chave de item", () => {
  assert.deepEqual(parseAssinatura(""), { signedOn: null });
  assert.deepEqual(parseAssinatura("Assinado Biometricamente em 23/09/2026"), { signedOn: "2026-09-23" });
  assert.ok("error" in parseAssinatura("Assinado"));
  assert.equal(chaveItem("Óculos  de Proteção"), chaveItem("OCULOS DE PROTEÇÃO"));
});
