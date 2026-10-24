import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const a = await import("../lib/sara/central/aprendizado.ts");

const agora = new Date("2026-10-24T12:00:00-03:00");
const diasAtras = (n) => new Date(agora.getTime() - n * 86_400_000).toISOString();
const linha = (o) => ({ tipo: "compras:compras.atrasadas", modulo: "compras", area: "Compras", titulo: "Pedidos atrasados", situacao: "resolvido", envios: [], created_at: diasAtras(30), resolvido_em: diasAtras(27), ...o });

test("aprendizado: conta vezes, respostas, resolvidos depois de 'Vou tratar', mediana de dias e recorrência", () => {
  const ls = [
    linha({ created_at: diasAtras(50), resolvido_em: diasAtras(46), envios: [{ resposta: "Vou tratar" }] }),
    linha({ created_at: diasAtras(30), resolvido_em: diasAtras(28), envios: [{ resposta: "Vou tratar" }] }),
    linha({ created_at: diasAtras(10), resolvido_em: null, situacao: "tratando", envios: [{ resposta: "Vou tratar" }] }),
    linha({ created_at: diasAtras(120), resolvido_em: diasAtras(119) }), // fora dos 90 dias
  ];
  const [t] = a.aprendizadoDaVigia(ls, agora);
  assert.equal(t.vezes, 3);
  assert.equal(t.respondidas, 3);
  assert.equal(t.resolvidos, 2);
  assert.equal(t.resolvidosDepoisDeTratar, 2);
  assert.equal(t.diasParaResolver, 3, "mediana de 4 e 2 dias");
  assert.equal(t.resolvidosRecentes, 2);
  assert.ok(t.recorrente, "saiu dos avisos 2 vezes em 60 dias e voltou");
  assert.ok(!t.propoeSilencio);
});

test("aprendizado: 'Não é problema' em 3 das últimas 4 respostas → perguntar se pode parar de avisar", () => {
  const nao = (d) => linha({ created_at: diasAtras(d), resolvido_em: null, situacao: "nao_e_problema", envios: [{ resposta: "Não é problema" }] });
  const t1 = a.aprendizadoDaVigia([nao(40), nao(30), linha({ created_at: diasAtras(20), envios: [{ resposta: "Vou tratar" }] }), nao(5)], agora)[0];
  assert.equal(t1.naoEProblema, 3);
  assert.ok(t1.propoeSilencio);
  const t2 = a.aprendizadoDaVigia([nao(40), nao(30)], agora)[0];
  assert.ok(!t2.propoeSilencio, "duas vezes ainda não basta");
  assert.match(a.textoDoSilencio(t1), /"Não é problema" em 3 das 4 vezes[\s\S]*"Pedidos atrasados" \(Compras\)/);
  assert.equal(a.respostaDaArea({ situacao: "enviado", envios: [{ resposta: "Vou tratar" }, { resposta: "Preciso de ajuda" }] }), "Preciso de ajuda");
  assert.equal(a.respostaDaArea({ situacao: "enviado", envios: [] }), null);
});

test("aprendizado: recorrente sobe um nível e o 'por que' diz quantas vezes (texto da plataforma)", () => {
  const rel = [{ tipo: "compras:compras.atrasadas", modulo: "compras", recorrente: true, resolvidosRecentes: 2 }];
  const r = a.comRecorrencia({ impacto: "medio", por_que: "Três pedidos passaram do prazo." }, rel);
  assert.equal(r.impacto, "alto");
  assert.ok(r.recorrente);
  assert.match(r.por_que, /^Recorrente: é a 3ª vez em 60 dias \(já saiu dos avisos 2 vezes e voltou\)\. Três pedidos/);
  assert.equal(a.comRecorrencia({ impacto: "alto", por_que: "x" }, rel).impacto, "alto");
  assert.deepEqual(a.comRecorrencia({ impacto: "baixo", por_que: "x" }, []), { impacto: "baixo", por_que: "x", recorrente: false });
  const ap = a.aprendizadoDaVigia([linha({})], agora);
  assert.equal(a.doMesmoProblema(ap, { modulo: "compras", tipos: ["compras.atrasadas"] }).length, 1);
  assert.equal(a.doMesmoProblema(ap, { modulo: "financeiro", tipos: ["compras.atrasadas"] }).length, 0, "outra área não é o mesmo problema");
});

