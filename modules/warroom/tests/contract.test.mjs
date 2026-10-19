import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");
const rota = await readFile(new URL("../../../app/api/warroom/cerebro/route.ts", import.meta.url), "utf8");
const visoes = await readFile(new URL("../../../supabase/migrations/202610190003_cerebro_visoes.sql", import.meta.url), "utf8");

test("warroom: módulo ativo e protegido", () => {
  assert.match(manifest, /id: "warroom"/);
  assert.match(manifest, /entryPermission: WARROOM_PERMISSIONS\.view/);
});

test("warroom: toda consulta do grafo exige o War Room", () => {
  assert.equal((rota.match(/requireFeature\("warroom\.cerebro", "ver"\)/g) ?? []).length, 2, "GET e POST");
  assert.doesNotMatch(rota, /createSupabaseAdminClient|SERVICE_ROLE/, "sem chave de serviço: o RLS vale");
});

test("warroom: visões salvas só com o War Room", () => {
  assert.match(visoes, /has_feature\('warroom\.cerebro'\)\)\);/);
  assert.match(visoes, /revoke insert, update, delete on public\.cerebro_visoes from anon, authenticated/);
});
