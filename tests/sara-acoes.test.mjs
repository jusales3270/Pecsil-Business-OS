import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { conversarCom, AVISO_PROPOSTA } = await import("../lib/sara/laco.ts");
const { ACOES, acoesDaSara } = await import("../lib/sara/acoes.ts");
const { custoUsd, cotacao, emReais, COTACAO_PADRAO } = await import("../lib/sara/custo.ts");

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

function claudeFalso(roteiro) {
  const pedidos = [];
  const buscar = async (_url, init) => {
    pedidos.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => roteiro[pedidos.length - 1] };
  };
  return { buscar, pedidos };
}

test("E1: ferramenta de ação só PREPARA — não executa, devolve a proposta e o modelo é avisado", async () => {
  let rodou = false;
  const acao = {
    nome: "pedir_material_fundicao", descricao: "t", exige: ["fundicao.pedidos"], esquema: { type: "object", properties: {} },
    rodar: async () => { rodou = true; return { dados: {}, fontes: [] }; },
    acao: { nivel: "operar", modulos: ["fundicao"], preparar: async (_sb, e) => ({ resumo: `Pedir ${e.itens.length} item`, detalhes: ["2 KG · Areia"] }) },
  };
  const { buscar, pedidos } = claudeFalso([
    { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", id: "a", name: "pedir_material_fundicao", input: { itens: [{ descricao: "Areia", quantidade: 2 }] } }] },
    { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "Preparei o pedido: toque em Permitir para enviar ao Compras." }] },
  ]);
  const r = await conversarCom({}, { chave: "x", buscar, modelo: "m", sistema: "s", historico: [], pergunta: "pede 2 kg de areia", ferramentas: [acao] });
  assert.equal(rodou, false, "nada é gravado sem o Permitir");
  assert.deepEqual(r.acoes, [{ resumo: "Pedir 1 item", detalhes: ["2 KG · Areia"], ferramenta: "pedir_material_fundicao", entrada: { itens: [{ descricao: "Areia", quantidade: 2 }] } }]);
  assert.match(pedidos[1].messages.at(-1).content[0].content, /NADA foi feito ainda/);
  assert.ok(AVISO_PROPOSTA.includes("Não diga que já fez"));
  assert.match(r.texto, /Permitir/);
});

test("E1: entrada incompleta volta ao modelo como erro (para ele perguntar), sem proposta", async () => {
  const acao = { ...ACOES.find((a) => a.nome === "pedir_material_fundicao") };
  const { buscar, pedidos } = claudeFalso([
    { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", id: "a", name: "pedir_material_fundicao", input: { itens: [{ descricao: "Areia" }] } }] },
    { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "Quantos quilos?" }] },
  ]);
  const r = await conversarCom({}, { chave: "x", buscar, modelo: "m", sistema: "s", historico: [], pergunta: "pede areia", ferramentas: [acao] });
  assert.equal(r.acoes.length, 0);
  assert.match(pedidos[1].messages.at(-1).content[0].content, /Falta a quantidade/);
});

test("E1: cada SARA só oferece as ações do módulo dela, e só a quem tem o nível exigido", () => {
  const pode = (lista) => (f, nivel) => lista.includes(`${f}:${nivel}`);
  const nomes = (m, lista) => acoesDaSara(m, pode(lista)).map((f) => f.nome).sort();
  assert.deepEqual(nomes("fundicao", ["fundicao.pedidos:operar", "fundicao.biblioteca:operar"]), ["abrir_chamado_ti", "anotar_na_biblioteca", "pedir_material_fundicao"]);
  assert.deepEqual(nomes("fundicao", []), ["abrir_chamado_ti"], "chamado de TI qualquer pessoa abre");
  assert.deepEqual(nomes("almoxarifado", ["almoxarifado.solicitacoes:operar", "fundicao.pedidos:operar"]), ["abrir_chamado_ti", "pedir_material"]);
  assert.deepEqual(nomes("financeiro", ["financeiro.pagar:aprovar"]), ["abrir_chamado_ti"], "aprovar título não é ação da SARA (ainda)");
  for (const a of ACOES) assert.ok(a.acao && /^PREPARA/.test(a.descricao), `${a.nome}: a descrição diz que só prepara`);
});

test("E1: cada ação chama a MESMA função do banco que a tela usa", () => {
  const src = ler("lib/sara/acoes.ts");
  for (const rpc of ["almoxarifado_criar_solicitacao", "fundicao_criar_pedido", "ti_abrir_chamado", "fundicao_nota_gravar"]) assert.match(src, new RegExp(`sb\\.rpc\\("${rpc}"`));
  assert.doesNotMatch(src, /createSupabaseAdminClient|SERVICE_ROLE/);
});

