import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");
const migracao = await readFile(new URL("../../../supabase/migrations/202610190001_ti_base.sql", import.meta.url), "utf8");

test("ti: módulo ativo, protegido e no menu", () => {
  assert.match(manifest, /id: "ti"/);
  assert.match(manifest, /entryPermission: TI_PERMISSIONS\.view/);
  assert.match(manifest, /enabled: true/);
});

test("ti: escrita só pelas funções do banco, cada uma com a sua permissão", () => {
  assert.match(migracao, /revoke insert, update, delete on public\.ti_ativos, public\.ti_incidentes, public\.ti_regras, public\.ti_chamados, public\.ti_chamado_andamentos from anon, authenticated/);
  assert.match(migracao, /has_feature\('ti\.ativos', 'operar'\)/);
  assert.match(migracao, /has_feature\('ti\.saude', 'operar'\)/);
  assert.match(migracao, /has_feature\('ti\.chamados', 'aprovar'\)/);
  // A cópia do vigia é só do servidor (chave de serviço).
  assert.match(migracao, /revoke all on function public\.ti_sincronizar_vigia\(uuid, jsonb\) from public, anon, authenticated;\ngrant execute on function public\.ti_sincronizar_vigia\(uuid, jsonb\) to service_role;/);
  // Quem abriu vê os seus chamados; a TI vê todos.
  assert.match(migracao, /has_feature\('ti\.chamados'\)\) or solicitante_id = \(select public\.current_profile_id\(\)\)/);
});

test("ti: as regras dos chamados nascem provisórias, até o supervisor de TI revisar", () => {
  assert.match(migracao, /revisado_em\s+timestamptz/);
  assert.doesNotMatch(migracao, /insert into public\.ti_regras \([^)]*revisado_em/);
});
