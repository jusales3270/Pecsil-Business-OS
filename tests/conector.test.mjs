import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consultaSoLeitura, hashDoSegredo, lerDescoberta, novoSegredo, segredoConfere, situacaoDaFonte, validarFonte, validarObjetos } from "../lib/conector/regras.ts";
import { consultaSoLeitura as doServico } from "../services/conector/leitura.mjs";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("conector: a trava de só leitura é a mesma na plataforma e no serviço", () => {
  const casos = ["select * from CLIENTES", "WITH x AS (SELECT 1) SELECT * FROM x", "select replace(a,'x','y') from T", "select 'drop' from T", "delete from T", "select 1; drop table T",
    "select * into N from T", "update T set a=1", "EXEC sp_who", "select * from T -- ; drop", "execute block as begin end", "  ", "select 1 from T for update", "/* x */ select 1"];
  for (const c of casos) assert.deepEqual(consultaSoLeitura(c), doServico(c), c);
  assert.ok(consultaSoLeitura("select 1 from T for update").erro, "FOR UPDATE trava linha: recusado");
});

test("conector: fonte nova, segredo só em hash e conferido sem vazar tempo", () => {
  assert.deepEqual(validarFonte({ nome: " GRV ", sistema: "GRV Sistemas", tipo: "firebird" }), { nome: "GRV", sistema: "GRV Sistemas", tipo: "firebird", degrau: 2 });
  assert.equal(validarFonte({ nome: "Pasta", tipo: "pasta" }).degrau, 3);
  assert.match(validarFonte({ nome: "X", tipo: "oracle" }).erro, /nome|tipo/);
  const s = novoSegredo();
  assert.ok(s.length >= 40 && s !== novoSegredo());
  const h = hashDoSegredo(s);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(segredoConfere(s, h)); assert.ok(!segredoConfere(`${s}x`, h)); assert.ok(!segredoConfere("", h)); assert.ok(!segredoConfere(s, "não-é-hash"));
});

test("conector: objetos a extrair (consulta só de leitura, chave de 1 a 6 campos, sem repetir)", () => {
  assert.deepEqual(validarObjetos([{ nome: "CLIENTES", consulta: "select * from CLIENTES;", chave: "COD, FILIAL" }]), { objetos: [{ nome: "CLIENTES", consulta: "select * from CLIENTES", chave: ["COD", "FILIAL"] }] });
  assert.match(validarObjetos([{ nome: "X", consulta: "delete from X", chave: "A" }]).erro, /X: A consulta tem de começar/);
  assert.match(validarObjetos([{ nome: "X", consulta: "select 1", chave: "" }]).erro, /de 1 a 6 campos/);
  assert.match(validarObjetos([{ nome: "X", consulta: "select 1", chave: "A" }, { nome: "x", consulta: "select 2", chave: "B" }]).erro, /repetido/);
  assert.match(validarObjetos([{ nome: "com espaço", consulta: "select 1", chave: "A" }]).erro, /nome com letras/);
});

test("conector: descoberta limpa e com teto; situação da fonte pelo último contato", () => {
  const d = lerDescoberta({ banco: { produto: "Firebird", versao: "2.5.9" }, tabelas: [{ nome: "CLIENTES", linhas: "1200", colunas: [{ nome: "COD", tipo: "INTEGER" }, { tipo: "x" }] }, { nome: "" }] });
  assert.equal(d.tabelas.length, 1); assert.equal(d.tabelas[0].linhas, 1200); assert.equal(d.tabelas[0].colunas.length, 1);
  assert.match(lerDescoberta({}).erro, /sem tabelas/);
  const agora = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(situacaoDaFonte({ ativo: true, ultimo_contato: null, intervalo_min: 60, ultimo_erro: null }, agora).estado, "nunca");
  assert.equal(situacaoDaFonte({ ativo: true, ultimo_contato: "2026-10-25T11:30:00Z", intervalo_min: 60, ultimo_erro: null }, agora).estado, "ok");
  assert.equal(situacaoDaFonte({ ativo: true, ultimo_contato: "2026-10-25T09:00:00Z", intervalo_min: 60, ultimo_erro: null }, agora).estado, "atrasada");
  assert.equal(situacaoDaFonte({ ativo: true, ultimo_contato: "2026-10-25T11:59:00Z", intervalo_min: 60, ultimo_erro: "x" }, agora).estado, "erro");
  assert.equal(situacaoDaFonte({ ativo: false, ultimo_contato: null, intervalo_min: 60, ultimo_erro: null }, agora).estado, "desativada");
});

test("conector: rota do serviço com 404 sem segredo; tela e rota só do proprietário; área de chegada sem gravação pela sessão", () => {
  const r = ler("app/api/conector/v1/[acao]/route.ts");
  assert.match(r, /if \(!f \|\| acao !== "tarefa"\) return nada\(\);/);
  assert.match(r, /segredoConfere\(segredo, data\.segredo_hash\)/);
  assert.match(r, /Objeto não configurado nesta fonte/, "o conector não inventa objeto");
  const f = ler("app/api/foundation/conectores/route.ts");
  assert.match(f, /if \(!access\?\.isOwner\)/);
  assert.match(f, /segredo_hash: hashDoSegredo\(segredo\)/);
  assert.doesNotMatch(f, /segredo: segredo,|insert\(\{[^}]*segredo: /, "o segredo em claro nunca é gravado");
  assert.match(ler("app/page.tsx"), /const OWNER_ONLY_VIEWS: View\[\] = \[[^\]]*"Conectores"/);
  const m = ler("supabase/migrations/202610250004_conector.sql");
  assert.match(m, /revoke insert, update, delete on public\.conector_fontes, public\.conector_lotes, public\.conector_registros, public\.conector_depara from authenticated/);
  assert.match(m, /revoke all on function public\.conector_receber\(uuid, text, text\[\], jsonb\) from public, anon, authenticated/);
  assert.match(m, /segredo_hash text not null check \(segredo_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(m, /when 'fornecedor' then public\.can_manage_suppliers\(\)/, "o de-para é decidido por quem pode alterar o cadastro");
});
