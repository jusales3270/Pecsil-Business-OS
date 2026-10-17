import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/202610170008_rh_exigencias_funcao.sql", import.meta.url), "utf8");
const rota = readFileSync(new URL("../app/api/rh/exigencias/route.ts", import.meta.url), "utf8");

test("exigências por função: decide quem aprova SST no RH, pela permissão da área (sem o proprietário)", () => {
  assert.equal((sql.match(/tem_permissao_da_area\('rh\.sst', 'aprovar'\)/g) ?? []).length, 2, "salvar e remover");
  assert.doesNotMatch(sql, /is_owner\(\)/);
  assert.match(sql, /revoke insert, update, delete on public\.rh_position_requirements from anon, authenticated/);
  assert.match(rota, /tem_permissao_da_area", \{ p_feature: "rh\.sst", p_level: "aprovar" \}/);
});

test("exigências por função: sugestão só pela regra de metade da função em 12 meses, e só vale confirmada", () => {
  assert.match(sql, /x\.pessoas \* 2 >= t\.n/);
  assert.match(sql, /d\.delivered_on >= \(now\(\) at time zone 'America\/Sao_Paulo'\)::date - 365/);
  assert.match(sql, /not exists \(select 1 from public\.rh_position_requirements r where r\.position_id = x\.position_id/);
});

test("exigências por função: pendências calculadas das entregas e dos registros de SST", () => {
  for (const s of ["nunca_entregue", "sem_registro", "vencido", "a_vencer", "em_dia"]) assert.match(sql, new RegExp(`'${s}'`));
  assert.match(sql, /lower\(btrim\(s\.title\)\) = lower\(btrim\(b\.titulo\)\)/, "exame liga pelo título");
  assert.match(rota, /range\(de, de \+ 999\)/, "pendências lidas em páginas");
});
