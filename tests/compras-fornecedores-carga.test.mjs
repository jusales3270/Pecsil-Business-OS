import assert from "node:assert/strict";
import test from "node:test";
import { camposDaLinha, normNome, planejarCarga } from "../lib/compras/fornecedores-carga.ts";

const L = (o) => ({ "*Nome": o.nome ?? o.razao, "*Razão Social": o.razao, "Tipo de Pessoa": o.pf ? "Fisíca" : "Jurídica", "*C.N.P.J/CPF": o.doc ?? null,
  "I.E./RG": o.ie ?? null, "*Tipo de Fornecedor": o.tipo ?? "Fornecedor", "Telefone (1)": o.fone ?? null, "Inativo": o.inativo ? "Sim" : "Não",
  "Endereço": o.end ?? null, "Bairro": o.bairro ?? null, "Cidade": o.cidade ?? null, "*Estado": o.uf ?? null, "CEP": o.cep ?? null, "E-mail": o.email ?? null, "Contato": o.contato ?? null });
const F = (o) => ({ id: o.id, name: o.name, legal_name: null, trade_name: null, tax_id: null, state_registration: null, contact_name: null, phone: null, email: null, address: null, city: null, state: null, postal_code: null, merged_into: null, ...o });

test("fornecedores GRV: campos validados e no formato da plataforma", () => {
  const c = camposDaLinha(L({ razao: "ALLTECH TOOLS DO BRASIL LTDA", doc: "37.842.058/0001-92", ie: "129333505114", fone: "(11) 2743-2723", end: "RUA X", bairro: "CENTRO", cidade: "ITU", uf: "sp", cep: "13.301-000", email: "Vendas@Alltech.com.br; outro@x.com", contato: "MARCOS" }));
  assert.deepEqual(c, { tax_id: "37842058000192", state_registration: "129333505114", email: "vendas@alltech.com.br", phone: "(11) 2743-2723", address: "RUA X, CENTRO", city: "ITU", state: "SP", postal_code: "13301000", legal_name: "ALLTECH TOOLS DO BRASIL LTDA", contact_name: "MARCOS" });
  assert.equal(normNome("Allservice Manutenção Ltda."), "ALLSERVICE MANUTENCAO");
});

test("fornecedores GRV: completa só o vazio, casa por CNPJ e por nome sem ambiguidade, protege pessoa física", () => {
  const planilha = [
    L({ razao: "ALLTECH TOOLS DO BRASIL LTDA", doc: "37842058000192", cidade: "ITU", uf: "SP", email: "a@b.com" }),
    L({ razao: "RDS PECAS E SERVICOS LTDA", nome: "RDS PECAS", doc: "23300838000104", cidade: "SOROCABA", uf: "SP" }),
    L({ razao: "DUPLA LTDA", doc: "11111111000111" }), L({ razao: "DUPLA LTDA", doc: "22222222000122" }),
    L({ razao: "ALEX SOARES BRITO", nome: "ALEX SOARES", pf: true, doc: "12345678909", cidade: "ITU", fone: "11 99999-0000" }),
    L({ razao: "PECSIL METALURGICA E FUNDICAO LTDA", doc: "46839106000184" }),
    L({ razao: "NOVO FORNECEDOR LTDA", doc: "33333333000133", cidade: "JUNDIAI", uf: "SP", tipo: "Transportadora" }),
  ];
  const plataforma = [
    F({ id: "1", name: "ALLTECH", tax_id: "37.842.058/0001-92", email: "ja@tem.com" }),
    F({ id: "2", name: "RDS PECAS E SERVICOS" }),
    F({ id: "3", name: "DUPLA" }),
    F({ id: "4", name: "ALEX SOARES" }),
    F({ id: "5", name: "SEM PAR NENHUM" }),
  ];
  const p = planejarCarga(planilha, plataforma, "46.839.106/0001-84");
  const a = p.completar.find((x) => x.id === "1");
  assert.equal(a.como, "cnpj");
  assert.equal(a.campos.email, undefined, "e-mail que já existe não é trocado");
  assert.equal(a.campos.city, "ITU");
  const r = p.completar.find((x) => x.id === "2");
  assert.equal(r.como, "nome");
  assert.equal(r.campos.tax_id, "23300838000104");
  assert.deepEqual(p.ambiguos.map((x) => x.id), ["3"]);
  assert.deepEqual(p.pessoaFisica.map((x) => x.id), ["4"], "pessoa física não recebe dado nenhum");
  assert.ok(!JSON.stringify(p.completar).includes("12345678909"), "CPF nunca aparece");
  assert.deepEqual(p.semPar.map((x) => x.id), ["5"]);
  assert.deepEqual(p.novos.map((x) => x.razao), ["NOVO FORNECEDOR LTDA"], "a própria empresa fica de fora");
  assert.equal(p.novos[0].tipo, "Transportadora");
});
