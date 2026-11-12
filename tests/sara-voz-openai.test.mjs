import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OCIOSA_MS, PARE_DE_FALAR, avisoDeTela, conversaParaEnviar, dizerExatamente, juntarFala, semTagsDeVoz } from "../lib/sara/central/fala-ao-vivo.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

// Voz ao vivo da SARA central pelo GPT-Live da OpenAI (decisão do proprietário, 11/11/2026).

test("fala conferida: em português, palavra por palavra; em outra língua, a tradução fiel na língua dita", () => {
  const pt = dizerExatamente("Hoje vencem 7 contas, somando R$ 12.345,67.");
  assert.match(pt, /em português do Brasil, exatamente o texto entre « e », palavra por palavra/);
  assert.match(pt, /«Hoje vencem 7 contas, somando R\$ 12\.345,67\.»$/);
  const en = dizerExatamente("Hoje vencem 7 contas.", "en");
  assert.match(en, /^A pessoa está falando inglês: responda em inglês\./, "no teste de 11/11, sem a língua dita, a voz falava em português");
  assert.match(en, /sem mudar números, valores, datas e nomes/);
  assert.match(en, /Não diga o texto em português\./);
  assert.match(dizerExatamente("x", "es"), /em espanhol/);
  assert.match(dizerExatamente("x", "fr"), /em francês/);
  assert.match(dizerExatamente("x", "outra"), /na língua em que a pessoa acabou de falar/);
  assert.ok(dizerExatamente("a".repeat(5000)).length <= 1400, "cabe no limite de 500 tokens de cada texto da sessão");
});

test("expressões da personalidade: a tag do motor vira indicação de som (o GPT-Live leria \"[sigh]\")", () => {
  assert.deepEqual(semTagsDeVoz("[sigh] Pela terceira vez, Senhor."), { texto: "Pela terceira vez, Senhor.", expressao: "um suspiro breve" });
  assert.deepEqual(semTagsDeVoz("Agradeço. <soft>[laugh]</soft> Aceito."), { texto: "Agradeço. Aceito.", expressao: "um riso contido" });
  assert.deepEqual(semTagsDeVoz("Sem expressão."), { texto: "Sem expressão.", expressao: null });
  const d = dizerExatamente("[pause] Posso registrar, Senhor.");
  assert.match(d, /Faça uma pausa breve antes de começar \(o som, nunca a palavra\)\./);
  assert.doesNotMatch(d, /\[pause\]/);
});

test("conversa: os pedaços da transcrição viram falas; a sessão nova recebe a conversa limpa", () => {
  let c = juntarFala([], "pessoa", " Quantas contas");
  c = juntarFala(c, "pessoa", " vencem hoje?");
  c = juntarFala(c, "sara", " Um instante.");
  c = juntarFala(c, "pessoa", " E amanhã?");
  assert.deepEqual(c, [{ quem: "pessoa", texto: "Quantas contas vencem hoje?" }, { quem: "sara", texto: "Um instante." }, { quem: "pessoa", texto: "E amanhã?" }]);
  assert.equal(juntarFala(c, "sara", ""), c, "pedaço vazio não muda nada");
  let longa = [];
  for (let i = 0; i < 50; i++) longa = juntarFala(longa, i % 2 ? "sara" : "pessoa", `f${i}`);
  assert.equal(longa.length, 40);
  assert.deepEqual(conversaParaEnviar([{ quem: "pessoa", texto: "  oi \n tudo " }, { quem: "sara", texto: "   " }]), [{ quem: "pessoa", texto: "oi tudo" }]);
  assert.equal(OCIOSA_MS, 120_000, "dois minutos parada, a sessão fecha (o GPT-Live cobra por minuto aberto)");
  assert.match(PARE_DE_FALAR, /Pare de falar agora/);
  assert.match(avisoDeTela("minimizar", { ok: true }), /^Feito na tela \(minimizar\)/);
  assert.match(avisoDeTela("minimizar", { ok: true }, "pt"), /em português do Brasil/, "pedido em português, confirmação em português (o teste de 11/11 ouviu \"Done, minimized\")");
  assert.match(avisoDeTela("minimizar", { ok: true }, "en"), /em inglês/);
  assert.match(avisoDeTela("minimizar", { ok: true }, "outra"), /na língua em que a pessoa acabou de falar/);
  assert.match(avisoDeTela("destacar_no_visual", { erro: "Esse nome não está no gráfico da tela." }), /^Não deu certo na tela: Esse nome não está no gráfico da tela\./);
});

