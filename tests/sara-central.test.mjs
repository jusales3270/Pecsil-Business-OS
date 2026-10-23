import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { conferirNumeros, marcarSemFonte, numerosDoTexto } from "../lib/sara/central/verificador.ts";
import { ferramentaPerguntarASara, FORA_DA_SUBAGENTE } from "../lib/sara/central/subagente.ts";
import { SARA_CENTRAL } from "../lib/sara/central/sara.ts";

const { conversarCom } = await import("../lib/sara/laco.ts");
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("verificador: lê valores, quantidades e percentuais; ignora datas, horas, anos e dígitos soltos", () => {
  const v = numerosDoTexto("Em 22/10/2026, às 08:30, havia 2 pedidos (nº 21 e nº 20), R$ 1.234,56 a pagar, 12,5% do caixa e R$ 1,2 milhão previsto em 2026.");
  assert.deepEqual(v.map((x) => x.valor), [21, 20, 1234.56, 12.5, 1200000]);
});

test("verificador: confere com o que as áreas devolveram, inclusive arredondado", () => {
  const fontes = [{ area: "Financeiro", resposta: "Saldo previsto: R$ 1.234.567,89; vencidos: R$ 48.200,00 (12,4% do total)." }, { resultado: 61 }];
  const ok = conferirNumeros("O caixa fecha o mês com R$ 1,2 milhão; os vencidos somam R$ 48.200 (12% do total) e são 61 títulos.", fontes);
  assert.deepEqual(ok.semFonte, []);
  const ruim = conferirNumeros("Vencidos: R$ 52.000, em 17 títulos.", fontes);
  assert.deepEqual(ruim.semFonte, ["R$ 52.000", "17"]);
  const marcado = marcarSemFonte("Vencidos: R$ 52.000.", ruim);
  assert.match(marcado, /⚠️ Sem fonte conferida: R\$ 52\.000, 17\. Confira antes de usar esses números\./);
  assert.equal(marcarSemFonte("Tudo certo.", ok), "Tudo certo.");
});

test("subagente: só as áreas que a pessoa pode usar; roda em paralelo; erro da área não derruba a central", async () => {
  const usos = [], visuaisGuardados = [];
  const f = ferramentaPerguntarASara([{ modulo: "financeiro", rotulo: "Financeiro" }], async (_sb, modulo, pergunta) => ({
    texto: `Resposta de ${modulo}: ${pergunta}`, fontes: [{ rotulo: "Financeiro › Contas a pagar", link: "/?module=financeiro" }], consultas: ["contas a pagar"],
    uso: { modulo, modelo: "claude-haiku-5-5", tokensEntrada: 10, tokensSaida: 2, cacheLido: 0, cacheGravado: 0, ok: true },
    visuais: [{ componente: "barras", titulo: "Vencimentos por semana" }] }), usos, visuaisGuardados);
  assert.equal(f.paralela, true);
  assert.deepEqual(f.esquema.properties.modulo.enum, ["financeiro"]);
  const sem = await f.rodar(null, { modulo: "rh", pergunta: "férias vencidas?" });
  assert.match(sem.dados.erro, /Sem permissão para a SARA de "rh"/);
  const r = await f.rodar(null, { modulo: "financeiro", pergunta: "o que vence esta semana?" });
  assert.equal(r.dados.area, "Financeiro");
  assert.equal(r.fontes.length, 1);
  assert.equal(usos.length, 1);
  assert.equal(visuaisGuardados.length, 1, "o gráfico da área volta para a central apresentar");
  assert.match(r.dados.apresentado_na_tela, /a plataforma mostra na tela/);
  const falha = ferramentaPerguntarASara([{ modulo: "compras", rotulo: "Compras" }], async () => { throw new Error("caiu"); }, usos);
  const rf = await falha.rodar(null, { modulo: "compras", pergunta: "cotações?" });
  assert.match(rf.dados.erro, /não respondeu: caiu/);
  // A subagente não age, não navega e não propõe; o gráfico ela monta e devolve à central.
  for (const n of ["abrir_tela", "abrir_lancamento", "propor_habilidade", "criar_guia", "registrar_lacuna"]) assert.ok(FORA_DA_SUBAGENTE.has(n), n);
  assert.ok(!FORA_DA_SUBAGENTE.has("mostrar"));
});

test("laço: chamadas paralelas rodam juntas (e voltam na ordem pedida)", async () => {
  let rodada = 0;
  const buscar = async () => {
    rodada++;
    const content = rodada === 1
      ? [{ type: "tool_use", id: "a", name: "lenta_a", input: {} }, { type: "tool_use", id: "b", name: "lenta_b", input: {} }]
      : [{ type: "text", text: "Pronto." }];
    return { ok: true, status: 200, json: async () => ({ content, stop_reason: rodada === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }) };
  };
  const ordem = [];
  const lenta = (nome) => ({ nome, descricao: nome, exige: [], esquema: { type: "object" }, paralela: true,
    rodar: async () => { ordem.push(`${nome}:inicio`); await new Promise((r) => setTimeout(r, 150)); ordem.push(`${nome}:fim`); return { dados: { nome, valor: 42 }, fontes: [] }; } });
  const t0 = Date.now();
  const r = await conversarCom({}, { chave: "x", buscar, modelo: "claude-sonnet-5-5", sistema: "s", historico: [], pergunta: "?", ferramentas: [lenta("lenta_a"), lenta("lenta_b")] });
  const ms = Date.now() - t0;
  assert.ok(ms < 290, `rodou em paralelo (${ms} ms)`);
  assert.deepEqual(ordem.slice(0, 2), ["lenta_a:inicio", "lenta_b:inicio"]);
  assert.deepEqual(r.ferramentas.map((f) => f.nome), ["lenta_a", "lenta_b"]);
  assert.deepEqual(r.resultados.map((x) => x.dados.nome), ["lenta_a", "lenta_b"], "o resultado de cada consulta vai para o verificador");
});

