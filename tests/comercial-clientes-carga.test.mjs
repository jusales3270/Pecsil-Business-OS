import assert from "node:assert/strict";
import test from "node:test";
import { camposDoCliente, planejarClientes } from "../lib/comercial/clientes-carga.ts";

const L = (o) => ({ "*Nome": o.nome ?? o.razao, "R. Social": o.razao, "Pessoa": o.pf ? "Fisíca" : "Jurídica", "CNPJ / CPF": o.doc ?? null, "I.E. / RG": o.ie ?? null,
  "Telefone (1)": o.fone ?? null, "DDD do Telefone do Cliente": o.ddd ?? null, "CEP": o.cep ?? null, "Endereço": o.end ?? null, "Bairro": o.bairro ?? null,
  "Cidade": o.cidade ?? null, "U.F.": o.uf ?? null, "Pais": o.pais ?? "BRASIL", "Indicador do IE do Destinatário": o.ind ?? null });
const C = (o) => ({ id: o.id, name: o.name, tax_id: null, ie: null, ind_ie: null, cep: null, logradouro: null, numero: null, complemento: null, bairro: null, municipio: null, codigo_municipio: null, uf: null, telefone: null, email_nfe: null, merged_into: null, ...o });

test("clientes GRV: campos no formato do destinatário da NF-e", () => {
  assert.deepEqual(camposDoCliente(L({ razao: "ALFA TREND LTDA", doc: "04.482.833/0001-97", ie: "353.204.651.110", ind: "1 - Contribuinte ICMS", fone: "3935-2907", ddd: "19", cep: "13.347-190", end: "RUA MACASSIT", bairro: "RECREIO", cidade: "INDAIATUBA", uf: "sp" })),
    { tax_id: "04482833000197", ie: "353204651110", ind_ie: 1, cep: "13347190", logradouro: "RUA MACASSIT", bairro: "RECREIO", municipio: "INDAIATUBA", uf: "SP", telefone: "1939352907" });
  assert.equal(camposDoCliente(L({ razao: "X", ie: "Isento" })).ie, "ISENTO");
});

test("clientes GRV: só PJ do Brasil sem ambiguidade; fábricas, duplicados, exterior e PF ficam de fora", () => {
  const planilha = [
    L({ razao: "WHEATON BRASIL VIDROS LTDA", doc: "60750056000195", cidade: "SAO BERNARDO DO CAMPO", uf: "SP" }),
    L({ nome: "O-I / SP", razao: "OWENS-ILLINOIS DO BRASIL INDÚSTRIA E COMÉRCIO LTDA.", doc: "08910541000320", cidade: "SAO PAULO", uf: "SP" }),
    L({ nome: "O-I / RJ", razao: "OWENS-ILLINOIS DO BRASIL INDÚSTRIA E COMÉRCIO LTDA.", doc: "08910541000240", cidade: "RIO DE JANEIRO", uf: "RJ" }),
    L({ nome: "NADIR", razao: "NADIR FIGUEIREDO INDÚSTRIA E COMÉRCIO S. A", doc: "61067161001835", uf: "SP" }),
    L({ razao: "PARGLASS S.A", doc: "0000", pais: "PARAGUAI", uf: "EX" }),
    L({ razao: "ANA CLAUDIA F DA SILVA", pf: true, doc: "27355413805" }),
    L({ razao: "ARDAGH GLASS PACKAGING BRASIL LTDA.", doc: "43682668000179", cidade: "JUIZ DE FORA", uf: "MG" }),
  ];
  const plataforma = [
    C({ id: "w", name: "WHEATON BRASIL VIDROS LTDA" }),
    C({ id: "oi", name: "OWENS-ILLINOIS DO BRASIL INDÚSTRIA E COMÉRCIO LTDA." }),
    C({ id: "n1", name: "Nadir" }), C({ id: "n2", name: "NADIR FIGUEIREDO INDÚSTRIA E COMÉRCIO" }),
    C({ id: "p", name: "PARGLASS" }),
    C({ id: "a", name: "ANA CLAUDIA F DA SILVA" }),
    C({ id: "x", name: "Pecsil - Catálogo Interno (Moldes)" }),
  ];
  const p = planejarClientes(planilha, plataforma);
  assert.deepEqual(p.completar.map((x) => x.id), ["w"]);
  assert.equal(p.completar[0].campos.tax_id, "60750056000195");
  assert.deepEqual(p.fabricas.map((x) => x.id), ["oi"], "O-I tem várias fábricas: o Comercial escolhe");
  assert.equal(p.fabricas[0].opcoes.length, 2);
  assert.deepEqual(p.duplicados.map((d) => d.nomes.sort()), [["NADIR FIGUEIREDO INDÚSTRIA E COMÉRCIO", "Nadir"].sort()]);
  assert.deepEqual(p.exterior.map((x) => x.id), ["p"]);
  assert.deepEqual(p.pessoaFisica.map((x) => x.id), ["a"]);
  assert.ok(!JSON.stringify(p.completar).includes("27355413805"), "CPF nunca entra");
  assert.deepEqual(p.semPar.map((x) => x.id), ["x"]);
  assert.deepEqual(p.novos.map((x) => x.razao), ["ARDAGH GLASS PACKAGING BRASIL LTDA."]);
});
