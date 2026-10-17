import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A-11: "parados há X dias" é só a lista, por área, sem cobrança automática.
const sql = readFileSync(new URL("../supabase/migrations/202610170002_parados.sql", import.meta.url), "utf8");

test("parados: cada tipo tem prazo e área, e só aparece para quem resolve", () => {
  for (const tipo of ["pedido_material", "cotacao_aprovacao", "cotacao_sem_compra", "compra_atrasada", "os_rascunho", "orcamento_sem_resposta", "a_faturar", "conta_aprovacao", "nota_sem_lancamento"]) {
    assert.match(sql, new RegExp(`'${tipo}'`), `tipo ${tipo}`);
  }
  assert.match(sql, /and public\.has_feature\(b\.f, b\.n\)/, "filtra pela permissão da área");
  assert.match(sql, /not q\.treino/, "orçamento de treino não entra");
});

test("parados: não escala nem manda mensagem", () => {
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(codigo, /notify_feature|insert into public\.notifications|whatsapp/i);
});
