import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CENARIOS, contasAtrasadas, diaDaParcela, explicar, projetar, saldoDePartida, vencidoAPagar } from "../lib/finance/fluxo-90.ts";

const HOJE = "2026-10-17";
const p = (o) => ({ id: o.id ?? Math.random().toString(36), direcao: "entra", vencimento: HOJE, valor: 100, previsao: false, emAprovacao: false, quem: "X", descricao: null, documento: null, ...o });

test("fluxo 90: dia de cada parcela conforme o cenário", () => {
  const base = CENARIOS.base.regras, cons = CENARIOS.conservador.regras, oti = CENARIOS.otimista.regras;
  assert.equal(diaDaParcela(p({ vencimento: "2026-10-27" }), base, HOJE), 10);
  assert.equal(diaDaParcela(p({ vencimento: "2026-10-27" }), cons, HOJE), 25, "conservador atrasa o recebimento 15 dias");
  assert.equal(diaDaParcela(p({ direcao: "sai", vencimento: "2026-10-27" }), cons, HOJE), 10, "pagamento não atrasa");
  // Vencidos (até 90 dias): a pagar sai hoje; a receber depende do cenário.
  assert.equal(diaDaParcela(p({ direcao: "sai", vencimento: "2026-09-01" }), base, HOJE), 0);
  assert.equal(diaDaParcela(p({ vencimento: "2026-09-01" }), oti, HOJE), 0);
  assert.equal(diaDaParcela(p({ vencimento: "2026-09-01" }), base, HOJE), 30);
  assert.equal(diaDaParcela(p({ vencimento: "2026-09-01" }), cons, HOJE), null);
  // Vencido há mais de 90 dias: fora sempre.
  assert.equal(diaDaParcela(p({ direcao: "sai", vencimento: "2026-07-01" }), oti, HOJE), null);
  // Depois do horizonte: fora.
  assert.equal(diaDaParcela(p({ vencimento: "2027-01-16" }), base, HOJE), null);
  assert.equal(diaDaParcela(p({ vencimento: "2027-01-15" }), base, HOJE), 90);
  // Previsões.
  assert.equal(diaDaParcela(p({ previsao: true, vencimento: "2026-10-20" }), base, HOJE), null);
  assert.equal(diaDaParcela(p({ previsao: true, vencimento: "2026-10-20" }), oti, HOJE), 3);
  assert.equal(diaDaParcela(p({ previsao: true, direcao: "sai", vencimento: "2026-10-20" }), cons, HOJE), 3, "conservador conta previsão de saída");
  assert.equal(diaDaParcela(p({ previsao: true, vencimento: "2026-10-20" }), cons, HOJE), null, "e não a de entrada");
  // Previsão vencida não virou conta: fora em todos os cenários.
  assert.equal(diaDaParcela(p({ previsao: true, direcao: "sai", vencimento: "2026-10-09" }), cons, HOJE), null);
  assert.equal(diaDaParcela(p({ previsao: true, vencimento: "2026-10-09" }), oti, HOJE), null);
});

test("fluxo 90: saldo dia a dia, menor saldo, primeiro dia negativo e as 13 semanas", () => {
  const parcelas = [
    p({ direcao: "sai", vencimento: "2026-10-20", valor: 1500.1 }),
    p({ vencimento: "2026-10-30", valor: 800.05 }),
    p({ direcao: "sai", vencimento: "2026-09-30", valor: 200 }),
  ];
  const r = projetar(parcelas, CENARIOS.base.regras, HOJE, 1000);
  assert.equal(r.dias.length, 91);
  assert.equal(r.dias[0].saldo, 800, "a pagar vencido sai hoje");
  assert.equal(r.dias[3].saldo, -700.1);
  assert.equal(r.primeiroNegativo, "2026-10-20");
  assert.deepEqual(r.menor, { valor: -700.1, data: "2026-10-20" });
  assert.equal(r.saldoFinal, 99.95);
  assert.equal(r.entra, 800.05);
  assert.equal(r.sai, 1700.1);
  assert.equal(r.semanas.length, 13);
  assert.equal(r.semanas[0].inicio, HOJE);
  assert.equal(r.semanas[12].fim, "2027-01-15");
  assert.equal(r.semanas[0].sai, 1700.1);
  assert.equal(r.semanas[1].entra, 800.05);
  assert.equal(r.semanas[0].parcelas[0].valor, 1500.1, "maiores primeiro");
});

test("fluxo 90: saldo de partida, extrato atrasado e a pagar vencido", () => {
  const contas = [
    { id: "a", nome: "Itaú", agencia: null, conta: null, saldo: 100.1, ultimo: "2026-10-15" },
    { id: "b", nome: "Bradesco", agencia: null, conta: null, saldo: 50.2, ultimo: "2026-07-02" },
  ];
  assert.equal(saldoDePartida(contas), 150.3);
  assert.equal(saldoDePartida(contas, { b: 10 }), 110.1, "o saldo digitado vale para a conta");
  assert.deepEqual(contasAtrasadas(contas, HOJE).map((c) => c.id), ["b"]);
  const v = vencidoAPagar([p({ direcao: "sai", vencimento: "2026-10-01", valor: 10 }), p({ direcao: "sai", vencimento: "2026-05-01" }), p({ vencimento: "2026-10-01" })], HOJE);
  assert.deepEqual(v, { valor: 10, n: 1 });
  assert.equal(explicar(CENARIOS.conservador.regras).length, 5);
});

test("fluxo 90: a função do banco é de quem tem o Fluxo de caixa, sem exceção do proprietário", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610170007_fluxo_90_dias.sql", import.meta.url), "utf8");
  assert.match(sql, /has_feature\('financeiro\.fluxo'\) or public\.has_feature\('financeiro\.relatorios'\)/);
  assert.match(sql, /i\.due_date between hoje - 90 and hoje \+ 120/);
  assert.doesNotMatch(sql, /is_owner\(\)/);
});
