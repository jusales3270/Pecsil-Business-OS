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
  assert.match(sessao, /ferramentaPerguntarASara\(areas, rodarSubagente, subagentes, visuaisSubagentes, documentos\.fontes\), calcular, PERIODO/);
  assert.match(sessao, /const calcular: Ferramenta = \{ \.\.\.CALCULAR, rotulo: "conta da plataforma com os números das áreas", rodar: async \(sb, e\) => \{[\s\S]*documentos\.fontes\.push\(\{ resultados: resultados\.filter/, "a conta (com fonte) vira fonte dos documentos");
  assert.match(sessao, /access\.canModule\(x\.feature\) && access\.can\(x\.permissao, "ver"\)/, "só as áreas da pessoa");
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /if \(p\.sara\.central && !fora\) \{[^}]*conferencia = conferirNumeros\(r\.texto, \[\.\.\.\(r\.resultados \?\? \[\]\)\.map\(\(x\) => x\.dados\), \.\.\.fontesDaConversa/);
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
  assert.equal(resumoFalado("Boa noite, Senhor.\n\nHá 394 contas vencidas, somando R$ 1.330.419,47."), "Há 394 contas vencidas, somando R$ 1.330.419,47. O detalhe está no painel.", "o parágrafo só de cumprimento não é a fala");
  assert.ok(resumoFalado("x ".repeat(600)).length <= 460);
});

test("holograma: a voz é só a do Grok (Realtime, luna); sem ela, só a legenda e o Whisper da plataforma", () => {
  const c = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(c, /fetch\("\/api\/sara\/warroom\/voz"/, "sem a sessão de voz, o áudio vai para o Whisper da plataforma");
  assert.doesNotMatch(c, /SpeechRecognition/, "sem o reconhecimento do navegador (manda o áudio ao Google)");
  assert.doesNotMatch(c, /speechSynthesis|SpeechSynthesisUtterance/, "nunca a voz do navegador");
  assert.match(c, /void garantirVoz\(\)\.then\(\(v\) => \{ if \(esta !== falaAtual\.current\) return; if \(v\) v\.falar\(texto\); else soLegenda\(\); \}\);/, "toda fala pela sessão do Grok");
  assert.match(c, /\/\/ A voz abre já no toque de invocar[^\n]*\n\s*void garantirVoz\(\);/, "a sessão abre ao invocar (o cumprimento já sai na luna)");
  assert.match(c, /if \(v\.escutando\(\)\) \{ v\.desligarMicrofone\(\); setAoVivo\(false\); return; \}/, "o microfone liga e desliga dentro da sessão");
  assert.doesNotMatch(c, /api\.anthropic\.com|VITE_|import\.meta\.env/, "sem chamada direta ao modelo nem configuração do projeto de origem");
  assert.match(c, /const modulo = area && \/\^\[a-z_\]\{2,30\}\$\/\.test\(area\) \? area : "warroom";/, "sem área, conversa pela SARA central");
  // Desde 24/10 com os passos ao vivo (perguntarComPassos faz o POST com a mesma sessão).
  assert.match(c, /perguntarComPassos\(`\/api\/sara\/\$\{modulo\}`/, "com a sessão da pessoa");
  const page = ler("app/page.tsx");
  assert.match(page, /canUseFeature\(access,"warroom\.sara","ver"\)&&<SaraHolograma naWarRoom=\{activeModuleId==="warroom"\}/, "montada no app, só para quem tem a SARA central");
  assert.doesNotMatch(ler("modules/warroom/src/WarRoomApp.tsx"), /<SaraHolograma/, "não dentro da War Room (some ao trocar de módulo)");
  assert.match(page, /!SARAS\[sara\]\.central&&!deniedTarget\?<SaraPainel/, "na War Room, a janela comum dá lugar ao holograma");
  assert.match(page, /Boolean\(!SARAS\[id\]\.central && m && canAccessModule/, "o atalho SARA do ícone não cai na central");
});

test("CEO apresentando: navega pelas telas das áreas, minimiza para mostrar e apresenta os gráficos das áreas", () => {
  const c = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(c, /CEO · SISTEMA ATIVO/);
  assert.match(c, /const apresentar = useCallback\(\(abrir: Abrir \| null, visuais: Visual\[\]\) => \{[\s\S]*setModo\("mini"\)[\s\S]*navegar\(abrir\.modulo/, "minimiza e abre a tela");
  assert.match(c, /apresentar\(j\.abrir \?\? null, j\.visuais \?\? \[\]\)/, "toda resposta da central passa pela apresentação (digitada ou por voz)");
  assert.match(c, /setPalco\(visuais\)/, "apresenta os gráficos no palco");
  assert.match(c, /if \(!naWarRoom && modo === "fechado"\) return null;/, "fora da War Room, só quando está trabalhando");
  const sessao = ler("lib/sara/sessao.ts");
  assert.match(sessao, /const navegarCentral = ferramentaDeTelas\(/, "telas de todas as áreas da pessoa");
  assert.match(sessao, /f\.nome === "abrir_lancamento" && f\.exige\.some\(pode\)/);
  assert.match(ler("app/api/sara/[modulo]/route.ts"), /visuais: \[\.\.\.r\.visuais, \.\.\.p\.visuaisSubagentes\]\.slice\(0, 8\)/);
  assert.match(SARA_CENTRAL.manual, /apresentando à diretoria/);
});

test("gráfico de barras por categoria: parcelas do mesmo fornecedor viram uma barra só, e o top N mostra N", async () => {
  const { resolverVisual } = await import("../lib/sara/visual.ts");
  const resultados = [{ nome: "contas_a_pagar", rotulo: "contas a pagar", fontes: [], dados: { maiores_primeiro: [
    { fornecedor: "OTZI METALS", em_aberto: 63000 }, { fornecedor: "OTZI METALS", em_aberto: 42000 }, { fornecedor: "CMBA", em_aberto: 9541 },
    { fornecedor: "HAIMER", em_aberto: 8990.97 }, { fornecedor: "CMBA", em_aberto: 8304 }, { fornecedor: "RSA", em_aberto: 8251 }, { fornecedor: "RICARDO", em_aberto: 5000 },
  ] } }];
  const r = resolverVisual({ componente: "barras", titulo: "Top 3", consulta: "contas_a_pagar", caminho: "maiores_primeiro", rotulo: "fornecedor", valor: "em_aberto", maximo: 3 }, resultados);
  assert.deepEqual(r.visual.pontos, [{ rotulo: "OTZI METALS", valor: 105000 }, { rotulo: "CMBA", valor: 17845 }, { rotulo: "HAIMER", valor: 8990.97 }]);
  const semMax = resolverVisual({ componente: "barras", titulo: "Todos", consulta: "contas_a_pagar", caminho: "maiores_primeiro", rotulo: "fornecedor", valor: "em_aberto" }, resultados);
  assert.equal(semMax.visual.pontos.length, 5, "5 fornecedores, não 7 parcelas");
  const linha = resolverVisual({ componente: "linha", titulo: "Série", consulta: "contas_a_pagar", caminho: "maiores_primeiro", rotulo: "fornecedor", valor: "em_aberto" }, resultados);
  assert.equal(linha.visual.pontos.length, 7, "série no tempo fica como veio");
  // Já somado (mapa), fora de ordem: barras sai do maior para o menor.
  const mapa = resolverVisual({ componente: "barras", titulo: "Mapa", consulta: "somas", caminho: "por_fornecedor" }, [{ nome: "somas", rotulo: "somas", fontes: [], dados: { por_fornecedor: { HAIMER: 8990.97, RSA: 16261.5, OTZI: 154219.44 } } }]);
  assert.deepEqual(mapa.visual.pontos.map((x) => x.valor), [154219.44, 16261.5, 8990.97]);
});

test("holograma: a fala antiga não derruba o estado da pergunta nova", () => {
  const c = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(c, /const esta = \+\+falaAtual\.current;/);
  assert.match(c, /if \(esta !== falaAtual\.current\) \{ clearInterval\(relogio\); return; \}/);
  assert.match(c, /const pararFala = useCallback\(\(\) => \{\s*falaAtual\.current\+\+;/);
});

test("voz ao vivo (Grok): luna em pt-BR, só funções da plataforma, números ditos exatamente como a central conferiu", async () => {
  const v = await import("../lib/sara/central/voz-ao-vivo.ts");
  assert.equal(v.VOZ_DA_SARA, "luna");
  const s = v.sessaoDeVoz({ instrucoes: "x", termos: ["PecSil"] });
  assert.equal(s.voice, "luna");
  assert.equal(s.audio.input.transcription.language_hint, "pt-BR");
  assert.deepEqual(s.audio.input.format, { type: "audio/pcm", rate: 24000 });
  assert.deepEqual(s.tools.map((t) => t.name), ["consultar_sara_central", "minimizar", "tela_cheia", "proximo_visual", "visual_anterior", "fechar_apresentacao"]);
  assert.ok(s.tools.every((t) => t.type === "function"), "sem busca na internet nem outras ferramentas do Grok");
  const ins = v.instrucoesDeVoz({ empresa: "Empresa X", nome: "Júnior", quemDecide: "Financeiro: Ana" });
  assert.match(ins, /português do Brasil/);
  assert.match(ins, /nunca diga um número, nome ou situação que não veio da central/);
  assert.match(ins, /quem decide é a área/);
  assert.deepEqual(v.termosChave([["PecSil", "pecsil", " Ana "], ["x"], ["Fundição"]]), ["PecSil", "Ana", "Fundição"]);
  assert.equal(v.termosChave([Array.from({ length: 150 }, (_, i) => `termo ${i}`)]).length, 100);
  assert.equal(v.extrairToken({ value: "a".repeat(20) }), "a".repeat(20));
  assert.equal(v.extrairToken({ client_secret: { value: "b".repeat(20) } }), "b".repeat(20));
  assert.equal(v.extrairToken({ nada: 1 }), null);
  assert.ok(v.vozExiste({ voices: [{ voice_id: "eve" }, { voice_id: "Luna" }] }, "luna"));
  assert.ok(!v.vozExiste({ voices: [{ voice_id: "eve" }] }, "luna"));

  // Roteamento (23/10): pergunta de uma área vai direto à SARA dela; várias áreas, documento e voz, à central.
  const areas = [{ modulo: "financeiro", rotulo: "Financeiro" }, { modulo: "rh", rotulo: "RH" }];
  const comAreas = v.sessaoDeVoz({ instrucoes: "x", termos: [], areas });
  assert.equal(comAreas.tools[0].name, "perguntar_a_area");
  assert.deepEqual(comAreas.tools[0].parameters.properties.area.enum, ["financeiro", "rh"], "só as áreas que a pessoa pode usar");
  assert.deepEqual(comAreas.tools[0].parameters.required, ["area", "pergunta"]);
  assert.ok(comAreas.tools.some((t) => t.name === "consultar_sara_central"));
  const insAreas = v.instrucoesDeVoz({ empresa: "X", nome: "A", quemDecide: "", areas });
  assert.match(insAreas, /cabe numa área só[\s\S]*perguntar_a_area/);
  assert.match(insAreas, /mais de uma área[\s\S]*consultar_sara_central/);
  assert.match(insAreas, /pergunta completa/);
  assert.match(insAreas, /nunca diga um número, nome ou situação que não veio delas/);
  const holoVoz = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(holoVoz, /nome === "perguntar_a_area"/);
  assert.match(holoVoz, /(fetch|perguntarComPassos)\(`\/api\/sara\/\$\{modulo\}`/, "a área responde pela rota dela (permissão, verificador e registro)");
  assert.match(holoVoz, /v\.perguntar\(pergunta\)/, "pergunta digitada passa pelo Grok, que roteia");

  const rota = ler("app/api/sara/[modulo]/voz-ao-vivo/route.ts");
  assert.match(rota, /p\.access\.can\(s\.permissao, "ver"\)/, "área só com a permissão da SARA dela");
  assert.match(rota, /if \(!SARAS\[modulo\]\?\.central\)/, "só a central fala ao vivo");
  assert.match(rota, /const p = await preparar\(modulo\);/, "com a permissão da pessoa");
  assert.match(rota, /process\.env\.XAI_API_KEY/);
  assert.match(rota, /expires_after: \{ seconds: 300 \}/, "token temporário de 5 minutos");
  assert.match(rota, /vozExiste\(lista, VOZ_DA_SARA\)/, "não troca de voz calada");
  assert.doesNotMatch(rota, /NEXT_PUBLIC_XAI/, "a chave não vai para o navegador");
  assert.match(rota, /return NextResponse\.json\(\{ token, url: URL_VOZ_AO_VIVO, sessao \}\);/, "o navegador recebe só o token temporário, o endereço e a sessão");

  const motor = ler("modules/warroom/src/holograma/voz-ao-vivo.ts");
  assert.match(motor, /\[`xai-client-secret\.\$\{j\.token\}`\]/, "token no subprotocolo, como a xAI pede para navegador");
  assert.match(motor, /type: "force_message", role: "assistant", content: \[\{ type: "output_text", text: dizer \}\]/, "a resposta conferida é dita exatamente");
  assert.match(motor, /const falar = \(texto: string\) => \{[\s\S]*type: "force_message", role: "assistant", content: \[\{ type: "output_text", text: t \}\]/, "o texto digitado também sai pela voz do Grok, exato");
  assert.match(motor, /if \(o\.microfone\) await ligarMicrofone\(\)/, "a sessão abre sem o microfone (só fala)");
  assert.match(motor, /tipo === "response\.function_call_arguments\.done"\) \{ executarChamada\(/, "executa a função na chegada (agindo enquanto fala)");
  assert.match(motor, /type: "function_call_output", call_id: callId/);
  const holo = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(holo, /if \(nome === "consultar_sara_central"\) \{[\s\S]*await consultar\(/, "o cérebro continua sendo a SARA central");
  assert.match(holo, /\.catch\(\(e\) => \{ console\.warn\("\[sara\] voz da SARA indisponível"[^\n]*setSemVoz\(true\); return null; \}\)/, "sem a chave, só legenda e Whisper");
});

test("painel da central: monta com mostrar a partir das consultas das áreas e da calculadora; conta sem fonte é recusada", async () => {
  const { semFonteNaConta } = await import("../lib/sara/central/verificador.ts");
  const fontes = [{ area: "Financeiro", resposta: "Recebido de jul a set: R$ 2.345.678,90; outubro: R$ 812.345,10." }];
  assert.deepEqual(semFonteNaConta("2345678,90 + 812345,10", fontes), [], "parcelas que vieram da área");
  assert.deepEqual(semFonteNaConta("812345.10 * 3 / 100", fontes), [], "constantes (3, 100) não precisam de fonte");
  assert.deepEqual(semFonteNaConta("100000*(1+0,0185)^12", fontes), ["100000"], "valor inventado é apontado");
  const { dadosDePainel } = await import("../lib/sara/central/subagente.ts");
  const p = dadosDePainel("financeiro", "Financeiro", [
    { nome: "contas_a_receber", rotulo: "contas a receber", dados: { por_mes: [{ mes: "2026-07", total: 10 }, { mes: "2026-08", total: 20 }] }, fontes: [] },
    { nome: "mostrar", dados: { ok: true } }, { nome: "calcular", dados: { resultados: [] } },
  ]);
  assert.deepEqual(p.dados.map((x) => x.nome), ["financeiro.contas_a_receber"], "o nome ganha a área; mostrar e calcular ficam fora");
  assert.equal(p.dados[0].rotulo, "Financeiro › contas a receber");
  assert.match(p.dicas[0], /consulta "financeiro\.contas_a_receber"[\s\S]*por_mes \(2 itens; campos: mes, total\)/);
  assert.ok(!/10|20/.test(p.dicas[0].replace(/\d+ itens/, "")), "a dica não leva número");
  const { resolverVisual } = await import("../lib/sara/visual.ts");
  const v = resolverVisual({ componente: "barras", titulo: "Trimestres", consulta: "calcular", caminho: "resultados", rotulo: "nome", valor: "resultado", formato: "moeda" },
    [{ nome: "calcular", rotulo: "calcular", dados: { resultados: [{ nome: "Jul–Set", expressao: "1+2", resultado: 2345678.9 }, { nome: "Out–Dez", expressao: "x", resultado: 812345.1 }] }, fontes: [] }]);
  assert.ok("visual" in v && v.visual.componente === "barras" && v.visual.pontos.length === 2, "comparativo da calculadora vira barras");
  const calc = [{ nome: "calcular", rotulo: "calcular", dados: { resultados: [{ nome: "Total", resultado: 59 }, { nome: "Jul–Set", resultado: 3 }, { nome: "Out–Dez", resultado: 7 }, { nome: "Jan–Mar", resultado: 5 }] }, fontes: [] }];
  const so = resolverVisual({ componente: "barras", titulo: "T", consulta: "calcular", caminho: "resultados", rotulo: "nome", valor: "resultado", somente: ["Jul–Set", "Out–Dez", "Jan–Mar"] }, calc);
  assert.deepEqual("visual" in so && so.visual.pontos.map((x) => x.rotulo), ["Jul–Set", "Out–Dez", "Jan–Mar"], "só as contas do gráfico, na ordem pedida (sem o Total)");
  const falta = resolverVisual({ componente: "linha", titulo: "T", consulta: "calcular", caminho: "resultados", rotulo: "nome", valor: "resultado", somente: ["Abr–Jun"] }, calc);
  assert.match("erro" in falta ? falta.erro : "", /não existem no resultado: Abr–Jun[\s\S]*Jul–Set/);

  const sessao = ler("lib/sara/sessao.ts");
  assert.match(sessao, /semFonteNaConta\(String\(c\.expressao/);
  assert.match(sessao, /por_nome: porNome/, "indicadores do painel apontam para as contas pelo nome");
  const ind = resolverVisual({ componente: "indicadores", titulo: "Recebíveis", consulta: "calcular", caminho: "por_nome", campos: [{ campo: "Total em aberto" }] },
    [{ nome: "calcular", rotulo: "calcular", dados: { resultados: [], por_nome: { "Total em aberto": 59217223.6 } }, fontes: [] }]);
  assert.ok("visual" in ind && ind.visual.itens[0].valor === 59217223.6);
  assert.match(ler("lib/sara/laco.ts"), /\(os\|o\) campos\? do mostrar\|\(não\|nao\) aceit\(ou\|aram\) o caminho/, "frase de bastidor da ferramenta não entra na resposta");
  assert.match(sessao, /\/\/ Painel na tela[\s\S]*MOSTRAR,/);
  const laco = ler("lib/sara/laco.ts");
  assert.match(laco, /if \(res\.paraVisual\?\.length\) resultados\.push\(\.\.\.res\.paraVisual\);/);
  assert.match(laco, /visuais\.length < \(a\.maxVisuais \?\? 4\)/);
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /maxVisuais: p\.sara\.central \? 8 : undefined/);
  assert.match(rota, /replace\(\/⚠️\?\\s\*Sem fonte conferida/, "o aviso do que não teve fonte não vira fonte");
  const { SARA_CENTRAL } = await import("../lib/sara/central/sara.ts");
  assert.match(SARA_CENTRAL.manual, /PAINEL NA TELA[\s\S]*até 8 visuais[\s\S]*para_mostrar_no_painel[\s\S]*consulta "calcular"[\s\S]*caminho "resultados"[\s\S]*caminho "por_nome"[\s\S]*Não diga que não consegue montar painel/);
  const holo = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  assert.match(holo, /sh-palco-grade/, "dois ou mais visuais aparecem juntos, como painel");
});
