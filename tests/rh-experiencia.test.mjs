import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AVISO_EXPERIENCIA_DIAS, PERIODOS_EXPERIENCIA, avisarExperiencia, diasParaOFim, fimDaExperiencia, fraseDoAviso, periodoValido } from "../lib/rh/experiencia.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("experiência: o primeiro dia conta (60 dias a partir de 01/10 terminam em 29/11)", () => {
  assert.equal(fimDaExperiencia("2026-10-01", 60), "2026-11-29");
  assert.equal(fimDaExperiencia("2026-10-28", 90), "2027-01-25");
  assert.equal(fimDaExperiencia("2026-12-31", 60), "2027-02-28", "vira o ano");
  assert.deepEqual([...PERIODOS_EXPERIENCIA], [60, 90]);
  assert.ok(periodoValido(60) && periodoValido("90"));
  assert.ok(!periodoValido(45) && !periodoValido(null) && !periodoValido(undefined));
});

test("experiência: avisa do D−2 até o dia do vencimento, nunca antes nem depois", () => {
  const fim = "2026-11-29";
  assert.equal(AVISO_EXPERIENCIA_DIAS, 2);
  assert.equal(avisarExperiencia("2026-11-26", fim), false, "D−3 ainda não");
  assert.equal(avisarExperiencia("2026-11-27", fim), true, "D−2");
  assert.equal(avisarExperiencia("2026-11-28", fim), true, "D−1 (se o D−2 caiu no domingo, o Bom dia de segunda ainda avisa)");
  assert.equal(avisarExperiencia("2026-11-29", fim), true, "no dia");
  assert.equal(avisarExperiencia("2026-11-30", fim), false, "venceu");
  assert.equal(diasParaOFim("2026-11-27", fim), 2);
});

test("experiência: a frase do aviso diz quem, quantos dias faltam e o período", () => {
  const base = { nome: "Jorge Jesus", periodo: 60, fim: "2026-11-29" };
  assert.equal(fraseDoAviso({ ...base, hoje: "2026-11-27" }), "Jorge Jesus, em experiência, está a 2 dias do vencimento do seu período de 60 dias (vence em 29/11/2026).");
  assert.equal(fraseDoAviso({ ...base, periodo: 90, hoje: "2026-11-28" }), "Jorge Jesus, em experiência, está a 1 dia do vencimento do seu período de 90 dias (vence em 29/11/2026).");
  assert.equal(fraseDoAviso({ ...base, hoje: "2026-11-29" }), "Jorge Jesus, em experiência, tem o seu período de 60 dias vencendo hoje (29/11/2026).");
});

test("experiência: o banco calcula o mesmo fim, o aviso vai a quem decide no RH e uma vez só", () => {
  const sql = ler("supabase/migrations/202610280003_rh_contrato_experiencia.sql");
  assert.match(sql, /experiencia_inicio \+ \(experiencia_dias - 1\)/);
  assert.match(sql, /check \(experiencia_dias in \(60, 90\)\)/);
  assert.match(sql, /primary key \(employee_id, vence\)/);
  const aviso = ler("lib/rh/experiencia-avisos.ts");
  assert.match(aviso, /from\("sara_responsaveis"\)[\s\S]*\.eq\("modulo", "rh"\)/);
  assert.doesNotMatch(aviso, /is_owner/, "nunca cai no proprietário por padrão");
  assert.match(aviso, /ignoreDuplicates: true/);
  // A regra da SARA do RH leva o mesmo aviso ao Bom dia (sino e WhatsApp).
  assert.match(ler("lib/sara/agentes/rh.ts"), /chave: `rh\.experiencia:/);
  assert.match(ler("app/api/sara/bom-dia/rodar/route.ts"), /avisarFimDeExperiencia/);
});
