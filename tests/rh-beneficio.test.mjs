import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aplicarAprovacao, custoDoPlano, lerValorEmReais, mediaPorParticipante, resumoDaFicha, valorParaDigitar, vigenciaSugerida } from "../lib/rh/beneficio.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("benefício: valor digitado em reais, do jeito que se escreve no Brasil", () => {
  assert.equal(lerValorEmReais("1.234,56"), 1234.56);
  assert.equal(lerValorEmReais("R$ 85,90"), 85.9);
  assert.equal(lerValorEmReais("120"), 120);
  assert.equal(lerValorEmReais("120.5"), 120.5, "ponto com 1 ou 2 casas é decimal");
  assert.equal(lerValorEmReais("12.500"), 12500, "ponto com 3 dígitos é milhar");
  assert.equal(lerValorEmReais("0"), 0);
  assert.equal(lerValorEmReais("0,00"), 0);
  for (const ruim of ["", "  ", "-10", "abc", "1,234,5", "10,999", "1e5"]) assert.equal(lerValorEmReais(ruim), null, ruim);
});

test("benefício: o valor gravado volta para o campo no formato digitável", () => {
  assert.equal(valorParaDigitar(1234.5), "1.234,50");
  assert.equal(valorParaDigitar(0), "0,00");
  assert.equal(lerValorEmReais(valorParaDigitar(98765.43)), 98765.43);
});

test("benefício: média por participante não divide por zero", () => {
  assert.equal(mediaPorParticipante(1000, 0), null);
  assert.equal(mediaPorParticipante(1000, 4), 250);
});

test("benefício: vigência sugerida é o dia 1º do mês seguinte", () => {
  assert.equal(vigenciaSugerida("2026-10-29"), "2026-11-01");
  assert.equal(vigenciaSugerida("2026-12-05"), "2027-01-01");
  assert.equal(vigenciaSugerida("2027-01-31"), "2027-02-01");
});

test("benefício: tela e servidor ligados (edição dos valores, sem data fixa, sem divisão por zero)", () => {
  const tela = ler("app/components/hr-module.tsx");
  assert.ok(!tela.includes('useState("2026-08-01")'), "vigência não é mais data fixa");
  assert.ok(tela.includes("vigenciaSugerida(hojeBrasilia())"));
  assert.ok(tela.includes('entity:"benefit_plan"') && tela.includes("Editar valores"));
  assert.ok(tela.includes('className="benefit-adhesion"'), "texto da adesão fora da barra");
  const servidor = ler("lib/data/rh-mutations.ts");
  assert.ok(servidor.includes('mutation.entity === "benefit_plan"') && servidor.includes("monthly_cost:"));
});

test("benefício: a movimentação leva vários benefícios, cada um com o valor mensal", () => {
  const tela = ler("app/components/hr-module.tsx");
  assert.ok(tela.includes("Incluir outro benefício") && tela.includes("Valor mensal (R$) *"));
  assert.ok(tela.includes('entity:"benefit_requests"') && tela.includes("monthlyValue:request.value"));
  const servidor = ler("lib/data/rh-mutations.ts");
  assert.ok(servidor.includes("export async function createRhBenefitRequests") && servidor.includes("monthly_value: valorMensal(draft.monthlyValue)"));
  assert.ok(servidor.includes("new Set(drafts.map(d => d.planId)).size !== drafts.length"), "benefício repetido é recusado");
  assert.ok(ler("lib/data/rh-repository.ts").includes("monthly_value,requested_at"));
  assert.ok(ler("supabase/migrations/202610290004_rh_beneficio_valor_solicitacao.sql").includes("add column if not exists monthly_value numeric(18,2)"));
});

test("benefício: custo do painel = soma das adesões; sem valor nelas, o custo do catálogo", () => {
  assert.equal(custoDoPlano(0, [{ valor: 345.14 }, { valor: 512.1 }]), 857.24);
  assert.equal(custoDoPlano(1200, []), 1200);
  assert.equal(custoDoPlano(1200, [{ valor: null }]), 1200);
  assert.equal(custoDoPlano(0, [{ valor: 5.76 }, { valor: null }, { valor: 5.76 }]), 11.52);
});

