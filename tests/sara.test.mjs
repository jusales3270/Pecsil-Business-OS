import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ferramentasDe } from "../lib/sara/ferramentas.ts";
import { conversarCom } from "../lib/sara/laco.ts";
import { SARAS } from "../lib/sara/modulos.ts";

test("SARA: só recebe as ferramentas que a pessoa pode usar (dado de outro módulo só com a credencial)", () => {
  const nomes = SARAS.financeiro.ferramentas;
  const so = (fs) => (f) => fs.includes(f);
  assert.deepEqual(ferramentasDe(so(["financeiro.pagar"]), nomes).map((f) => f.nome), ["contas_a_pagar", "buscar_contas_a_pagar", "abrir_lancamento"]);
  assert.deepEqual(ferramentasDe(so(["financeiro.pagar", "compras.cotacoes"]), nomes).map((f) => f.nome), ["contas_a_pagar", "buscar_contas_a_pagar", "abrir_lancamento", "compras_aprovadas_a_pagar"]);
  assert.equal(ferramentasDe(so(["financeiro.fluxo"]), nomes)[0].nome, "fluxo_de_caixa_90_dias");
  assert.deepEqual(ferramentasDe(so([]), nomes), []);
});

// Claude falso: primeiro pede a ferramenta, depois responde com o texto.
function claudeFalso(roteiro) {
  const pedidos = [];
  const buscar = async (_url, init) => {
    const corpo = JSON.parse(init.body);
    pedidos.push(corpo);
    const passo = roteiro[pedidos.length - 1];
    return { ok: true, status: 200, json: async () => passo };
  };
  return { buscar, pedidos };
}
const ferramenta = (nome, dados, fontes = [{ rotulo: "Financeiro › Contas a pagar", link: "/?module=financeiro" }]) => ({
  nome, descricao: "teste", exige: ["financeiro.pagar"], esquema: { type: "object", properties: {} }, rodar: async () => ({ dados, fontes }),
});

test("SARA: roda a ferramenta pedida, devolve o resultado ao modelo e junta as fontes e os tokens", async () => {
  const { buscar, pedidos } = claudeFalso([
    { stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: "tool_use", id: "t1", name: "contas_a_pagar", input: { situacao: "vencidas" } }] },
    { stop_reason: "end_turn", usage: { input_tokens: 150, output_tokens: 40 }, content: [{ type: "text", text: "Há **3** contas vencidas, somando R$ 1.000,00." }] },
  ]);
  const r = await conversarCom({}, { chave: "x", buscar, modelo: "claude-haiku-5-5", sistema: "s", historico: [], pergunta: "o que venceu?", ferramentas: [ferramenta("contas_a_pagar", { quantidade: 3, total: 1000 })] });
  assert.match(r.texto, /3\*\* contas vencidas/);
  assert.equal(r.tokensEntrada, 250);
  assert.equal(r.tokensSaida, 60);
  assert.deepEqual(r.fontes.map((f) => f.link), ["/?module=financeiro"]);
  assert.deepEqual(r.ferramentas, [{ nome: "contas_a_pagar", entrada: { situacao: "vencidas" }, ok: true }]);
  const devolvido = pedidos[1].messages.at(-1).content[0];
  assert.equal(devolvido.type, "tool_result");
  assert.match(devolvido.content, /"total":1000/);
  assert.equal(pedidos[0].tools.length, 1, "o modelo só conhece as ferramentas da pessoa");
});

test("SARA: ferramenta fora da permissão e resultado com dado pessoal não chegam ao modelo", async () => {
  const { buscar, pedidos } = claudeFalso([
    { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", id: "a", name: "compras_aprovadas_a_pagar", input: {} }, { type: "tool_use", id: "b", name: "contas_a_pagar", input: {} }] },
    { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "ok" }] },
  ]);
  const r = await conversarCom({}, { chave: "x", buscar, modelo: "m", sistema: "s", historico: [], pergunta: "?", ferramentas: [ferramenta("contas_a_pagar", { fornecedor: "JOAO", cpf: "529.982.247-25" })] });
  const [semPermissao, bloqueado] = pedidos[1].messages.at(-1).content;
  assert.match(semPermissao.content, /sem permissão/);
  assert.match(bloqueado.content, /bloqueado/);
  assert.doesNotMatch(bloqueado.content, /529\.982/);
  assert.deepEqual(r.fontes, [], "resultado bloqueado não vira fonte");
});