test("SARA central: na War Room, Sonnet, sem consulta direta, com o verificador na rota e a permissão própria", () => {
  assert.equal(SARA_CENTRAL.modulo, "warroom");
  assert.equal(SARA_CENTRAL.permissao, "warroom.sara");
  assert.equal(SARA_CENTRAL.central, true);
  assert.equal(SARA_CENTRAL.modelo, "claude-sonnet-5-5");
  assert.deepEqual(SARA_CENTRAL.ferramentas, []);
  assert.match(SARA_CENTRAL.manual, /quem decide é a área/i);
  const sessao = ler("lib/sara/sessao.ts");
  assert.match(sessao, /if \(sara\.central\) \{/);
  assert.match(sessao, /ferramentaPerguntarASara\(areas, rodarSubagente, subagentes, visuaisSubagentes\), CALCULAR, PERIODO/);
  assert.match(sessao, /access\.canModule\(x\.feature\) && access\.can\(x\.permissao, "ver"\)/, "só as áreas da pessoa");
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /if \(p\.sara\.central && !fora\) \{\s*conferencia = conferirNumeros/);
  const sql = ler("supabase/migrations/202610230002_sara_central.sql");
  assert.match(sql, /\('warroom\.sara', 'warroom', 'SARA central \(conselho\)', '\{ver\}', 20\)/);
  assert.match(sql, /'claude-sonnet-5-5', 60000000/);
});

test("holograma: fala o essencial (sem tabela, lista nem marcação) e sempre o aviso do verificador", async () => {
  const { resumoFalado } = await import("../lib/sara/central/fala.ts");
  const texto = "**O caixa aperta na semana que vem.** A Fundição tem 2 pedidos parados há 6 dias, e o faturamento de R$ 48.200 depende deles.\n\n| Área | Situação |\n|---|---|\n| Fundição | 2 pedidos |\n\n- Pedido nº 20\n- Pedido nº 21\n\nQuem decide: Guilherme e Ana. Recomendo cobrar o Compras hoje. Outra frase longa sobre o resto da análise.\n\n⚠️ Sem fonte conferida: R$ 52.000. Confira antes de usar esse número.";
  const f = resumoFalado(texto);
  assert.match(f, /^O caixa aperta na semana que vem\. A Fundição tem 2 pedidos parados há 6 dias/);
  assert.doesNotMatch(f, /\||\*\*|Pedido nº 20/);
  assert.match(f, /O detalhe está no painel\./);
  assert.match(f, /Atenção: Sem fonte conferida: R\$ 52\.000\.$/);
  assert.equal(resumoFalado("| a | b |\n|---|---|\n| 1 | 2 |"), "A resposta está no painel ao lado.");
  assert.ok(resumoFalado("x ".repeat(600)).length <= 460);
});

test("holograma: ouve pelo Whisper da plataforma e fala só com voz do aparelho (nada da empresa vai a serviço externo)", () => {
  const c = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(c, /fetch\("\/api\/sara\/warroom\/voz"/, "o áudio vai para o Whisper da plataforma");
  assert.doesNotMatch(c, /SpeechRecognition/, "sem o reconhecimento do navegador (manda o áudio ao Google)");
  assert.match(c, /\.filter\(\(v\) => v\.localService\)/, "só voz instalada no aparelho");
  assert.doesNotMatch(c, /api\.anthropic\.com|VITE_|import\.meta\.env/, "sem chamada direta ao modelo nem configuração do projeto de origem");
  assert.match(c, /fetch\("\/api\/sara\/warroom", \{ method: "POST"/, "conversa pela SARA central, com a sessão da pessoa");
  const page = ler("app/page.tsx");
  assert.match(page, /canUseFeature\(access,"warroom\.sara","ver"\)&&<SaraHolograma naWarRoom=\{activeModuleId==="warroom"\}/, "montada no app, só para quem tem a SARA central");
  assert.doesNotMatch(ler("modules/warroom/src/WarRoomApp.tsx"), /<SaraHolograma/, "não dentro da War Room (some ao trocar de módulo)");
  assert.match(page, /!SARAS\[sara\]\.central&&!deniedTarget\?<SaraPainel/, "na War Room, a janela comum dá lugar ao holograma");
  assert.match(page, /Boolean\(!SARAS\[id\]\.central && m && canAccessModule/, "o atalho SARA do ícone não cai na central");
});

test("CEO apresentando: navega pelas telas das áreas, minimiza para mostrar e apresenta os gráficos das áreas", () => {
  const c = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(c, /CEO · SISTEMA ATIVO/);
  assert.match(c, /if \(abrir \|\| visuais\.length\) \{[\s\S]*setModo\("mini"\)[\s\S]*navegar\(abrir\.modulo/, "minimiza e abre a tela");
  assert.match(c, /setPalco\(visuais\)/, "apresenta os gráficos no palco");
  assert.match(c, /if \(!naWarRoom && modo === "fechado"\) return null;/, "fora da War Room, só quando está trabalhando");
  const sessao = ler("lib/sara/sessao.ts");
  assert.match(sessao, /const navegarCentral = ferramentaDeTelas\(/, "telas de todas as áreas da pessoa");
  assert.match(sessao, /f\.nome === "abrir_lancamento" && f\.exige\.some\(pode\)/);
  assert.match(ler("app/api/sara/[modulo]/route.ts"), /visuais: \[\.\.\.r\.visuais, \.\.\.p\.visuaisSubagentes\]\.slice\(0, 4\)/);
  assert.match(SARA_CENTRAL.manual, /apresentando à diretoria/);
});