test("benefício: aprovação vira adesão (adesão, alteração, cancelamento, dependente)", () => {
  const base = { planId: "p1", planName: "Convênio médico", employeeId: "e1", employeeName: "Ana", department: "RH" };
  let a = aplicarAprovacao([], { ...base, acao: "enroll", vigencia: "2026-12-01", valor: 345.14 });
  assert.deepEqual(a.map((x) => [x.inicio, x.valor]), [["2026-12-01", 345.14]]);
  a = aplicarAprovacao(a, { ...base, acao: "change", vigencia: "2027-01-01", valor: 400 });
  assert.deepEqual(a.map((x) => [x.inicio, x.valor]), [["2026-12-01", 400]], "alteração troca o valor e mantém o início");
  assert.equal(aplicarAprovacao(a, { ...base, acao: "add_dependent", vigencia: "2027-01-01", valor: null }), a);
  a = aplicarAprovacao(a, { ...base, acao: "enroll", vigencia: "2027-02-01", valor: null });
  assert.equal(a.length, 1, "nunca duas adesões da mesma pessoa no mesmo benefício");
  assert.equal(a[0].valor, 400, "sem valor novo, fica o que tinha");
  assert.deepEqual(aplicarAprovacao(a, { ...base, acao: "cancel", vigencia: "2027-03-01", valor: null }), []);
});

test("benefício: aprovar no banco cria a adesão (gatilho) e o painel lê as adesões com valor", () => {
  const mig = ler("supabase/migrations/202611030001_rh_beneficio_adesao.sql");
  assert.match(mig, /after update of status on public\.rh_benefit_requests/);
  assert.match(mig, /on conflict \(plan_id, employee_id\)/);
  assert.match(mig, /status = 'approved' order by decided_at/, "as já aprovadas entram");
  const repo = ler("lib/data/rh-repository.ts");
  assert.match(repo, /rh_benefit_enrollments"\)\.select\("plan_id,employee_id,enrolled_at,monthly_value/);
  assert.doesNotMatch(repo, /rh_benefit_requests"\)[\s\S]{0,300}\.limit\(20\)/, "a lista de solicitações não pode parar nas 20 últimas");
});

test("ficha › Benefícios: em vigor, total por mês, em aprovação e as que começam depois", () => {
  const ad = (ativa, inicio, valor) => ({ id: inicio, plano: "x", fornecedor: null, contribuicao: null, regra: null, inicio, fim: null, ativa, valor, dependentes: [] });
  const mov = (situacao) => ({ id: situacao, plano: "x", acao: "enroll", situacao, vigencia: null, valor: null, justificativa: null, pedidaEm: "2026-10-30T12:00:00Z", pedidaPor: null, decididaEm: null, decididaPor: null });
  const r = resumoDaFicha({ adesoes: [ad(true, "2026-07-10", 714.5), ad(true, "2027-05-01", 5.76), ad(false, "2025-01-01", 100)], movimentacoes: [mov("pending"), mov("under_review"), mov("approved"), mov("rejected")] }, "2026-11-03");
  assert.deepEqual(r, { emVigor: 2, totalMensal: 720.26, emAprovacao: 2, futuras: 1 });
});

test("ficha › Benefícios: aba só com RH › Benefícios, dados lidos na hora pela sessão", () => {
  const rota = ler("app/api/rh/beneficios/route.ts");
  assert.match(rota, /requireFeature\("rh\.beneficios"\)/);
  assert.match(rota, /guard\.supabase\.from\("rh_benefit_enrollments"\)/, "pela sessão (RLS), nunca pela chave de serviço");
  assert.doesNotMatch(rota, /createSupabaseAdminClient/);
  const tela = ler("app/components/hr-module.tsx");
  assert.match(tela, /item !== "Benefícios" \|\| \(canViewBenefits && Boolean\(employee\.id\)\)/);
  assert.match(tela, /\/api\/rh\/beneficios\?colaborador=/);
});