test("SARA: base no banco nasce desligada e só o proprietário liga", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610170012_sara_base.sql", import.meta.url), "utf8");
  assert.match(sql, /ligada boolean not null default false/);
  assert.match(sql, /if org is null or not public\.is_owner\(\) then raise exception 'Ligar a SARA/);
  assert.match(sql, /profile_id = public\.current_profile_id\(\) or public\.is_owner\(\) or public\.has_feature\('fundacao\.auditoria'\)/);
  const rota = readFileSync(new URL("../app/api/sara/[modulo]/route.ts", import.meta.url), "utf8");
  assert.match(rota, /if \(!access\.canModule\(sara\.feature\)\)/);
  assert.match(rota, /ferramentasDe\(\(f\) => access\.can\(f, "ver"\), sara\.ferramentas\)/);
  assert.doesNotMatch(readFileSync(new URL("../app/components/sara-painel.tsx", import.meta.url), "utf8"), /dangerouslySetInnerHTML/);
});

test("SARA: abrir tela só entre as permitidas, e o painel navega por dentro", async () => {
  const { ferramentaDeTelas } = await import("../lib/sara/ferramentas.ts");
  const telas = SARAS.financeiro.telas.filter((t) => t.exige.some((f) => ["financeiro.pagar"].includes(f)));
  assert.ok(telas.some((t) => t.id === "contas_a_pagar"));
  assert.ok(!telas.some((t) => t.id === "notas_emitidas"), "sem fiscal.nfe não abre a tela do Fiscal");
  const f = ferramentaDeTelas(telas);
  assert.deepEqual(f.esquema.properties.tela.enum.includes("notas_emitidas"), false);
  const r = await f.rodar({}, { tela: "contas_a_pagar" });
  assert.deepEqual(r.abrir, { modulo: "financeiro", secao: "Contas a pagar", rotulo: "Financeiro › Contas a pagar" });
  await assert.rejects(() => f.rodar({}, { tela: "notas_emitidas" }));
  assert.equal(ferramentaDeTelas([]), null);
  const painel = readFileSync(new URL("../app/components/sara-painel.tsx", import.meta.url), "utf8");
  assert.match(painel, /if \(r\.body\.abrir\) abrir\(r\.body\.abrir\)/);
  assert.match(painel, /navegar\(a\.modulo, a\.secao \?\? undefined\)/);
});