test("chave da OpenAI: só no servidor, fora do repositório e nunca no navegador", () => {
  // .env.local (onde fica a chave) não entra no git.
  execFileSync("git", ["check-ignore", "-q", ".env.local"], { cwd: new URL("..", import.meta.url) });
  const rastreados = execFileSync("git", ["ls-files"], { cwd: new URL("..", import.meta.url), encoding: "utf8" }).split("\n");
  assert.ok(!rastreados.some((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f)), "nenhum .env com valor no repositório");
  const rota = ler("app/api/sara/[modulo]/voz-ao-vivo/route.ts");
  assert.match(rota, /process\.env\.OPENAI_API_KEY/);
  for (const f of ["modules/warroom/src/holograma/voz-ao-vivo.ts", "modules/warroom/src/holograma/SaraHolograma.tsx", "lib/sara/central/fala-ao-vivo.ts"]) {
    assert.doesNotMatch(ler(f), /OPENAI_API_KEY|NEXT_PUBLIC_OPENAI|sk-[A-Za-z0-9]/, `${f}: nada de chave no código do navegador`);
  }
  // (este arquivo fica de fora: ele mesmo escreve os padrões que procura)
  for (const f of rastreados.filter((x) => /\.(ts|tsx|mjs|js|json|md|sql)$/.test(x) && x !== "tests/sara-voz-openai.test.mjs")) {
    let t = "";
    try { t = readFileSync(new URL(`../${f}`, import.meta.url), "utf8"); } catch { continue; }
    assert.doesNotMatch(t, /sk-proj-[A-Za-z0-9_-]{20,}/, `${f}: chave da OpenAI escrita no arquivo`);
    assert.doesNotMatch(t, /NEXT_PUBLIC_OPENAI/, `${f}: a chave não pode ir para o navegador`);
  }
});

// "Quero a mesma voz em tudo" (proprietário, 11/11/2026): a mensagem de voz e a resposta em áudio do WhatsApp
// também saem na voz do GPT-Live, gravadas no servidor (lib/sara/central/gravar-ao-vivo.ts).
const g = await import("../lib/sara/central/gravar-ao-vivo.ts");

test("gravação: o texto em partes que cabem numa instrução, cortando nas frases", () => {
  assert.deepEqual(g.partesParaGravar("Olá, Ana. Tudo certo? Até logo."), ["Olá, Ana. Tudo certo? Até logo."]);
  const longo = Array.from({ length: 30 }, (_, i) => `Frase número ${i} com algum conteúdo.`).join(" ");
  const partes = g.partesParaGravar(longo, 200);
  assert.ok(partes.length > 1 && partes.every((p) => p.length <= 200), JSON.stringify(partes.map((p) => p.length)));
  assert.equal(partes.join(" "), longo, "nada se perde entre as partes");
  const semPonto = "palavra ".repeat(100).trim();
  assert.ok(g.partesParaGravar(semPonto, 200).every((p) => p.length <= 200), "frase longa demais corta nos espaços");
  assert.match(g.lerParaGravar("[sigh] Bom dia."), /^Leia agora, em voz alta, exatamente o texto[\s\S]*na língua em que ele está escrito[\s\S]*Faça um suspiro breve[\s\S]*«Bom dia\.»$/);
  assert.match(g.instrucoesDeGravacao(), /português do Brasil, com pronúncia e entonação brasileiras naturais/);
});

