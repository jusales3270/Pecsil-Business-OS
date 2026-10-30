import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");
const migracao = await readFile(new URL("../../../supabase/migrations/202610300001_qualidade_base.sql", import.meta.url), "utf8");
const responder = await readFile(new URL("../../../lib/sara/responder.ts", import.meta.url), "utf8");

test("qualidade: módulo ativo, protegido e no menu", () => {
  assert.match(manifest, /id: "qualidade"/);
  assert.match(manifest, /entryPermission: QUALIDADE_PERMISSIONS\.view/);
  assert.match(manifest, /enabled: true/);
});

test("qualidade: escrita só pelas funções do banco, cada uma com o seu nível", () => {
  assert.match(migracao, /revoke insert, update, delete on public\.qualidade_regras, public\.qualidade_nao_conformidades, public\.qualidade_nc_fotos, public\.qualidade_nc_andamentos from anon, authenticated/);
  assert.match(migracao, /public\.qualidade_nc_registrar\(p jsonb\)[\s\S]*?qualidade_exigir\('operar'\)/);
  assert.match(migracao, /public\.qualidade_salvar_regras\([\s\S]*?qualidade_exigir\('aprovar'\)/);
  assert.doesNotMatch(migracao, /delete from public\.qualidade_nao_conformidades/);
});

test("qualidade: os tipos nascem provisórios e a gravidade, desligada", () => {
  assert.match(migracao, /usar_gravidade\s+boolean not null default false/);
  assert.doesNotMatch(migracao, /insert into public\.qualidade_regras \([^)]*revisado_em/);
});

test("qualidade: a foto pendente é só de quem mandou, e quem escolhe as fotos é o servidor", () => {
  assert.match(migracao, /nc_id is not null or autor_id = \(select public\.current_profile_id\(\)\)/);
  assert.match(migracao, /autor_id = me and nc_id is null/);
  assert.match(responder, /fotos: fotosDaConversa/);
});