test("SARA: a parte fixa (ferramentas + manual + regras) e a última mensagem vão marcadas para o cache", async () => {
  const { buscar, pedidos } = claudeFalso([
    { stop_reason: "tool_use", usage: { input_tokens: 50, cache_creation_input_tokens: 3000, output_tokens: 10 }, content: [{ type: "tool_use", id: "t1", name: "contas_a_pagar", input: {} }] },
    { stop_reason: "end_turn", usage: { input_tokens: 80, cache_read_input_tokens: 3000, output_tokens: 20 }, content: [{ type: "text", text: "ok" }] },
  ]);
  const r = await conversarCom({}, { chave: "x", buscar, modelo: "m", sistema: { fixo: "manual e regras", variavel: "Hoje é sábado." }, historico: [], pergunta: "?", ferramentas: [ferramenta("contas_a_pagar", {})] });
  const [fixo, dia] = pedidos[0].system;
  assert.deepEqual(fixo, { type: "text", text: "manual e regras", cache_control: { type: "ephemeral" } });
  assert.equal(dia.cache_control, undefined, "a parte do dia não vai para o cache");
  assert.deepEqual(pedidos[0].messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" });
  assert.deepEqual(pedidos[1].messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" }, "a rodada seguinte marca o resultado da consulta");
  assert.equal(pedidos[1].messages.filter((m) => Array.isArray(m.content) && m.content.some((b) => b.cache_control)).length, 1, "só a última mensagem leva a marca");
  assert.equal(r.cacheGravado, 3000);
  assert.equal(r.cacheLido, 3000);
  assert.equal(r.tokensEntrada, 6130, "a entrada conta o que foi lido e gravado no cache");
});

test("SARA: busca o lançamento pelos termos e abre o detalhe exato, na aba onde ele está", async () => {
  const { FERRAMENTAS } = await import("../lib/sara/ferramentas.ts");
  const busca = FERRAMENTAS.find((f) => f.nome === "buscar_contas_a_pagar");
  let chamada;
  const sbBusca = { rpc: async (nome, args) => { chamada = { nome, args }; return { data: { quantidade: 7, lancamentos: [{ id: "665ffa26-ea4a-4702-ab24-ebd255a2ae6f", status: "settled", historico: "OC 12688 REF. JUROS CARENCIA FINAME" }] } }; } };
  const r = await busca.rodar(sbBusca, { termos: "grob  finame %", ordem: "ultimo_pago" });
  assert.equal(chamada.nome, "sara_buscar_lancamentos");
  assert.deepEqual(chamada.args, { p_direcao: "payable", p_termos: ["grob", "finame"], p_ordem: "ultimo_pago", p_limite: 5 });
  assert.equal(r.dados.lancamentos[0].status, "quitado");
  assert.match(r.dados.observacao, /Mostrando 1 de 7/);

  const abrir = FERRAMENTAS.find((f) => f.nome === "abrir_lancamento");
  const titulo = { id: "665ffa26-ea4a-4702-ab24-ebd255a2ae6f", direction: "payable", status: "settled", is_forecast: false, counterparty_name: "B GROB DO BRASIL", description: "FINAME",
    finance_installments: [{ finance_settlements: [{ settlement_date: "2026-09-15", reversed_at: null }, { settlement_date: "2026-10-01", reversed_at: "2026-10-02" }] }] };
  const sbTitulo = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: titulo, error: null }) }) }) }) };
  const a = await abrir.rodar(sbTitulo, { id: titulo.id });
  assert.deepEqual(a.abrir.registro, { tipo: "titulo", id: titulo.id, direcao: "payable", aba: "quitados", mes: "2026-09" }, "quitado abre na aba de quitados, no mês do último pagamento (estorno não conta)");
  assert.equal(a.abrir.secao, "Contas a pagar");
  await assert.rejects(abrir.rodar(sbTitulo, { id: "1; drop" }), /id inválido/);
  const nada = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  await assert.rejects(abrir.rodar(nada, { id: titulo.id }), /fora das permissões/);
});

test("SARA: a busca roda com as permissões de quem pergunta e a triagem do Clef saiu", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610170014_sara_buscar_lancamentos.sql", import.meta.url), "utf8");
  assert.match(sql, /security invoker/);
  assert.match(sql, /drop function if exists public\.sara_triagem_config/);
  assert.match(sql, /delete from public\.ai_uses where code = 'financeiro\.sara_triagem'/);
  assert.match(sql, /i\.due_date >= current_date\) proximo_vencimento/);
  const so = (fs) => (f) => fs.includes(f);
  assert.ok(!ferramentasDe(so(["financeiro.receber"]), SARAS.financeiro.ferramentas).some((f) => f.nome === "buscar_contas_a_pagar"), "sem contas a pagar, sem a busca de contas a pagar");
  const painel = readFileSync(new URL("../app/components/sara-painel.tsx", import.meta.url), "utf8");
  assert.match(painel, /if \(a\.registro\) pedirRegistro\(a\.registro\)/);
  assert.doesNotMatch(painel, /Clef/);
  assert.match(readFileSync(new URL("../app/components/finance-titles.tsx", import.meta.url), "utf8"), /tomarRegistro\(\(x\) => x\.tipo === "titulo" && x\.direcao === direction\)/);
});