test("gravação: silêncios aparados, WAV correto e conferência de que saiu inteira", () => {
  const T = g.TAXA, tom = (s) => Int16Array.from({ length: Math.round(s * T) }, (_, i) => Math.round(Math.sin(i / 8) * 9000));
  const mudo = (s) => new Int16Array(Math.round(s * T));
  const juntar = (...p) => { const t = new Int16Array(p.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of p) { t.set(x, k); k += x.length; } return t; };
  const aparado = g.apararSilencios(juntar(mudo(2), tom(1), mudo(0.5), tom(1), mudo(3), tom(1), mudo(2)));
  const seg = aparado.length / T;
  assert.ok(seg > 4.0 && seg < 4.5, `silêncio do começo e do fim sai, pausa curta fica, pausa longa encurta (${seg.toFixed(2)} s)`);
  assert.equal(g.apararSilencios(mudo(2)).length, 0, "só silêncio: nada");
  const w = g.wav(tom(0.1));
  assert.equal(Buffer.from(w.subarray(0, 4)).toString(), "RIFF");
  assert.equal(Buffer.from(w.subarray(8, 12)).toString(), "WAVE");
  const v = new DataView(w.buffer, w.byteOffset);
  assert.equal(v.getUint32(24, true), 24000); assert.equal(v.getUint16(34, true), 16); assert.equal(v.getUint32(40, true), w.length - 44);
  assert.ok(g.gravacaoCompleta("Hoje vencem 4 contas a pagar, somando R$ 24.276,95.", "Hoje vencem quatro contas a pagar, somando vinte e quatro mil reais."));
  assert.ok(!g.gravacaoCompleta("Hoje vencem 4 contas a pagar, somando R$ 24.276,95. O Bradesco segue sem extrato desde julho.", "Hoje vencem quatro"), "gravação cortada é recusada");
  assert.ok(g.energia(tom(0.05)) > 0.1 && g.energia(mudo(0.05)) === 0);
});

test("gravação: a sessão inteira (falsa) — abre, lê parte por parte, espera o silêncio, fecha e devolve o WAV", async () => {
  let relogio = 0;
  const enviados = [];
  let ws;
  const criarWs = (url, chave) => {
    assert.equal(url, "wss://api.openai.com/v1/live/sessions"); assert.equal(chave, "chave-teste");
    ws = { send: (s) => enviados.push(JSON.parse(s)), close: () => {}, onopen: null, onmessage: null, onerror: null, onclose: null };
    return ws;
  };
  const texto = `${"Primeira parte da mensagem de voz, com bastante conteúdo para dividir. ".repeat(10)}Segunda parte, curta e final.`;
  assert.equal(g.partesParaGravar(texto).length, 2);
  const p = g.gravarNaVozAoVivo(texto, { chave: "chave-teste", voz: "gleam", criarWs, agora: () => relogio });
  ws.onopen();
  assert.equal(enviados[0].type, "session.start");
  assert.equal(enviados[0].session.model, "gpt-live-1");
  assert.deepEqual(enviados[0].session.audio, { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "gleam" } });
  const chega = (e) => ws.onmessage({ data: JSON.stringify(e) });
  const audio = (voz) => chega({ type: "session.output_audio.delta", delta: Buffer.from(Int16Array.from({ length: 2400 }, (_, i) => voz ? Math.round(Math.sin(i / 8) * 9000) : 0).buffer).toString("base64") });
  chega({ type: "session.started", session: { id: "live_x" } });
  const partes = enviados.filter((e) => e.type === "session.instructions.append");
  assert.equal(partes.length, 1, "uma parte por vez");
  assert.match(partes[0].content, /^Leia agora/);
  for (let i = 0; i < 10; i++) { relogio += 100; audio(true); }
  chega({ type: "session.output_transcript.delta", delta: texto });
  for (let i = 0; i < 14; i++) { relogio += 100; audio(false); }
  assert.equal(enviados.filter((e) => e.type === "session.instructions.append").length, 2, "o silêncio depois da voz encerra a parte e manda a próxima");
  for (let i = 0; i < 10; i++) { relogio += 100; audio(true); }
  for (let i = 0; i < 14; i++) { relogio += 100; audio(false); }
  const w = await p;
  assert.ok(enviados.some((e) => e.type === "session.close"), "fecha a sessão (a cobrança é por minuto)");
  assert.equal(Buffer.from(w.subarray(0, 4)).toString(), "RIFF");
  const seg = (w.length - 44) / 48000;
  assert.ok(seg > 1.9 && seg < 3, `só a fala, com uma pausa natural (${seg.toFixed(2)} s)`);
});

