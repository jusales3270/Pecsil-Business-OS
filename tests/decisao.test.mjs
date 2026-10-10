import assert from "node:assert/strict";
import test from "node:test";
import { cpfValido, filtrarEstado, pisValido } from "../lib/decisao/guard.ts";
import { DecisaoErro, confiancaGeral, consultar, faixa, lerResposta, montarPedido, urlClef } from "../lib/decisao/core.ts";

// CPF e PIS sintéticos, montados pela regra do dígito verificador (não são de ninguém).
const comDvCpf = (base) => {
  const dv = (b, p) => { let s = 0; for (let i = 0; i < b.length; i++) s += Number(b[i]) * (p - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(base, 10); const d2 = dv(base + d1, 11); return base + d1 + d2;
};
const comDvPis = (base) => { const p = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = p.reduce((a, x, i) => a + x * Number(base[i]), 0); const r = 11 - (s % 11); return base + (r >= 10 ? 0 : r); };
const CPF = comDvCpf("123456789");
const PIS = comDvPis("1203456789");

test("filtro: CPF com e sem máscara é bloqueado; número de 11 dígitos sem DV válido passa", () => {
  assert.equal(cpfValido(CPF), true);
  const mascarado = CPF.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  assert.deepEqual(filtrarEstado(`Colaborador ${mascarado} pediu EPI`).motivos, ["CPF"]);
  assert.deepEqual(filtrarEstado(`documento ${CPF}`).motivos, ["CPF"]);
  const falso = CPF.slice(0, 10) + String((Number(CPF[10]) + 1) % 10);
  const r = filtrarEstado(`NF ${falso} da MIRAI`);
  assert.equal(r.ok, !pisValido(falso), `11 dígitos sem DV de CPF: ${falso}`);
});

test("filtro: PIS, e-mail e telefone bloqueados; CNPJ e chave de NF-e passam", () => {
  assert.equal(pisValido(PIS), true);
  assert.ok(filtrarEstado(`PIS ${PIS.replace(/^(\d{3})(\d{5})(\d{2})(\d)$/, "$1.$2.$3-$4")}`).motivos.includes("PIS"));
  assert.ok(filtrarEstado("contato: fulano@empresa.com.br").motivos.includes("e-mail"));
  assert.ok(filtrarEstado("ligar (11) 98765-4321").motivos.includes("telefone"));
  assert.deepEqual(filtrarEstado("MIRAI METALS 21.583.926/0001-27 | MIRAI METAIS 21583926000127"), { ok: true, motivos: [] });
  assert.deepEqual(filtrarEstado("chave 33260903222201000121550010000229131140141050 valor 21.385,00"), { ok: true, motivos: [] });
});

test("filtro: CID só conta perto de palavra de saúde", () => {
  assert.ok(filtrarEstado("atestado com CID M54.5").motivos.includes("dado de saúde (CID)"));
  assert.deepEqual(filtrarEstado("Bloco K12 da fundição, peça A10"), { ok: true, motivos: [] });
});

test("resposta: noul, choice e score lidos; confiança do noul sai da distância do meio", () => {
  const { respostas, tokens } = lerResposta({
    success: true,
    result: {
      answers: {
        mesma: { type: "noul", noul: 0.85 },
        setor: { type: "choice", choice: "financeiro", confidence: 0.87, probabilities: { financeiro: 0.95, rh: 0.01 } },
        urgencia: { type: "score", score: 2.1, confidence: 0.7, legend: { 1: "baixa", 2: "média", 3: "alta" }, probabilities: { 2: 0.7 } },
      },
      usage: { input_tokens: 154 },
    },
  });
  assert.deepEqual(respostas.mesma, { type: "noul", valor: 0.85, confianca: 0.85 });
  assert.equal(respostas.setor.escolha, "financeiro");
  assert.equal(respostas.setor.confianca, 0.87);
  assert.equal(respostas.urgencia.nivel, "média");
  assert.equal(tokens, 154);
  assert.equal(confiancaGeral(respostas), 0.7);
  assert.throws(() => lerResposta({ result: { nada: 1 } }), DecisaoErro);
  assert.throws(() => lerResposta({ result: { answers: { x: { type: "choice" } } } }), /inesperada/);
});

test("faixa de confiança e pedido", () => {
  const limites = { alto: 0.8, baixo: 0.4 };
  assert.equal(faixa(0.85, limites), "alta");
  assert.equal(faixa(0.8, limites), "alta");
  assert.equal(faixa(0.6, limites), "media");
  assert.equal(faixa(0.39, limites), "baixa");
  assert.throws(() => montarPedido(" ", { a: { type: "noul", instructions: "x", criteria: { true: "s", false: "n" } } }), DecisaoErro);
  assert.match(urlClef("abc", "clef-flash"), /accounts\/abc\/ai\/run\/@cf\/cloudflare\/clef-flash$/);
});

test("consulta: tenta de novo uma vez quando o serviço cai; não insiste com chave recusada; tempo esgotado vira TEMPO", async () => {
  const ok = { success: true, result: { answers: { a: { type: "noul", noul: 0.9 } } } };
  let chamadas = 0;
  const instavel = async () => (++chamadas === 1 ? { status: 503, json: async () => ({}) } : { status: 200, json: async () => ok });
  const r = await consultar({ fetch: instavel, url: "u", token: "t", corpo: {} });
  assert.equal(chamadas, 2);
  assert.deepEqual(r.json, ok);

  chamadas = 0;
  const recusada = async () => { chamadas++; return { status: 401, json: async () => ({}) }; };
  await assert.rejects(consultar({ fetch: recusada, url: "u", token: "t", corpo: {} }), (e) => e.codigo === "CHAVE");
  assert.equal(chamadas, 1);

  const demorada = async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; };
  await assert.rejects(consultar({ fetch: demorada, url: "u", token: "t", corpo: {} }), (e) => e.codigo === "TEMPO");

  const recusaPedido = async () => ({ status: 400, json: async () => ({ success: false, errors: [{ message: "bad" }] }) });
  await assert.rejects(consultar({ fetch: recusaPedido, url: "u", token: "t", corpo: {} }), (e) => e.codigo === "RESPOSTA");
});
