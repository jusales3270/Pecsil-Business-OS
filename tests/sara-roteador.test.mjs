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

test("etapa 1: o laço e o roteador da voz montam o pedido pelo catálogo (o reserva remonta o pensar)", async () => {
  const laco = ler("lib/sara/laco.ts");
  assert.match(laco, /const p = pedidoPara\(modelo, \{ esforco: a\.esforco \}\);/, "o pedido é montado para o modelo da vez (o principal ou o reserva)");
  assert.match(laco, /\.\.\.\(p\.output_config \? \{ output_config: p\.output_config \} : \{\}\)/, "sem esforço pedido, o campo não vai (nada muda)");
  assert.match(laco, /mensagens\.push\(\{ role: "assistant", content: corpo\.content \}\)/, "o turno volta inteiro, com os blocos de pensamento (exigência do Opus e do Fable)");
  const { semPensar } = await import("../lib/sara/base.ts");
  assert.deepEqual(semPensar("claude-opus-5-5"), { type: "adaptive" }, "o Opus não desliga o pensar (o semPensar antigo mandaria between_tools e daria 400)");
  const { pedidoDoRoteador } = await import("../lib/sara/central/voz-ao-vivo.ts");
  const haiku = pedidoDoRoteador([], [{ quem: "pessoa", texto: "oi" }]);
  assert.deepEqual(haiku.tool_choice, { type: "any" }); assert.deepEqual(haiku.thinking, { type: "disabled" });
  const opus = pedidoDoRoteador([], [{ quem: "pessoa", texto: "oi" }], "claude-opus-5-5");
  assert.deepEqual(opus.tool_choice, { type: "auto" }, "o Opus recusa ferramenta forçada");
  assert.match(opus.messages[0].content, /Responda chamando uma das ferramentas disponíveis \(obrigatório\)\./);
});