test("aprendizado: lição validada (frase, até 500, sem CPF/PIS) e o bloco de memória separa lição (contexto) do histórico (números)", () => {
  assert.equal(a.validarLicao("curta").ok, false);
  assert.equal(a.validarLicao("x".repeat(501)).ok, false);
  assert.equal(a.validarLicao("O CPF dele é 123.456.789-00, paga em dia.").ok, false);
  assert.equal(a.validarLicao("PIS: 12345678901 do colaborador").ok, false);
  const ok = a.validarLicao("  FINIMP vence   por contrato com o banco, não é atraso. ");
  assert.deepEqual(ok, { ok: true, texto: "FINIMP vence por contrato com o banco, não é atraso." });
  const tipos = a.aprendizadoDaVigia([linha({ envios: [{ resposta: "Vou tratar" }] })], agora);
  const bloco = a.blocoDeAprendizado([
    { modulo: "financeiro", area: "Financeiro", texto: "FINIMP vence por contrato, não é atraso.", ensinada_por_nome: "Junior", decidida_por_nome: "Ana Claudia", efeito: "contexto" },
    { modulo: "compras", area: "Compras", texto: "silêncio", ensinada_por_nome: null, decidida_por_nome: "Ricardo", efeito: "silenciar" },
  ], tipos);
  assert.match(bloco, /O QUE A EMPRESA JÁ ENSINOU[\s\S]*NUNCA fonte de número[\s\S]*\[Financeiro\] FINIMP[\s\S]*aprovou: Ana Claudia/);
  assert.ok(!/silêncio/.test(bloco), "a lição de silêncio é da vigia, não entra no texto");
  assert.match(bloco, /O QUE A VIGIA APRENDEU[\s\S]*\[Compras\] "Pedidos atrasados": 1 vez em 90 dias; 1 saiu dos avisos \(1 depois de "Vou tratar"\), em 3 dias \(mediana\)\./);
  assert.equal(a.blocoDeAprendizado([], []), "");
});

test("aprendizado: ligado na central (propor_licao, memória e verificador), na área e na subagente; vigia com recorrência e silêncio", () => {
  const sessao = ler("lib/sara/sessao.ts");
  assert.match(sessao, /ferramentaProporLicao\(areas\.map/, "só a central propõe lição");
  assert.match(sessao, /const memoria = await memoriaDaSara\(\[modulo\], false\);[\s\S]*REGRA_SUBAGENTE\}\$\{memoria\.texto/, "a subagente usa as lições da área");
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /memoriaDaSara\(areasDaMemoria, Boolean\(p\.sara\.central\)\)/);
  assert.match(rota, /\.\.\.\(memoria\.tipos\.length \? \[memoria\.texto\] : \[\]\)/, "os números do histórico contam como fonte da central");
  const vigia = ler("lib/sara/central/vigia-executar.ts");
  assert.match(vigia, /comRecorrencia\(a, doMesmoProblema\(aprendido/);
  assert.match(vigia, /if \(!o\.responsaveis\) \{[\s\S]*sara_licao_criar/, "no teste a vigia não pergunta a quem trabalha");
  assert.match(vigia, /situacao: calado \? "silenciado" : "aberto"/);
  const mig = ler("supabase/migrations/202610240001_sara_licoes.sql");
  assert.match(mig, /grant execute on function public\.sara_licao_criar[^;]*to service_role;/);
  assert.match(mig, /revoke all on function public\.sara_licao_criar[^;]*authenticated;/, "a pessoa não cria lição direto, só pela função que confere");
  assert.match(mig, /if p_ensinou is not null and p_ensinou = any/, "quem responde pela área ensina e já vale");
  assert.match(mig, /after update of resposta on public\.decisoes/, "a resposta da área decide a lição");
  assert.match(mig, /Só quem responde pela área \(ou o proprietário\) desativa/);
  assert.match(ler("modules/warroom/src/Conselho.tsx"), /<Aprendizado \/>/);
});
