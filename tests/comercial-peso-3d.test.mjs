import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classificar, linhas, medidas, pesar, regraDe, resumoPorTipo, volumeBruto } from "../lib/comercial/peso-3d.ts";

// Medição real do piloto de 05/11/2026 (duas montagens exportadas do SolidWorks 2026).
const PILOTO = JSON.parse(readFileSync(new URL("./fixtures/medicao-molde-piloto.json", import.meta.url), "utf8"));
const FERRO = { id: "ferro", nome: "Ferro fundido", densidade_g_cm3: 7.2, padrao: true };
const BRONZE = { id: "bronze", nome: "Bronze", densidade_g_cm3: 8.8 };
// A regra do Rafael (05/11): Fundo e Platô sempre; Forma, Bloco e Funil só em Bronze.
const REGRAS = [
  { tipo_peca: "fundo", liga_id: null, mm_diametro: 2, mm_comprimento: 4 },
  { tipo_peca: "plato", liga_id: null, mm_diametro: 2, mm_comprimento: 4 },
  ...["forma", "bloco", "funil"].map((t) => ({ tipo_peca: t, liga_id: "bronze", mm_diametro: 2, mm_comprimento: 4 })),
];

const resumo = (corpos, liga = FERRO) => Object.fromEntries(resumoPorTipo(linhas(corpos, {}, [FERRO, BRONZE], liga.id, REGRAS)).map((r) => [r.tipo, r]));

test("reconhece as peças das duas montagens e deixa a garrafa, a pré-forma e a ferragem de fora", () => {
  const blow = classificar(PILOTO.blow);
  const tipoDe = (lista, comp) => lista.get(PILOTO.blow.concat(PILOTO.blank).find((c) => c.componente === comp).nome).tipo;
  assert.equal(tipoDe(blow, "Blow_Mould_Chaveta_F"), "forma");
  assert.equal(tipoDe(blow, "Blow_Mould_Chaveta_M"), "forma");
  assert.equal(tipoDe(blow, "BP"), "fundo");
  assert.equal(tipoDe(blow, "DG-0006-00"), "garrafa");
  assert.equal(tipoDe(blow, "BP _Pino"), "ferragem");
  const blank = classificar(PILOTO.blank);
  assert.equal(tipoDe(blank, "Blank_CHAVETA MACHO"), "bloco");
  assert.equal(tipoDe(blank, "Blank_CHAVETA FEMEA"), "bloco");
  assert.equal(tipoDe(blank, "FUNNEL_N3"), "funil");
  assert.equal(tipoDe(blank, "BAFFLE_SG_3"), "plato");
  const preforma = PILOTO.blank.filter((c) => c.componente === "ML_0006");
  for (const c of preforma) assert.equal(blank.get(c.nome).tipo, "garrafa");
});

test("peso acabado em ferro bate com o SolidWorks nas cinco peças (arredondamento de 2 casas + 0,1%)", () => {
  const sw = PILOTO.pesos_solidworks_kg;
  const r = { ...resumo(PILOTO.blow), ...resumo(PILOTO.blank) };
  for (const t of ["forma", "fundo", "bloco", "plato", "funil"]) {
    assert.ok(Math.abs(r[t].acabado_kg - sw[t]) <= 0.005 + 0.001 * sw[t], `${t}: ${r[t].acabado_kg} × ${sw[t]}`);
  }
  assert.equal(r.forma.corpos, 2);
  assert.equal(r.bloco.corpos, 2);
});

test("bruto em ferro: sobremetal só no Fundo e no Platô", () => {
  const r = { ...resumo(PILOTO.blow), ...resumo(PILOTO.blank) };
  assert.ok(Math.abs(r.fundo.bruto_kg - 9.955) < 0.005, `fundo ${r.fundo.bruto_kg}`);
  assert.ok(Math.abs(r.plato.bruto_kg - 1.829) < 0.005, `plato ${r.plato.bruto_kg}`);
  assert.equal(r.forma.bruto_kg, r.forma.acabado_kg);
  assert.equal(r.bloco.bruto_kg, r.bloco.acabado_kg);
  assert.equal(r.funil.bruto_kg, r.funil.acabado_kg);
});

