import assert from "node:assert/strict";
import test from "node:test";
import { SETORES_DOCUMENTO, caminhoDocumento, nomeSeguro, setoresDeEnvio, setoresVisiveis } from "../lib/documentos/setores.ts";
import { ACCESS_CATALOG, FEATURES_DOCUMENTOS_SETOR, derivePermissions } from "../modules/access-catalog.ts";

test("documentos: cada setor usa funcionalidades que existem no catálogo e do próprio módulo", () => {
  const todas = new Set(ACCESS_CATALOG.flatMap((m) => m.features.map((f) => f.code)));
  for (const s of SETORES_DOCUMENTO) {
    for (const f of [s.feature, ...(s.outras ?? [])]) {
      assert.ok(todas.has(f), `${f} não existe no catálogo`);
      assert.ok(f.startsWith(`${s.modulo}.`), `${f} não é do setor ${s.modulo}`);
    }
  }
  assert.equal(SETORES_DOCUMENTO.some((s) => s.modulo === "rh"), false, "o RH fica na guarda dele");
});

test("documentos: quem é só do RH não vê setor nenhum; Contas a pagar vê o Financeiro e não o Fiscal", () => {
  assert.deepEqual(setoresVisiveis({ grants: { "rh.documentos": "operar" } }), []);
  const ana = { grants: { "financeiro.pagar": "aprovar" } };
  assert.deepEqual(setoresVisiveis(ana).map((s) => s.modulo), ["financeiro"]);
  assert.deepEqual(setoresDeEnvio(ana).map((s) => s.modulo), ["financeiro"]);
  const soBancosVer = { grants: { "financeiro.bancos": "ver" } };
  assert.deepEqual(setoresVisiveis(soBancosVer).map((s) => s.modulo), ["financeiro"]);
  assert.deepEqual(setoresDeEnvio(soBancosVer), []);
  assert.equal(setoresVisiveis({ isOwner: true, grants: {} }).length, SETORES_DOCUMENTO.length);
});

test("documentos: nome seguro tira caminho e acento, mantém a extensão e limita o tamanho", () => {
  assert.equal(nomeSeguro("C:\\Users\\ana\\Extrato Bradesco 01 a 10-2026.XLS"), "Extrato Bradesco 01 a 10-2026.XLS");
  assert.equal(nomeSeguro("../../etc/passwd"), "passwd");
  assert.equal(nomeSeguro("Nota fiscal nº 22913 — CMBA.pdf"), "Nota fiscal n_ 22913 _ CMBA.pdf");
  assert.equal(nomeSeguro("Fundição ção.xml"), "Fundicao cao.xml");
  assert.equal(nomeSeguro(""), "arquivo");
  const longo = nomeSeguro(`${"a".repeat(200)}.pdf`);
  assert.equal(longo.length, 120);
  assert.ok(longo.endsWith(".pdf"));
});

test("documentos: caminho começa pela organização e pelo setor", () => {
  assert.equal(caminhoDocumento("org-1", "fiscal", "id-9", "nota 1.xml"), "org-1/fiscal/id-9/nota 1.xml");
  assert.throws(() => caminhoDocumento("org-1", "../rh", "id", "x"), /Setor inválido/);
});

test("documentos: a lista que abre a tela bate com os setores; RH-only abre a tela e é levado ao RH", () => {
  const dosSetores = new Set(SETORES_DOCUMENTO.flatMap((s) => [s.feature, ...(s.outras ?? [])]));
  assert.deepEqual([...FEATURES_DOCUMENTOS_SETOR].sort(), [...dosSetores].sort());
  assert.ok(derivePermissions({ "fiscal.icms": "ver" }).includes("core.documentos_setor.view"));
  assert.ok(derivePermissions({ "rh.documentos": "ver" }).includes("core.documentos_setor.view"));
  assert.equal(derivePermissions({ "portaria.visitas": "operar" }).includes("core.documentos_setor.view"), false);
});
