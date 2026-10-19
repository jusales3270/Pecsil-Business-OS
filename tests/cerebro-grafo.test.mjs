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

const g34 = readFileSync(new URL("../supabase/migrations/202610190004_cerebro_g3_g4.sql", import.meta.url), "utf8");

test("Cérebro G3: fora do War Room, a ficha segue a permissão de cada área", () => {
  assert.match(g34, /select public\.has_feature\('warroom\.cerebro'\) or exists \(select 1 from unnest\(coalesce\(p_exige, '\{\}'\)\) f where public\.has_feature\(f\)\)/);
  assert.match(g34, /if not fin_pagar and n\.tipo = 'fornecedor' then fora := fora \|\| array\['titulos', 'lancado', 'pago', 'em_aberto'/, "pago só com o Financeiro");
  assert.match(g34, /if not compras and n\.tipo in \('fornecedor', 'item', 'material'\)/, "preço de compra só com o Compras ou o Almoxarifado");
  assert.match(g34, /and \(l\.tipo not in \('vendeu', 'cotou'\) or compras\)/);
  assert.match(g34, /create or replace function public\.cerebro_historico_preco[\s\S]*?security invoker/, "histórico de preço com o RLS das compras");
});

test("Cérebro G4: pessoas sem dado pessoal e sem usuários de teste; montagem extra só pelo servidor", () => {
  const mais = g34.slice(g34.indexOf("create or replace function public.cerebro_montar_mais"), g34.indexOf("revoke all on function public.cerebro_montar_mais"));
  assert.match(mais, /p\.email not like '%@pecsil-teste\.local'/);
  for (const c of ["cpf", "phone", "telefone", "salary", "salario", "avatar"]) assert.doesNotMatch(mais, new RegExp(`p\\.${c}\\b`), c);
  assert.match(mais, /f\.code !~ '\\\.\(sara\|coleta\)\$'/, "SARA e coleta não viram responsabilidade");
  assert.match(g34, /revoke all on function public\.cerebro_montar_mais\(uuid\) from public, anon, authenticated;/);
  assert.match(g34, /perform public\.cerebro_montar_mais\(p_org\);/);
  assert.match(g34, /'pessoa', 'documento', 'ativo_ti', 'sistema', 'processo'\)/, "os tipos novos também são limpos quando somem");
  assert.match(g34, /t\.chart_account_id not in \(select public\.cerebro_contas_pessoais\(p_org\)\)/, "a regra da folha continua na montagem nova");
});

test("Cérebro G3: as consultas da SARA do fornecedor, do cliente e do preço estão na equipe", async () => {
  const { AGENTES } = await import("../lib/sara/agentes/index.ts");
  const nomes = AGENTES.flatMap((a) => a.ferramentas.map((f) => f.nome));
  for (const n of ["ficha_fornecedor", "historico_de_preco", "ficha_cliente"]) assert.equal(nomes.filter((x) => x === n).length, 1, n);
  const compras = AGENTES.find((a) => a.sara.modulo === "compras");
  assert.ok(compras.sara.ferramentas.includes("ficha_fornecedor") && compras.sara.ferramentas.includes("historico_de_preco"));
  const { FICHA_FORNECEDOR } = await import("../lib/sara/cerebro-ferramentas.ts");
  assert.ok(FICHA_FORNECEDOR.exige.includes("financeiro.pagar"), "a SARA do Financeiro também alcança a ficha do fornecedor");
});