test("em bronze todas as peças ganham sobremetal", () => {
  const r = resumo(PILOTO.blow, BRONZE);
  assert.ok(r.forma.bruto_kg > r.forma.acabado_kg);
  assert.ok(r.fundo.bruto_kg > r.fundo.acabado_kg);
  assert.ok(Math.abs(r.forma.acabado_kg - 49.39 / 7.2 * 8.8) < 0.01);
});

test("o método da área confere com um cilindro de resposta exata", () => {
  const D = 197, L = 112;
  const cilindro = { volume_mm3: Math.PI / 4 * D * D * L, area_pontas_mm2: 2 * Math.PI / 4 * D * D, area_demais_mm2: Math.PI * D * L, eixo: [0, 1, 0] };
  const exato = Math.PI / 4 * (D + 2) ** 2 * (L + 4);
  assert.ok(Math.abs(volumeBruto(cilindro, 2, 4) - exato) / exato < 0.001);
});

test("regra: a da liga vence a geral; sem regra, sem sobremetal; ajuste do Rafael vale", () => {
  assert.equal(regraDe(REGRAS, "forma", "ferro"), null);
  assert.equal(regraDe(REGRAS, "forma", "bronze").liga_id, "bronze");
  assert.equal(regraDe(REGRAS, "fundo", "bronze").liga_id, null);
  const fundo = PILOTO.blow.find((c) => c.componente === "BP");
  assert.equal(pesar(fundo, "garrafa", FERRO, REGRAS), null);
  const ls = linhas(PILOTO.blow, { [fundo.nome]: { tipo: "outro" } }, [FERRO], null, REGRAS);
  const l = ls.find((x) => x.corpo.nome === fundo.nome);
  assert.equal(l.tipo, "outro");
  assert.equal(l.ajustado, true);
  assert.equal(l.peso.bruto_kg, l.peso.acabado_kg);
});

test("medidas: diâmetro e comprimento pelo eixo", () => {
  const fundo = PILOTO.blow.find((c) => c.componente === "BP");
  const m = medidas(fundo);
  assert.equal(Math.round(m.diametro), 197);
  assert.equal(Math.round(m.comprimento), 112);
});

// STEP do Creo (06/11): os corpos vêm pelo código do desenho (…-F-…-MACHO, …-FF-BASE…), sem palavra "forma".
const CREO = JSON.parse(readFileSync(new URL("./fixtures/medicao-codigo-creo.json", import.meta.url), "utf8")).corpos;

test("código do desenho: F = forma (metades), FF = fundo, a garrafa entre as metades e os parafusos ficam fora", () => {
  const t = classificar(CREO);
  const tipo = (sufixo) => t.get(CREO.find((c) => (c.componente ?? c.nome).endsWith(sufixo)).nome).tipo;
  assert.equal(tipo("F-VFW-MACHO"), "forma");
  assert.equal(tipo("F-VFW-FEMEA"), "forma");
  assert.equal(tipo("FF-BASE_AF1"), "fundo");
  assert.equal(tipo("FF-VFW_AF2"), "fundo");
  assert.equal(tipo("CF-VFW"), "garrafa");
  assert.equal(tipo("ISHCS0802"), "ferragem");
  const r = Object.fromEntries(resumoPorTipo(linhas(CREO, {}, [FERRO], "ferro", REGRAS)).map((x) => [x.tipo, x]));
  assert.equal(r.forma.corpos, 2);
  assert.ok(Math.abs(r.forma.acabado_kg - 24.023) < 0.01, `forma ${r.forma.acabado_kg}`);
  assert.equal(r.fundo.corpos, 2);
  assert.ok(r.fundo.bruto_kg > r.fundo.acabado_kg);
});
