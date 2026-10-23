import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const sql = ler("supabase/migrations/202610230001_decisoes.sql");

test("Decisões: só o proprietário pergunta, só quem recebeu responde, o proprietário é avisado", () => {
  assert.match(sql, /if org is null or not public\.is_owner\(\) then raise exception 'Quem pergunta às áreas é o proprietário\.'/);
  assert.match(sql, /Só quem recebeu a pergunta responde\./);
  assert.match(sql, /not \(p_resposta = any \(d\.opcoes\)\)/, "só as opções da pergunta");
  assert.match(sql, /'approval'[\s\S]*'\/\?decisoes=' \|\| new\.id::text/, "aviso no sino com link para a decisão");
  assert.match(sql, /is_owner and status = 'active' and id <> me/, "o proprietário acompanha as respostas");
  assert.match(sql, /revoke insert, update, delete on public\.decisoes from anon, authenticated/);
});

test("Decisões: menu da conta, aviso do sino e endereço abrem o painel", () => {
  const page = ler("app/page.tsx");
  assert.match(page, /Decisões para você\{decisoesPendentes>0/);
  assert.match(page, /if\(params\.has\("decisoes"\)\)\{setDecisoes\(\{id:params\.get\("decisoes"\)\|\|null\}\);return\}/);
  assert.match(page, /if \(params\.has\("decisoes"\)\) \{ const id = params\.get\("decisoes"\) \|\| null; setTimeout\(\(\) => setDecisoes\(\{ id \}\), 0\); \}/);
  // Aviso da SARA no sino abre a janela (e as Guias).
  assert.match(page, /if\(params\.has\("sara"\)&&params\.get\("module"\)\)\{openModule/);
  const rota = ler("app/api/decisoes/route.ts");
  assert.match(rota, /rpc\("decisoes_minhas"\)/);
  assert.match(rota, /rpc\("decisao_responder"/);
});
