import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { familiaDoGrv, grupoDoCodigo, gruposDaCarga, numeroGrv, prepararMaterial, unidadePadrao } from "../lib/almoxarifado/materiais-carga.ts";
import { normalizarMaterial, pendenciasDepois } from "../lib/almoxarifado/materiais.ts";

const REGRAS = { familiasComEstoque: new Set(["materia_prima", "embalagem", "produto_intermediario"]), gruposComEstoque: new Set(["EPI", "PRODUÇÃO"]), comprados: new Set(["8-10-00953"]) };
const linha = (x) => ({
  "Código Interno": "2-07-00589", "*Item": "BLANK COROA  GFA. CERVEJA 600ML ", "*Unidade de Inventário (Estoque)": "CJ", "*Família": "01 - MATERIA PRIMA",
  "Unidade para Compra Padrão": "CJ", Grupo: "BRONZE", "Sub Grupo 1": "BLANK FORMINHA", "Valor Custo Un. Inventário (?)": 331.6812, "Numero NCM": "84805000",
  "Plano de Contas": "BRONZE", "Tipo do Item": "01 – Matéria-Prima", "Estoque Meu Disponível": "425", ...x,
});

test("planilha do GRV: número, unidade, família e grupo pelo código", () => {
  assert.equal(numeroGrv("70,2"), 70.2);
  assert.equal(numeroGrv("8488,857"), 8488.857);
  assert.equal(numeroGrv("1.234,5"), 1234.5);
  assert.equal(numeroGrv("2875"), 2875);
  assert.equal(numeroGrv(""), 0);
  assert.equal(unidadePadrao("PC"), "PÇ");
  assert.equal(unidadePadrao("MT"), "M");
  assert.equal(unidadePadrao("KG"), "KG");
  assert.equal(familiaDoGrv("07 - MATERIAL DE USO E CONSUMO"), "uso_consumo");
  assert.deepEqual(grupoDoCodigo("8-10-00953"), { prefixo: "8", grupo: "10", sequencia: 953 });
  assert.equal(grupoDoCodigo("7860/001-2"), null);
});

test("material preparado: nome limpo, estoque pela família, pendências", () => {
  const m = prepararMaterial(linha({}), REGRAS);
  assert.equal(m.descricao, "BLANK COROA GFA. CERVEJA 600ML");
  assert.equal(m.controla_estoque, true);
  assert.equal(m.ativo, true);
  assert.deepEqual(m.pendencias, []);
  assert.equal(m.saldo_grv, 425);
  const semNcm = prepararMaterial(linha({ "Numero NCM": "", "Valor Custo Un. Inventário (?)": 0, "*Unidade de Inventário (Estoque)": "PC", "Plano de Contas": "DESPESAS DE VIAGEM", "Tipo do Item": "07 – Material de Uso e Consumo" }), REGRAS);
  assert.deepEqual(semNcm.pendencias.sort(), ["custo_zero", "plano_suspeito", "sem_ncm", "tipo_diverge", "unidade_ajustada"]);
  assert.equal(semNcm.unidade, "PÇ");
});

test("A1/A7: imobilizado e sem saldo/custo/compra entram inativos; comprado na plataforma fica ativo", () => {
  const imob = prepararMaterial(linha({ "Tipo do Item": "08 – Ativo Imobilizado" }), REGRAS);
  assert.equal(imob.ativo, false);
  assert.equal(imob.controla_estoque, false);
  const parado = { "*Família": "07 - MATERIAL DE USO E CONSUMO", Grupo: "PINTURA E OBRA", "Valor Custo Un. Inventário (?)": 0, "Estoque Meu Disponível": "0", "Tipo do Item": "" };
  assert.equal(prepararMaterial(linha({ ...parado, "Código Interno": "8-10-00001" }), REGRAS).ativo, false);
  assert.equal(prepararMaterial(linha({ ...parado, "Código Interno": "8-10-00953" }), REGRAS).ativo, true);
  // A2: uso e consumo só controla estoque nos grupos EPI e Produção.
  assert.equal(prepararMaterial(linha({ ...parado, "Valor Custo Un. Inventário (?)": 5 }), REGRAS).controla_estoque, false);
  assert.equal(prepararMaterial(linha({ ...parado, Grupo: "EPI", "Valor Custo Un. Inventário (?)": 5 }), REGRAS).controla_estoque, true);
});

test("grupos: nome e família pela maioria; próximo depois do maior código", () => {
  const ms = [
    prepararMaterial(linha({ "Código Interno": "8-10-00953", "*Família": "07 - MATERIAL DE USO E CONSUMO", Grupo: "PINTURA E OBRA" }), REGRAS),
    prepararMaterial(linha({ "Código Interno": "8-10-00960", "*Família": "07 - MATERIAL DE USO E CONSUMO", Grupo: "PINTURA E OBRA" }), REGRAS),
    prepararMaterial(linha({ "Código Interno": "8-10-00010", "*Família": "07 - MATERIAL DE USO E CONSUMO", Grupo: "DIVERSOS" }), REGRAS),
  ];
  const [g] = gruposDaCarga(ms, REGRAS);
  assert.deepEqual(g, { prefixo: "8", codigo: "10", nome: "PINTURA E OBRA", familia: "uso_consumo", proximo: 961, controla_estoque: false });
});

test("cadastro na tela: validação e pendências resolvidas", () => {
  const { material, erros } = normalizarMaterial({ descricao: " broca hss  10mm ", ncm: "8207.50.11", unidade: "pç", familia: "produto_intermediario" });
  assert.deepEqual(erros, []);
  assert.equal(material.descricao, "BROCA HSS 10MM");
  assert.equal(material.ncm, "82075011");
  assert.equal(material.unidade, "PÇ");
  assert.equal(normalizarMaterial({ descricao: "X", ncm: "123" }).erros.length, 1);
  assert.equal(normalizarMaterial({ descricao: "" }).erros.length, 1);
  assert.deepEqual(pendenciasDepois(["sem_ncm", "custo_zero", "sem_plano"], { ncm: "84805000", plano_contas: null }), ["custo_zero", "sem_plano"]);
});

test("migração: código imutável, sem apagar, busca com a permissão de quem chama", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610160001_almoxarifado_materiais.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("O código do material não muda depois de criado."));
  assert.ok(/revoke delete on public\.materials from anon, authenticated/.test(sql));
  assert.ok(/almoxarifado_materiais_buscar[\s\S]*security invoker/.test(sql));
  assert.ok(/materiais_pode_cadastrar\(\)[\s\S]*has_feature\('almoxarifado\.materiais', 'operar'\) or public\.has_feature\('compras\.cotacoes', 'operar'\)/.test(sql));
});