test("etapa 2: a política vem do banco por empresa, validada pelo catálogo; quem pode a análise profunda", async () => {
  const { politicaDaLinha, linhaDaPolitica, validarPolitica, podeProfundo, POLITICA_PADRAO: P } = await import("../lib/sara/politica.ts");
  assert.deepEqual(politicaDaLinha(null), P, "sem a linha (ou sem a tabela): o padrão, desligado");
  const linha = { modo: "sombra", rapido_modelo: "claude-haiku-5-5", rapido_esforco: "low", padrao_modelo: "claude-sonnet-5-5", padrao_esforco: "medium",
    criterio_modelo: "claude-opus-5-5", criterio_esforco: "high", profundo_modelo: "claude-fable-5-2", profundo_esforco: "high", profundo_para: "todos", teto_mes_reais: "150.50", trabalhos: { vigia: "padrao", bobagem: "x" } };
  const pol = politicaDaLinha(linha);
  assert.equal(pol.modo, "sombra"); assert.equal(pol.profundoPara, "todos"); assert.equal(pol.tetoMesReais, 150.5);
  assert.deepEqual(pol.niveis.profundo, { modelo: "claude-fable-5-2", esforco: "high" });
  assert.equal(pol.trabalhos.vigia, "padrao"); assert.equal(pol.trabalhos.crescimento, "profundo", "o que falta vale o padrão");
  assert.ok(!("bobagem" in pol.trabalhos));
  assert.deepEqual(politicaDaLinha({ ...linha, criterio_modelo: "gpt-9" }).niveis.criterio, P.niveis.criterio, "modelo fora do catálogo: o padrão do nível");
  assert.deepEqual(politicaDaLinha(linhaDaPolitica(pol)), pol, "ida e volta pelo banco sem perda");
  const corpo = { niveis: pol.niveis, modo: "ligado", profundoPara: "diretoria", tetoMesReais: "200,00", trabalhos: { bom_dia: "rapido" } };
  const ok = validarPolitica(corpo);
  assert.ok(ok.ok); assert.equal(ok.politica.tetoMesReais, 200);
  assert.match(validarPolitica({ ...corpo, niveis: { ...pol.niveis, padrao: { modelo: "gpt-9", esforco: "low" } } }).erro, /Modelo desconhecido no nível padrao/);
  assert.match(validarPolitica({ ...corpo, niveis: { ...pol.niveis, rapido: { modelo: "claude-haiku-5-5", esforco: "turbo" } } }).erro, /Esforço inválido/);
  assert.match(validarPolitica({ ...corpo, modo: "talvez" }).erro, /Modo do roteador inválido/);
  assert.match(validarPolitica({ ...corpo, tetoMesReais: "-5" }).erro, /Teto do mês inválido/);
  assert.match(validarPolitica({ ...corpo, trabalhos: { vigia: "turbo" } }).erro, /Nível inválido para Vigia/);
  const dir = { ...P, profundoPara: "diretoria" };
  assert.ok(podeProfundo(dir, { dono: true, diretor: false }), "o proprietário sempre");
  assert.ok(podeProfundo(dir, { dono: false, diretor: true }), "diretoria (cargo Diretor)");
  assert.ok(!podeProfundo(dir, { dono: false, diretor: false }));
  assert.ok(!podeProfundo({ ...P, profundoPara: "proprietario" }, { dono: false, diretor: true }));
  assert.ok(podeProfundo({ ...P, profundoPara: "todos" }, { dono: false, diretor: false }));

  const mig = ler("supabase/migrations/202611140001_sara_politica_modelos.sql");
  assert.match(mig, /organization_id uuid primary key references public\.organizations/, "uma linha por empresa");
  assert.match(mig, /modo text not null default 'desligado'/, "nasce desligado");
  assert.match(mig, /criterio_modelo text not null default 'claude-opus-5-5'/);
  assert.match(mig, /profundo_para text not null default 'diretoria'/);
  assert.match(mig, /grant select on public\.sara_politica_modelos to authenticated;/, "a SARA de cada pessoa lê");
  assert.doesNotMatch(mig, /grant (insert|update|delete|all) on public\.sara_politica_modelos/, "ninguém logado grava direto: só o servidor");
  assert.match(mig, /insert into public\.sara_politica_modelos \(organization_id\) select id from public\.organizations on conflict do nothing;/, "toda empresa ganha a linha");
  assert.match(mig, /custo_usd numeric\s+generated always as/, "o custo sai do registro que já é gravado, sem mudar o sara_registrar");
  assert.match(mig, /create or replace function public\.sara_custo_mes\(\)/);
  assert.doesNotMatch(mig, /pecsil/i, "nada de uma empresa só");

  const rota = ler("app/api/sara/politica/route.ts");
  assert.match(rota, /if \(!s\.access\.isOwner\) return NextResponse\.json\(\{ error: "Só o proprietário muda a política de modelos\." \}, \{ status: 403 \}\);/);
  assert.match(rota, /const v = validarPolitica\(/);
  assert.match(rota, /event_type: "sara\.politica_modelos\.alterada"[\s\S]*metadata: \{ antes, depois: v\.politica \}/, "auditoria do antes e do depois");
  const tela = ler("app/components/sara-politica.tsx");
  assert.match(tela, /\(m\?\.esforcos \?\? \[\]\)\.map/, "o seletor de esforço só oferece o que o modelo aceita");
  assert.match(ler("app/components/sara-aprendizado.tsx"), /<ModelosEEsforco notify=\{notify\} \/>/);
});

test("etapa 3: a decisão do roteador (desligado, só registrar, ligado), a central nunca abaixo do padrão e o custo com as áreas", async () => {
  const { decidirRoteamento, custoDaResposta, rotuloDoRoteamento } = await import("../lib/sara/roteamento.ts");
  const { POLITICA_PADRAO: P } = await import("../lib/sara/politica.ts");
  const c = (nivel) => ({ nivel, risco: nivel === "criterio", motivo: "teste" });
  const base = { classificacao: c("criterio"), anterior: null, pergunta: "Qual fornecedor você recomenda?", dono: false, diretor: false, central: false, modeloDoCanal: null };
  assert.equal(decidirRoteamento({ ...base, politica: P }), null, "desligado (o padrão): nada muda");
  const sombra = decidirRoteamento({ ...base, politica: { ...P, modo: "sombra" } });
  assert.deepEqual([sombra.nivel, sombra.modelo, sombra.esforco, sombra.aplicado, sombra.porque_nao], ["criterio", "claude-opus-5-5", "medium", false, "só registrar"]);
  const ligado = decidirRoteamento({ ...base, politica: { ...P, modo: "ligado" } });
  assert.ok(ligado.aplicado); assert.equal(ligado.modelo, "claude-opus-5-5");
  const canal = decidirRoteamento({ ...base, politica: { ...P, modo: "ligado" }, modeloDoCanal: "claude-haiku-5-5" });
  assert.ok(!canal.aplicado && /modelo fixo/.test(canal.porque_nao), "o número de WhatsApp com modelo fixo vence");
  const central = decidirRoteamento({ ...base, classificacao: c("rapido"), central: true, politica: { ...P, modo: "ligado" } });
  assert.equal(central.nivel, "padrao", "a central coordena as outras SARAs: nunca no Haiku");
  const semPermissao = decidirRoteamento({ ...base, classificacao: c("profundo"), politica: { ...P, modo: "ligado", profundoPara: "proprietario" } });
  assert.equal(semPermissao.nivel, "criterio");
  const diretor = decidirRoteamento({ ...base, classificacao: c("profundo"), diretor: true, politica: { ...P, modo: "ligado", profundoPara: "diretoria" } });
  assert.deepEqual([diretor.nivel, diretor.esforco], ["profundo", "high"]);
  assert.equal(rotuloDoRoteamento(ligado), "Análise com critério · Opus 5.5");
  const principal = { modelo: "claude-sonnet-5-5", tokensEntrada: 1_000_000, tokensSaida: 0, cacheLido: 0, cacheGravado: 0 };
  const areas = [{ modelo: "claude-haiku-5-5", tokensEntrada: 1_000_000, tokensSaida: 0, cacheLido: 0, cacheGravado: 0 }];
  assert.equal(custoDaResposta(principal, areas, 0.001), 2 + 0.1 + 0.001, "as SARAs das áreas consultadas pela central entram no custo (antes ficavam de fora)");

  const resp = ler("lib/sara/responder.ts");
  assert.match(resp, /const politicaP = lerPolitica\(p\.sb\)/);
  assert.match(resp, /if \(pol\.modo === "desligado"\) return null;/, "desligado: nem chama o classificador");
  assert.match(resp, /politica\.modo === "ligado" \? decidir\(await classificacaoP\) : null/, "ligado: decide antes de responder");
  assert.match(resp, /if \(politica\.modo === "sombra"\) roteamento = decidir\(await classificacaoP\);/, "só registrar: decide depois, sem atrasar");
  assert.match(resp, /modelo: roteamento\?\.aplicado \? roteamento\.modelo : p\.cfg\.modelo, esforco: roteamento\?\.aplicado \? roteamento\.esforco : undefined/);
  assert.match(resp, /custo_usd: custoDaResposta\(/, "o custo da resposta vai no registro (vira sara_mensagens.custo_usd)");
  assert.match(resp, /nivel:ferramentas->roteamento->>nivel/, "a continuação herda o nível da resposta anterior");
  assert.match(ler("lib/sara/laco.ts"), /p\.thinking\.type === "adaptive" \? Math\.max\(a\.maxTokens \?\? 1500, 8000\)/, "com o pensar adaptativo, o raciocínio cabe no limite de saída");
});
