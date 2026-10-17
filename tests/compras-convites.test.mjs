import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/202610170010_compras_convites.sql", import.meta.url), "utf8");
const publica = readFileSync(new URL("../app/api/cotar/[codigo]/route.ts", import.meta.url), "utf8");
const pagina = readFileSync(new URL("../app/components/cotar-fornecedor.tsx", import.meta.url), "utf8");

test("convite por link: só o hash fica guardado e não sai para a tela", () => {
  assert.match(sql, /encode\(digest\(codigo, 'sha256'\), 'hex'\)/);
  assert.match(sql, /revoke all on public\.compras_convites from anon, authenticated/);
  const grant = sql.match(/grant select \(([^)]+)\) on public\.compras_convites to authenticated/);
  assert.ok(grant && !grant[1].includes("token_hash"), "leitura coluna a coluna, sem o hash");
});

test("convite por link: ler e responder só pela chave do servidor, uma vez, dentro da validade", () => {
  assert.match(sql, /revoke all on function public\.compras_convite_ler\(text\) from public, anon, authenticated;\ngrant execute on function public\.compras_convite_ler\(text\) to service_role;/);
  assert.match(sql, /if c\.situacao = 'respondido' then raise exception/);
  assert.match(sql, /if c\.expira_em < now\(\) then raise exception/);
  assert.match(sql, /'PENDENTE', coalesce\(c\.criado_por::text, 'convite'\), ped\.divisao, ped\.id/, "vira cotação pendente ligada ao pedido");
  assert.match(sql, /notify_feature\(c\.organization_id, 'compras\.cotacoes', 'operar'/);
  assert.match(publica, /createSupabaseAdminClient\(\)\.rpc\("compras_convite_ler"/);
  assert.match(publica, /dados\[0\] === 0x25 && dados\[1\] === 0x50/, "confere que o anexo é PDF de verdade");
  assert.match(publica, /remove\(\[caminho\]\)/, "apaga o arquivo se o registro falhar");
});

test("convite por link: a página não fixa a empresa", () => {
  assert.doesNotMatch(pagina, /pecsil/i);
  assert.match(pagina, /\{c\.empresa\}/);
});
