import test from "node:test";
import assert from "node:assert/strict";
import { areasPorDirecao, corposDosComponentes, eixoDaPeca, limparNome, montarCorpos, nomeBase } from "../geometria.mjs";
import { segredoConfere } from "../servidor.mjs";

// Montagem no formato do component.list do solidcraft-cli 0.30 (nomes como os do SolidWorks).
const LISTA = {
  components: [
    { id: 0, name: "Molde_Asm", bodies: [], occurrences: [] },
    { id: 3, name: "Blank_CHAVETA MACHO.STEP", bodies: ["NONE"], occurrences: [{ name: "Blank_CHAVETA MACHO.STEP:1" }] },
    { id: 5, name: "BAFFLE_SG_3.STEP", bodies: ["NONE (8)"], occurrences: [{ name: "BAFFLE_SG_3.STEP:1" }, { name: "BAFFLE_SG_3.STEP:2" }] },
  ],
};

test("componentes: nome sem extensão e contagem das ocorrências", () => {
  const m = corposDosComponentes(LISTA);
  assert.deepEqual(m.get("NONE"), { componente: "Blank_CHAVETA MACHO", ocorrencias: 1 });
  assert.deepEqual(m.get("NONE (8)"), { componente: "BAFFLE_SG_3", ocorrencias: 2 });
  assert.equal(limparNome("BP:1"), "BP");
});

test("nome base: a 2ª ocorrência volta ao corpo da definição, sem confundir NONE com NONE (8)", () => {
  const conhecidos = new Set(["NONE", "NONE (8)"]);
  assert.equal(nomeBase("NONE (8) (Molde_Asm:1/BAFFLE_SG_3.STEP:2)", conhecidos), "NONE (8)");
  assert.equal(nomeBase("NONE", conhecidos), "NONE");
  assert.equal(nomeBase("NONE (8)", conhecidos), "NONE (8)");
});

test("eixo: direção com mais área cilíndrica; sem cilindro, a medida diferente", () => {
  const faces = [
    { area: 100, cylinder: { axis: [0, -1, 0] } },
    { area: 30, cylinder: { axis: [1, 0, 0] } },
    { area: 50, cylinder: { axis: [0, 1, 0] } },
  ];
  assert.deepEqual(eixoDaPeca(faces, null), [0, 1, 0]);
  assert.deepEqual(eixoDaPeca([], { min: [0, 0, 0], max: [120, 120, 60] }), [0, 0, 1]);
  assert.equal(eixoDaPeca([], { min: [0, 0, 0], max: [10, 20, 30] }), null);
});

test("áreas: pontas são as planas perpendiculares ao eixo, o resto vai para as demais", () => {
  const faces = [
    { area: 10, plane_normal: [0, 1, 0] },
    { area: 20, plane_normal: [0, -1, 0] },
    { area: 5, plane_normal: [1, 0, 0] },
    { area: 40, cylinder: { axis: [0, 1, 0] } },
  ];
  assert.deepEqual(areasPorDirecao(faces, [0, 1, 0]), { pontas: 30, demais: 45 });
  assert.deepEqual(areasPorDirecao(faces, null), { pontas: 0, demais: 75 });
});

test("montar: junta medição, faces e montagem; ocorrência repetida vira uma linha", () => {
  const inspecao = {
    bodies: [
      { name: "NONE", volume_mm3: 2160730, area_mm2: 213800, closed: true, faces: 110, bbox: { min: [0, 0, 0], max: [200, 222, 99] } },
      { name: "NONE (8)", volume_mm3: 203170, area_mm2: 42000, closed: true, faces: 111, bbox: { min: [0, 0, 0], max: [112, 57, 112] } },
      { name: "NONE (8) (Molde_Asm:1/BAFFLE_SG_3.STEP:2)", volume_mm3: 203170, area_mm2: 42000, closed: true, faces: 111, bbox: { min: [0, 0, 0], max: [112, 57, 112] } },
    ],
  };
  const faces = new Map([["NONE (8)", [{ area: 9200, plane_normal: [0, 1, 0] }, { area: 32500, cylinder: { axis: [0, 1, 0] } }]]]);
  const corpos = montarCorpos(inspecao, faces, corposDosComponentes(LISTA));
  assert.equal(corpos.length, 2);
  const plato = corpos.find((c) => c.nome === "NONE (8)");
  assert.equal(plato.componente, "BAFFLE_SG_3");
  assert.equal(plato.ocorrencias, 2);
  assert.deepEqual(plato.eixo, [0, 1, 0]);
  assert.equal(plato.area_pontas_mm2, 9200);
  assert.equal(plato.area_demais_mm2, 32500);
});

test("volume negativo (parafuso espelhado) vira positivo e fica marcado", () => {
  const corpos = montarCorpos({ bodies: [{ name: "Parafuso", volume_mm3: -840, area_mm2: 500 }] }, new Map(), new Map());
  assert.equal(corpos[0].volume_mm3, 840);
  assert.equal(corpos[0].volume_negativo, true);
});

test("segredo: compara em tempo constante e recusa vazio", () => {
  const s = "x".repeat(32);
  assert.equal(segredoConfere(s, s), true);
  assert.equal(segredoConfere("y".repeat(32), s), false);
  assert.equal(segredoConfere(undefined, s), false);
  assert.equal(segredoConfere(s, ""), false);
});
