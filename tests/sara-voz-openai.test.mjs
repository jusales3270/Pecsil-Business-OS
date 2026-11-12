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
  for (const f of rastreados.filter((x) => /\.(ts|tsx|mjs|js|json|md|sql)$/.test(x))) {
    let t = "";
    try { t = readFileSync(new URL(`../${f}`, import.meta.url), "utf8"); } catch { continue; }
    assert.doesNotMatch(t, /sk-proj-[A-Za-z0-9_-]{20,}/, `${f}: chave da OpenAI escrita no arquivo`);
    assert.doesNotMatch(t, /NEXT_PUBLIC_OPENAI/, `${f}: a chave não pode ir para o navegador`);
  }
});