test("E1: banco — só quem pediu decide, vence em 15 min, executa uma vez e fica no histórico", () => {
  const m = ler("supabase/migrations/202610220001_sara_acoes.sql");
  assert.match(m, /expira_em timestamptz not null default now\(\) \+ interval '15 minutes'/);
  assert.match(m, /if a\.profile_id is distinct from me then raise exception 'Só quem pediu à SARA pode permitir/);
  assert.match(m, /if a\.situacao <> 'pendente' then raise exception 'Esta ação já foi decidida/);
  assert.match(m, /if a\.expira_em < now\(\) then/);
  assert.match(m, /for update;/, "a decisão trava a linha (sem duplo clique executando duas vezes)");
  assert.match(m, /'sara\.acao\.executada'/);
  assert.match(m, /'sara\.acao\.recusada'/);
  assert.match(m, /revoke insert, update, delete on public\.sara_acoes from anon, authenticated/);
});

test("E1: rota da decisão roda com a sessão de quem permitiu; painel mostra Permitir / Não permitir", () => {
  const rota = ler("app/api/sara/[modulo]/acoes/[id]/route.ts");
  assert.doesNotMatch(rota, /createSupabaseAdminClient|SERVICE_ROLE/);
  assert.match(rota, /sara_acao_decidir/);
  assert.ok(rota.indexOf("sara_acao_decidir") < rota.indexOf("f.rodar(p.sb"), "decide antes de executar");
  assert.match(rota, /x\.acao/, "só executa ferramenta de ação que a pessoa ainda pode usar");
  const painel = ler("app/components/sara-painel.tsx");
  assert.match(painel, />Não permitir</);
  assert.match(painel, /"Confirmar" : "Permitir"/, "risco alto pede segundo toque");
  assert.doesNotMatch(painel, /não grava nada/);
  const regras = ler("lib/sara/modulos.ts");
  assert.match(regras, /Nunca diga que já fez/);
});

test("E4: custo em R$ pelos tokens, com o desconto do cache; dólar ajustável", () => {
  // Haiku 5.5: 1M de entrada comum = US$ 0,10; 1M de saída = US$ 0,50.
  assert.equal(custoUsd({ modelo: "claude-haiku-5-5", tokens_entrada: 1_000_000, tokens_saida: 1_000_000, cache_lido: 0, cache_gravado: 0 }).toFixed(4), "0.6000");
  // Cache lido custa 0,1× e gravado 1,25× (entrada total já inclui os dois).
  assert.equal(custoUsd({ modelo: "claude-sonnet-5-5", tokens_entrada: 2_000_000, tokens_saida: 0, cache_lido: 1_000_000, cache_gravado: 1_000_000 }).toFixed(4), (2 * 0.1 + 2 * 1.25).toFixed(4));
  assert.ok(custoUsd({ modelo: "desconhecido", tokens_entrada: 1_000_000, tokens_saida: 0, cache_lido: 0, cache_gravado: 0 }) >= 2, "modelo sem preço não esconde custo");
  assert.equal(cotacao("5,80"), 5.8);
  assert.equal(cotacao("abc"), COTACAO_PADRAO);
  assert.equal(emReais(1, 5.5), 5.5);
  const tela = ler("app/components/sara-aprendizado.tsx");
  assert.match(tela, /Quem usa a SARA não vê estes números/);
  const m = ler("supabase/migrations/202610220001_sara_acoes.sql");
  assert.match(m, /if not \(public\.is_owner\(\) or public\.has_feature\('fundacao\.auditoria'\)\) then/);
  assert.match(m, /uso < teto \* 0\.8/);
  assert.match(m, /event_type = 'sara\.teto\.alerta' and entity_id = chave/, "avisa uma vez por mês e módulo");
});

test("Degrau 3: pedido rejeitado vira aviso com 'Refazer o pedido' pronto, com os mesmos itens", async () => {
  const { refazerPedido } = await import("../lib/sara/acoes.ts");
  const p = { numero: 27, urgencia: "urgente", divisao: "FUNDICAO", cancel_reason: "sem verba",
    material_request_items: [{ produto: "8-04-00184 · ELETRODO", quantidade: 2, unidade: "KG", material_id: "11111111-1111-4111-8111-111111111111" }] };
  const r = refazerPedido(p, "pedir_material");
  assert.equal(r.rotulo, "Refazer o pedido");
  assert.equal(r.entrada.divisao, "FUNDICAO");
  assert.equal(r.entrada.urgente, true);
  assert.equal(r.entrada.itens[0].material_id, "11111111-1111-4111-8111-111111111111");
  assert.match(r.entrada.observacao, /nº 27.*sem verba/);
  assert.equal(refazerPedido({ ...p, material_request_items: [] }, "pedir_material_fundicao"), undefined, "sem itens, sem ação");
  const fund = ler("lib/sara/agentes/fundicao.ts"), almox = ler("lib/sara/agentes/almoxarifado.ts");
  assert.match(fund, /refazerPedido\(p, "pedir_material_fundicao"\)/);
  assert.match(almox, /refazerPedido\(p, "pedir_material"\)/);
});

test("Degrau 3: a ação do aviso só vai a quem pode, a entrada fica no servidor, e nada é feito sem Permitir", () => {
  const avisos = ler("app/api/sara/[modulo]/alertas/route.ts");
  assert.match(avisos, /propor && podeFazer\.has\(propor\.ferramenta\) \? \{ propor: \{ rotulo: propor\.rotulo \} \}/, "a tela recebe só o rótulo");
  const rota = ler("app/api/sara/[modulo]/propor/route.ts");
  assert.doesNotMatch(rota, /createSupabaseAdminClient|SERVICE_ROLE|\.rodar\(/, "prepara, não executa");
  assert.match(rota, /alertasDo\(modulo, p\.sb/, "recalcula o aviso com a sessão da pessoa (a tela manda só a chave)");
  assert.match(rota, /sara_acao_propor/);
  assert.doesNotMatch(rota, /conversar|api\.anthropic/, "sem chamar o modelo");
  const painel = ler("app/components/sara-painel.tsx");
  assert.match(painel, /prepararDoAviso/);
  assert.match(painel, /<CartaoAcao c=\{cartoesAviso\[a\.chave\]\}/);
});

test("Degrau 3: pedido já refeito não oferece 'Refazer' de novo", async () => {
  const { jaRefeitos } = await import("../lib/sara/acoes.ts");
  assert.deepEqual([...jaRefeitos([{ observacao: "Refaz o pedido nº 28, rejeitado pelo Compras." }, { observacao: "outra" }, {}])], [28]);
  assert.match(ler("lib/sara/agentes/fundicao.ts"), /propor: refeitos\.has\(p\.numero\) \? undefined/);
  assert.match(ler("lib/sara/agentes/almoxarifado.ts"), /propor: refeitos\.has\(p\.numero\) \? undefined/);
});

test("E2: a foto vai ao modelo como imagem junto da pergunta, e não fica guardada", async () => {
  const { buscar, pedidos } = claudeFalso([{ stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "Li na etiqueta: 8-04-00184." }] }]);
  await conversarCom({}, { chave: "x", buscar, modelo: "m", sistema: "s", historico: [], pergunta: "o que é?", ferramentas: [], imagem: { tipo: "image/jpeg", dados: "QUJD" } });
  const ultima = pedidos[0].messages.at(-1).content;
  assert.equal(ultima[0].type, "image");
  assert.deepEqual(ultima[0].source, { type: "base64", media_type: "image/jpeg", data: "QUJD" });
  assert.equal(ultima[1].text, "o que é?");
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /const TIPOS_FOTO = \["image\/jpeg", "image\/png", "image\/webp"\]/);
  assert.match(rota, /dados\.length > 5_400_000/, "limite de tamanho da foto");
  assert.match(rota, /p_pergunta: imagem \? `📷 \$\{pergunta\}` : pergunta/, "na conversa fica só a marca da foto, não a imagem");
  assert.match(ler("lib/sara/modulos.ts"), /Nunca invente código que não está na foto/);
});

test("E2: no celular, foto pela câmera (reduzida no aparelho) e leitor de código de barras/QR", () => {
  const painel = ler("app/components/sara-painel.tsx");
  assert.match(painel, /accept="image\/\*" capture="environment"/);
  assert.match(painel, /1568 \/ Math\.max\(img\.width, img\.height\)/, "reduz antes de enviar");
  assert.match(painel, /BarcodeDetector/);
  assert.match(painel, /facingMode: "environment"/);
  assert.match(painel, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/, "a câmera desliga ao ler ou fechar");
  assert.match(painel, /Código lido: \$\{valor\}/);
  assert.match(painel, /Tire uma foto da etiqueta/, "sem leitor no aparelho, orienta usar a foto");
});
