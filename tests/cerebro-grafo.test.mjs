import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// O SQL do grafo (202610190002_cerebro_grafo.sql) é testado de ponta a ponta num Postgres descartável com a
// estrutura e os dados de origem da produção; aqui ficam as garantias que não podem regredir.
const sql = readFileSync(new URL("../supabase/migrations/202610190002_cerebro_grafo.sql", import.meta.url), "utf8");

test("Cérebro: quem tem o War Room vê o grafo inteiro (W2), e só quem tem", () => {
  for (const t of ["cerebro_nos", "cerebro_ligacoes", "cerebro_execucoes"]) {
    assert.match(sql, new RegExp(`create policy ${t}_read on public\\.${t} for select using \\(\\s*organization_id = \\(select public\\.current_organization_id\\(\\)\\) and \\(select public\\.has_feature\\('warroom\\.cerebro'\\)\\)\\)`), t);
  }
  assert.match(sql, /revoke insert, update, delete on public\.cerebro_nos, public\.cerebro_ligacoes, public\.cerebro_execucoes from anon, authenticated/);
  assert.match(sql, /revoke all on function public\.cerebro_montar\(uuid\) from public, anon, authenticated;\ngrant execute on function public\.cerebro_montar\(uuid\) to service_role;/, "montar só pelo servidor");
  assert.match(sql, /if not public\.is_owner\(\) then raise exception 'Só o proprietário refaz o grafo\.'/);
  assert.match(sql, /if not public\.has_feature\('warroom\.cerebro'\) then raise exception 'Sem acesso ao Segundo Cérebro\.'/, "registros de origem só com o War Room");
});

test("Cérebro: pagamento a pessoa (folha e sócios) nunca entra, e o histórico pago do sistema antigo entra", () => {
  assert.match(sql, /gastos com funcionarios\|socios\|pro\.\?labore\|comissao\|salari\|folha de pagamento\|ferias\|rescis\|pensao\|abono salarial\|adiantamento/);
  assert.match(sql, /select f\.id from public\.finance_chart_accounts f join ramo r on f\.parent_id = r\.id/, "o ramo inteiro, com as subcontas");
  assert.match(sql, /t\.chart_account_id not in \(select public\.cerebro_contas_pessoais\(p_org\)\)/);
  assert.doesNotMatch(sql, /t\.archived_at is null/, "arquivado = pago antes de 2026, é histórico");
});

test("Cérebro: nenhum dado sensível vira nó ou atributo", () => {
  const montar = sql.slice(sql.indexOf("create or replace function public.cerebro_montar"), sql.indexOf("revoke all on function public.cerebro_montar"));
  for (const c of ["tax_id", "phone", "email", "contact_name", "address", "telefone", "logradouro", "email_nfe", "state_registration", "cpf", "salary"]) {
    assert.ok(!new RegExp(`\\b[a-z]\\.${c}\\b`).test(montar), `não lê ${c}`);
  }
});

test("Cérebro: o nome do item comprado junta só a unidade repetida no fim", () => {
  assert.match(sql, /create or replace function public\.cerebro_item_chave\(p text\) returns text\s+language plpgsql immutable/);
  assert.match(sql, /position\(replace\(m\[2\] \|\| m\[3\], ' ', ''\) in replace\(m\[1\], ' ', ''\)\) > 0/);
});

test("Cérebro: o caminho entre dois nós é busca em largura com visitados (sem explodir nos nós centrais)", () => {
  assert.match(sql, /create temp table _vis \(id uuid primary key/);
  assert.match(sql, /on conflict \(id\) do nothing/);
});

test("Cérebro (tela): tamanho, posição estável, ficha formatada e filtro sem ligação solta", async () => {
  const v = await import("../lib/cerebro/visual.ts");
  assert.equal(v.tamanhoDoNo(0), 2.5);
  assert.ok(v.tamanhoDoNo(3860) <= 26, "o cliente com 3.860 peças não engole a tela");
  assert.ok(v.tamanhoDoNo(100) > v.tamanhoDoNo(10));
  assert.deepEqual(v.posicaoInicial("abc"), v.posicaoInicial("abc"));
  assert.notDeepEqual(v.posicaoInicial("abc"), v.posicaoInicial("abd"));
  const linhas = v.linhasDaFicha("item", { comprado: 11573.1, compras: 3, ultimo_preco: 18.37, ultima_compra: "2026-08-18", nada: 1 });
  assert.deepEqual(linhas.map((l) => l.rotulo), ["Comprado", "Compras", "Último preço", "Última compra"]);
  assert.match(linhas[0].valor, /11\.573,10/);
  assert.equal(linhas[3].valor, "18/08/2026");
  assert.equal(v.linhasDaFicha("cliente", { atraso_medio_dias: 1 })[0].valor, "1 dia");
  const l = { id: "l", origem: "a", destino: "b", tipo: "vendeu", familia: "transacao", quantidade: 3, total: 11573.1, primeira: "2026-08-04", ultima: "2026-08-18", resumo: { ultimo_preco: 18.37 }, procedencia: "regra", situacao: "valendo" };
  assert.match(v.resumoDaLigacao(l), /^3 compras · R\$\s?11\.573,10 · 04\/08\/2026 a 18\/08\/2026 · último preço R\$\s?18,37$/);
  const g = { nos: [{ id: "a", tipo: "fornecedor" }, { id: "b", tipo: "item" }, { id: "c", tipo: "produto" }], ligacoes: [l, { ...l, id: "l2", destino: "c", familia: "estrutura" }] };
  const f = v.filtrar(g, new Set(["fornecedor", "item"]), new Set(["transacao", "estrutura"]), null);
  assert.deepEqual(f.ligacoes.map((x) => x.id), ["l"], "ligação para nó escondido sai");
  assert.equal(v.filtrar(g, new Set(["fornecedor", "item"]), new Set(["transacao"]), "2026-09-01").ligacoes.length, 0, "período corta pela última data");
  assert.equal(v.rotuloLigacao("abastece", false), "depende de");
});
