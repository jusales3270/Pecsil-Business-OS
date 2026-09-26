import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EVENT_CATALOG, EVENT_MODULES } from "../modules/event-catalog.ts";

const sql = [
  "202609210001_module_events.sql",
  "202609210002_master_data.sql",
  "202609220001_comercial_clientes.sql",
  "202609220002_comercial_email.sql",
  "202609220003_comercial_funil.sql",
  "202609260001_producao_os_espelho.sql",
]
  .map((name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"))
  .join("\n");

test("todo evento emitido pelos gatilhos está no catálogo, e vice-versa", () => {
  const emitted = new Set([...sql.matchAll(/'((?:comercial|compras|rh|financeiro|portaria|acesso|cadastros|producao)\.[a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]));
  const cataloged = new Set(EVENT_CATALOG.map((event) => event.type));
  for (const type of emitted) assert.ok(cataloged.has(type), `${type} falta no catálogo`);
  for (const type of cataloged) assert.ok(emitted.has(type), `${type} não é emitido por nenhum gatilho`);
});

test("cada evento pertence a um módulo conhecido e ao prefixo certo", () => {
  for (const event of EVENT_CATALOG) {
    assert.ok(EVENT_MODULES[event.module], event.type);
    assert.ok(event.type.startsWith(`${event.module}.`), event.type);
  }
});