test("gravação: erro da sessão, voz que não começa e gravação incompleta viram erro (a resposta vai por escrito)", async () => {
  const mk = () => { let ws; return { criarWs: () => (ws = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onerror: null, onclose: null }), ws: () => ws }; };
  const a = mk();
  const p1 = g.gravarNaVozAoVivo("Bom dia, Ana.", { chave: "k", criarWs: a.criarWs, agora: () => 0 });
  a.ws().onopen(); a.ws().onmessage({ data: JSON.stringify({ type: "error", error: { message: "voz inválida" } }) });
  await assert.rejects(p1, /A gravação da voz falhou: voz inválida/);
  const b = mk(); let t = 0;
  const p2 = g.gravarNaVozAoVivo("Bom dia, Ana.", { chave: "k", criarWs: b.criarWs, agora: () => t });
  b.ws().onopen(); b.ws().onmessage({ data: JSON.stringify({ type: "session.started" }) });
  t = 11_000; b.ws().onmessage({ data: JSON.stringify({ type: "session.output_audio.delta", delta: Buffer.alloc(4800).toString("base64") }) });
  await assert.rejects(p2, /A voz não começou a gravação/);
  const c = mk(); t = 0;
  const p3 = g.gravarNaVozAoVivo("Hoje vencem quatro contas a pagar, somando muito dinheiro em aberto.", { chave: "k", criarWs: c.criarWs, agora: () => t });
  c.ws().onopen(); c.ws().onmessage({ data: JSON.stringify({ type: "session.started" }) });
  const voz = Buffer.from(Int16Array.from({ length: 2400 }, (_, i) => Math.round(Math.sin(i / 8) * 9000)).buffer).toString("base64");
  for (let i = 0; i < 10; i++) { t += 100; c.ws().onmessage({ data: JSON.stringify({ type: "session.output_audio.delta", delta: voz }) }); }
  c.ws().onmessage({ data: JSON.stringify({ type: "session.output_transcript.delta", delta: "Hoje" }) });
  for (let i = 0; i < 14; i++) { t += 100; c.ws().onmessage({ data: JSON.stringify({ type: "session.output_audio.delta", delta: Buffer.alloc(4800).toString("base64") }) }); }
  await assert.rejects(p3, /incompleta/);
});

test("arquivo da mensagem de voz: WAV nas novas, MP3 nas antigas (pelo caminho guardado)", async () => {
  const { arquivoDoTipo, nomeDoArquivo } = await import("../lib/sara/documentos/documento.ts");
  assert.deepEqual(arquivoDoTipo("mensagem_voz"), { mime: "audio/wav", ext: "wav" });
  assert.deepEqual(arquivoDoTipo("mensagem_voz", "org/id/DOC-1 mensagem de voz.mp3"), { mime: "audio/mpeg", ext: "mp3" }, "as 13 antigas, do Grok");
  assert.deepEqual(arquivoDoTipo("relatorio", "org/id/DOC-2 x.pdf"), { mime: "application/pdf", ext: "pdf" });
  assert.match(nomeDoArquivo("DOC-1", "Aviso", "mensagem_voz", "a/b/DOC-1 mensagem de voz.mp3"), /\.mp3$/);
  assert.match(nomeDoArquivo("DOC-3", "Aviso", "mensagem_voz"), /\.wav$/);
  for (const r of ["app/api/sara/documentos/[id]/arquivo/route.ts", "app/api/sara/documentos/[id]/pdf/route.ts"]) assert.match(ler(r), /arquivoDoTipo\(doc\.tipo, doc\.caminho\)/, r);
});
