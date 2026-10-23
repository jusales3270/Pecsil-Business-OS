import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACOES, acoesDaSara } from "../lib/sara/acoes.ts";
import { ACOES_AREAS, ROTULO_DAS_ACOES } from "../lib/sara/acoes-areas.ts";

const A = Object.fromEntries(ACOES.map((f) => [f.nome, f]));
const fonte = readFileSync(new URL("../lib/sara/acoes-areas.ts", import.meta.url), "utf8");
const pode = (g) => (f, n) => (g[f] === "aprovar") || (g[f] === "operar" && n === "operar");

test("as 7 ações novas entram na lista da SARA, todas como 'operar' e de baixo risco", () => {
  assert.equal(ACOES_AREAS.length, 7);
  for (const f of ACOES_AREAS) {
    assert.ok(A[f.nome], f.nome);
    assert.equal(f.acao?.nivel, "operar", f.nome);
    assert.ok(f.exige.length > 0, `${f.nome} exige uma funcionalidade`);
    assert.ok(ROTULO_DAS_ACOES[f.nome], `${f.nome} tem nome para o quadro de limites`);
    assert.match(f.descricao, /^PREPARA /, `${f.nome} diz que só prepara`);
  }
});

test("cada ação chama a MESMA função do banco que a tela usa", () => {
  for (const fn of ["compras_ramo_criar", "fiscal_portal_pendencia_abrir", "rh_terceiro_incluir", "ti_salvar_ativo", "ti_salvar_incidente", "ti_chamado_acao", "producao_entrada_registrar"]) {
    assert.match(fonte, new RegExp(`sb\\.rpc\\("${fn}"`), fn);
  }
  // As de risco maior ficam de fora até o "sim" da área.
  for (const fn of ["finance_aprovar_titulo", "finance_settle_title", "finance_reconcile_entry", "compras_direta_registrar", "compras_ramo_cancelar", "almoxarifado_confirmar_recebimento", "almoxarifado_cancelar_solicitacao", "fundicao_cancelar_pedido", "rh_documento_conferir", "rh_terceiro_excluir", "compras_convite_criar"]) {
    assert.doesNotMatch(fonte, new RegExp(fn), `${fn} não é ação da SARA`);
  }
});

test("cada módulo oferece só as suas ações, e só a quem tem o nível", () => {
  const nomes = (m, g) => acoesDaSara(m, pode(g)).map((f) => f.nome);
  assert.ok(nomes("compras", { "compras.cotacoes": "operar" }).includes("encaminhar_para_cotar"));
  assert.ok(!nomes("compras", { "compras.cotacoes": "ver" }).includes("encaminhar_para_cotar"));
  assert.ok(!nomes("fundicao", { "compras.cotacoes": "operar" }).includes("encaminhar_para_cotar"), "só na SARA do Compras");
  assert.ok(nomes("fiscal", { "fiscal.escritorio": "operar" }).includes("pendencia_para_o_escritorio"));
  assert.ok(nomes("rh", { "rh.terceiros": "operar" }).includes("incluir_terceiro"));
  assert.deepEqual(nomes("ti", { "ti.ativos": "operar" }).filter((n) => ACOES_AREAS.some((f) => f.nome === n)), ["cadastrar_equipamento"]);
  assert.ok(nomes("producao", { "producao.entrada": "operar" }).includes("entrada_de_producao"));
  assert.ok(nomes("comercial", { "producao.entrada": "operar" }).includes("entrada_de_producao"));
});

test("o cartão confere a entrada antes de chegar ao banco", async () => {
  assert.ok("erro" in await A.cadastrar_equipamento.acao.preparar(null, { nome: "PC", tipo: "torradeira" }));
  const ok = await A.cadastrar_equipamento.acao.preparar(null, { nome: "PC do Almox", tipo: "estacao", local: "Almoxarifado", critico: true });
  assert.match(ok.resumo, /PC do Almox \(estacao, crítico\)/);
  assert.deepEqual(ok.detalhes, ["Local: Almoxarifado"]);
  assert.ok("erro" in await A.registrar_incidente.acao.preparar(null, { categoria: "chuva", causa: "x", inicio: "2026-10-22T08:00" }));
  assert.ok("erro" in await A.registrar_incidente.acao.preparar(null, { categoria: "rede", causa: "cabo", inicio: "hoje cedo" }));
  assert.ok("erro" in await A.incluir_terceiro.acao.preparar(null, { nome: "x" }));
  assert.ok("erro" in await A.pendencia_para_o_escritorio.acao.preparar(null, { assunto: "ab", texto: "" }));
  assert.ok("erro" in await A.encaminhar_para_cotar.acao.preparar(null, { fornecedor: "X" }), "sem o número do pedido");
  assert.ok("erro" in await A.atender_chamado_ti.acao.preparar(null, { acao: "resolver" }), "sem o número do chamado");
  assert.ok("erro" in await A.entrada_de_producao.acao.preparar(null, { quantidade: 3 }), "sem o orçamento");
});

test("incidente: horário de Brasília vai com o fuso", () => {
  assert.match(fonte, /\$\{s\}:00-03:00/);
});
