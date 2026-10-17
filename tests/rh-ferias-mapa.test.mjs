import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { diasNoMes, mesMais, montarMapa } from "../lib/rh/ferias-mapa.ts";

test("mapa de férias: meses e dias que caem em cada mês", () => {
  assert.equal(mesMais("2026-10", 0), "2026-10");
  assert.equal(mesMais("2026-10", 3), "2027-01");
  assert.equal(mesMais("2026-12", 1), "2027-01");
  assert.equal(diasNoMes("2026-10-20", "2026-11-18", "2026-10"), 12);
  assert.equal(diasNoMes("2026-10-20", "2026-11-18", "2026-11"), 18);
  assert.equal(diasNoMes("2026-10-20", "2026-11-18", "2026-12"), 0);
  assert.equal(diasNoMes("2027-02-01", "2027-03-02", "2027-02"), 28);
});

test("mapa de férias: setor × mês, parte do setor fora, concessivos vencidos e a vencer", () => {
  const d = {
    hoje: "2026-10-17", inicio: "2026-10-01", fim: "2027-09-30",
    setores: [{ id: "u", nome: "Usinagem", ativos: 4 }, { id: "f", nome: "Fundição", ativos: 2 }],
    ferias: [
      { employee: "a", nome: "Ana", setor: "u", inicio: "2026-10-20", fim: "2026-11-18", status: "approved" },
      { employee: "b", nome: "Bruno", setor: "u", inicio: "2026-11-01", fim: "2026-11-10", status: "registered" },
      { employee: "b", nome: "Bruno", setor: "u", inicio: "2026-11-20", fim: "2026-11-24", status: "registered" },
      { employee: "c", nome: "Caio", setor: "f", inicio: "2027-01-05", fim: "2027-01-24", status: "approved" },
    ],
    concessivos: [
      { employee: "d", nome: "Davi", setor: "u", vence: "2026-08-01", saldo: 30, aquisitivoInicio: "2024-07-01", aquisitivoFim: "2025-06-30" },
      { employee: "e", nome: "Eva", setor: "f", vence: "2026-12-10", saldo: 20, aquisitivoInicio: "2025-01-01", aquisitivoFim: "2025-12-31" },
    ],
  };
  const m = montarMapa(d);
  assert.equal(m.meses.length, 12);
  assert.deepEqual(m.meses[0], { chave: "2026-10", rotulo: "out/26" });
  const u = m.linhas[0];
  assert.equal(u.celulas[0].fora.length, 1);
  assert.equal(u.celulas[1].fora.length, 2, "novembro: Ana e Bruno");
  assert.equal(u.celulas[1].fora.find((x) => x.employee === "b").diasNoMes, 15, "dois períodos do Bruno somados no mês");
  assert.equal(u.celulas[1].parte, 0.5);
  assert.deepEqual(u.vencidos.map((c) => c.nome), ["Davi"]);
  const f = m.linhas[1];
  assert.deepEqual(f.celulas[2].vencem.map((c) => c.nome), ["Eva"], "vence em dezembro");
  assert.equal(f.celulas[3].parte, 0.5);
  assert.equal(m.vencidos, 1);
  assert.equal(m.vencemNaJanela, 1);
  assert.deepEqual(m.maiorParte, { setor: "Usinagem", mes: "2026-11", parte: 0.5 });
});

test("mapa de férias: função do banco é de quem tem Férias e ausências", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610170009_rh_ferias_mapa.sql", import.meta.url), "utf8");
  assert.match(sql, /has_feature\('rh\.ferias'\)/);
  assert.match(sql, /a\.status::text in \('approved', 'registered'\)/);
  assert.match(sql, /b\.entitled_days - b\.taken_days - b\.scheduled_days - b\.pecuniary_days > 0/);
});
