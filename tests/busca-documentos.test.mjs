import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { pedacosDoTrecho } = await import("../lib/documentos/trecho.ts");

test("trecho da busca: palavras achadas destacadas, sem HTML", () => {
  assert.deepEqual(pedacosDoTrecho("Contrato de [[manutenção]] dos [[fornos]]"), [
    { texto: "Contrato de ", achado: false }, { texto: "manutenção", achado: true },
    { texto: " dos ", achado: false }, { texto: "fornos", achado: true },
  ]);
  // HTML do documento continua sendo texto: a tela nunca o interpreta.
  assert.deepEqual(pedacosDoTrecho("<b>x</b> [[y]]"), [{ texto: "<b>x</b> ", achado: false }, { texto: "y", achado: true }]);
  assert.deepEqual(pedacosDoTrecho(null), []);
  assert.deepEqual(pedacosDoTrecho("linha\n\n  quebrada"), [{ texto: "linha quebrada", achado: false }]);
});

test("a migração da busca usa as permissões de quem pesquisa e não confunde parecido com exclusão", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/migrations/202610110003_busca_documentos.sql", import.meta.url), "utf8");
  assert.match(sql, /function public\.company_document_search[\s\S]*security invoker/);
  assert.match(sql, /not tem_palavra and simples/);
  assert.doesNotMatch(sql, /grant execute on function public\.company_document_search\([^)]*\) to [^;]*anon/);
});
