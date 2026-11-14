import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CATALOGO, ESFORCOS, doCatalogo, esforcoValido, modeloReserva, pedidoPara } from "../lib/sara/modelos.ts";
import { NIVEIS, classificacaoDe, continuacaoCurta, degrauAcima, instrucoesDoClassificador, nivelFinal, pedidoDoClassificador } from "../lib/sara/nivel.ts";
import { POLITICA_PADRAO, escolhaDoNivel, escolhaDoTrabalho } from "../lib/sara/politica.ts";
import { custoUsd } from "../lib/sara/custo.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

// Roteador de modelo e esforço da SARA (I-32, 14/11/2026), docs/PLANO-SARA-ROTEADOR.md.

test("catálogo: os quatro modelos com as regras da API (14/11)", () => {
  assert.deepEqual(CATALOGO.map((m) => m.id), ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"]);
  const h = doCatalogo("claude-haiku-5-5"), s = doCatalogo("claude-sonnet-5-5"), o = doCatalogo("claude-opus-5-5"), f = doCatalogo("claude-fable-5-2");
  assert.equal(h.esforcoPadrao, "medium"); assert.equal(s.esforcoPadrao, "high"); assert.equal(o.esforcoPadrao, "medium"); assert.equal(f.esforcoPadrao, "high");
  assert.equal(h.pensarMinimo, "disabled"); assert.equal(s.pensarMinimo, "between_tools"); assert.equal(o.pensarMinimo, "adaptive"); assert.equal(f.pensarMinimo, "adaptive");
  assert.ok(h.ferramentaForcada && !s.ferramentaForcada && !o.ferramentaForcada && !f.ferramentaForcada, "só o Haiku aceita ferramenta forçada");
  assert.ok(f.exigeRetencao && !o.exigeRetencao);
  assert.equal(modeloReserva("claude-haiku-5-5"), "claude-sonnet-5-5");
  assert.equal(modeloReserva("claude-sonnet-5-5"), "claude-haiku-5-5");
  assert.equal(modeloReserva("claude-opus-5-5"), "claude-sonnet-5-5");
  assert.equal(modeloReserva("claude-fable-5-2"), "claude-opus-5-5");
  assert.equal(esforcoValido("claude-opus-5-5"), "medium", "sem pedido, o padrão do modelo");
});

test("montador: nenhuma combinação modelo × esforço × ferramenta forçada vai à API com o que ela recusa", () => {
  for (const m of CATALOGO) {
    for (const esforco of [undefined, ...ESFORCOS]) {
      for (const forcar of [null, "any", "classificar"]) {
        for (const pensar of [false, true]) {
          const p = pedidoPara(m.id, { esforco, forcar, pensar });
          const efetivo = esforco ?? m.esforcoPadrao;
          const alto = ["xhigh", "max"].includes(efetivo);
          const caso = `${m.id} ${esforco ?? "padrão"} ${forcar ?? "-"} pensar=${pensar}`;
          if (p.thinking.type === "disabled") assert.ok(m.id === "claude-haiku-5-5" && !alto, `disabled só no Haiku até high: ${caso}`);
          if (p.thinking.type === "between_tools") assert.ok(m.id === "claude-sonnet-5-5" && !alto, `between_tools só no Sonnet 5.5 até high: ${caso}`);
          if (m.pensarMinimo === "adaptive") assert.equal(p.thinking.type, "adaptive", `Opus e Fable não desligam o pensar: ${caso}`);
          if (pensar) assert.equal(p.thinking.type, "adaptive", caso);
          if (forcar && !m.ferramentaForcada) { assert.deepEqual(p.tool_choice, { type: "auto" }, caso); assert.match(p.instrucao, /obrigatório/); }
          if (forcar && m.ferramentaForcada) assert.notEqual(p.tool_choice.type, "auto", caso);
          if (esforco) assert.deepEqual(p.output_config, { effort: esforco }); else assert.equal(p.output_config, undefined, "sem esforço pedido, não manda o campo (como hoje)");
        }
      }
    }
  }
  // Sem pedido de esforço, o mesmo que o semPensar de antes (nenhuma mudança de comportamento).
  assert.deepEqual(pedidoPara("claude-haiku-5-5").thinking, { type: "disabled" });
  assert.deepEqual(pedidoPara("claude-sonnet-5-5").thinking, { type: "between_tools" });
});

test("classificador: instrução genérica (vale para qualquer empresa) e o pedido no modelo rápido", () => {
  const ins = instrucoesDoClassificador();
  assert.doesNotMatch(ins, /pecsil|fundição|forja|grv/i, "nada de uma empresa só");
  for (const n of NIVEIS) assert.match(ins, new RegExp(`- ${n}:`));
  const p = pedidoDoClassificador({ pergunta: "Quantas contas vencem hoje?", ultimaResposta: "Bom dia.", central: true });
  assert.equal(p.model, "claude-haiku-5-5");
  assert.deepEqual(p.thinking, { type: "disabled" });
  assert.deepEqual(p.output_config, { effort: "low" });
  assert.deepEqual(p.tool_choice, { type: "tool", name: "classificar" });
  assert.match(p.messages[0].content, /<ultima_resposta>Bom dia\.<\/ultima_resposta>[\s\S]*<pedido>Quantas contas vencem hoje\?<\/pedido>/);
  // Se o classificador for um modelo que não aceita ferramenta forçada, o montador troca por instrução.
  const s = pedidoDoClassificador({ pergunta: "x" }, "claude-sonnet-5-5");
  assert.deepEqual(s.tool_choice, { type: "auto" });
  assert.match(s.messages[0].content, /Responda chamando a ferramenta classificar \(obrigatório\)\./);
  const usa = (input) => ({ content: [{ type: "tool_use", id: "t", name: "classificar", input }] });
  assert.deepEqual(classificacaoDe(usa({ nivel: "criterio", risco: true, motivo: "recomendar pagamento" })), { nivel: "criterio", risco: true, motivo: "recomendar pagamento" });
  assert.equal(classificacaoDe(usa({ nivel: "urgente" })), null);
  assert.equal(classificacaoDe(null), null);
});

test("regras do nível: continuação explícita herda; pergunta curta e completa não; sem permissão para no critério", () => {
  for (const t of ["e amanhã?", "pode abrir", "sim, envie", "e o outro?"]) assert.ok(continuacaoCurta(t), t);
  // Medição de 14/11: herdar pelo tamanho mandou estas para o nível profundo da pergunta anterior.
  for (const t of ["Quais pedidos de compra estão parados?", "otimo...volta ao cerebro original", "Período 01/06/2026 a 30/09/2026", "Gerar o relatório em PDF"]) assert.ok(!continuacaoCurta(t), t);
  const c = (nivel) => ({ nivel, risco: false, motivo: "" });
  assert.equal(nivelFinal(c("rapido"), { anterior: "criterio", pergunta: "e amanhã?", podeProfundo: true, padrao: "padrao" }), "criterio");
  assert.equal(nivelFinal(c("rapido"), { anterior: "profundo", pergunta: "Quais pedidos estão parados?", podeProfundo: true, padrao: "padrao" }), "rapido");
  assert.equal(nivelFinal(c("profundo"), { pergunta: "faça um diagnóstico do ano", podeProfundo: false, padrao: "padrao" }), "criterio");
  assert.equal(nivelFinal(null, { pergunta: "x", podeProfundo: true, padrao: "padrao" }), "padrao", "sem classificação, o que a SARA faria hoje");
  assert.equal(nivelFinal(c("rapido"), { pergunta: "oi", podeProfundo: true, padrao: "padrao", minimo: "padrao" }), "padrao");
  assert.equal(degrauAcima("padrao", true), "criterio");
  assert.equal(degrauAcima("criterio", false), null, "sem permissão, não sobe ao profundo");
  assert.equal(degrauAcima("profundo", true), null);
});

test("política padrão: o mais barato que resolve, Opus no julgamento, Fable desligado; trabalhos fixos por nível", () => {
  assert.deepEqual(escolhaDoNivel(POLITICA_PADRAO, "rapido"), { modelo: "claude-haiku-5-5", esforco: "low" });
  assert.deepEqual(escolhaDoNivel(POLITICA_PADRAO, "padrao"), { modelo: "claude-sonnet-5-5", esforco: "medium" });
  assert.deepEqual(escolhaDoNivel(POLITICA_PADRAO, "criterio"), { modelo: "claude-opus-5-5", esforco: "medium" });
  assert.deepEqual(escolhaDoNivel(POLITICA_PADRAO, "profundo"), { modelo: "claude-opus-5-5", esforco: "high" });
  assert.equal(POLITICA_PADRAO.modo, "desligado", "nasce desligado: a empresa liga depois da medição e do modo sombra");
  assert.equal(escolhaDoTrabalho(POLITICA_PADRAO, "crescimento").nivel, "profundo");
  assert.equal(escolhaDoTrabalho(POLITICA_PADRAO, "bom_dia").modelo, "claude-haiku-5-5");
  const ruim = { ...POLITICA_PADRAO, niveis: { ...POLITICA_PADRAO.niveis, criterio: { modelo: "gpt-qualquer", esforco: "max" } } };
  assert.deepEqual(escolhaDoNivel(ruim, "criterio"), { modelo: "claude-opus-5-5", esforco: "max" }, "modelo fora do catálogo volta ao padrão do nível");
  assert.doesNotMatch(ler("lib/sara/politica.ts") + ler("lib/sara/nivel.ts"), /pecsil/i, "nada fixo de uma empresa");
});

test("custo pelo catálogo: Opus e Fable com preço; a medição não grava nada", () => {
  assert.equal(custoUsd({ modelo: "claude-fable-5-2", tokens_entrada: 1_000_000, tokens_saida: 0, cache_lido: 0, cache_gravado: 0 }).toFixed(2), "8.00");
  assert.equal(custoUsd({ modelo: "claude-opus-5-5", tokens_entrada: 1_000_000, tokens_saida: 0, cache_lido: 1_000_000, cache_gravado: 0 }).toFixed(2), "0.20", "leitura do cache do Opus: US$ 0,20");
  const script = ler("scripts/medir-nivel-sara.mjs");
  assert.doesNotMatch(script, /\b(insert|update|delete|upsert)\b/i, "Etapa 0 só lê o banco");
  assert.match(script, /startsWith\("☀️"\)/, "o Bom dia automático fica fora da medição");
});
