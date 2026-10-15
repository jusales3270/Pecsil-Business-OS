import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { faltandoNaMascara, situacaoDaMascara, sugerirMascara, impostosDoOrcamento, aliquotaIpi, impostosDoItem, cargaEfetivaIcms } = await import("../lib/fiscal/mascaras.ts");
const { calcularItens } = await import("../lib/fiscal/emissao/calculo.ts");

const base = {
  id: "m", natureza: null, situacao_tributaria: null, ufs: [], icms_cst: null, icms_aliquota: null, icms_reducao_base: null, icms_diferimento: null,
  ipi_enquadramento: null, ipi_cst: null, ipi_aliquota: null, pis_cst: null, pis_aliquota: null, cofins_cst: null, cofins_aliquota: null,
  pis_cofins_exclui_icms: false, ibs_cbs_cst: null, cclasstrib: null, ibs_aliquota: null, cbs_aliquota: null, conta_plano: null,
  conta_plano_descricao: null, obs_nota: null, observacao_interna: null, ativo: true, origem_dados: "grv", confirmada_por_nome: null,
  confirmada_em: null, updated_by_name: null, updated_at: "",
};
const m = (extra) => ({ ...base, ...extra });
// Máscara de venda interna completa (números de exemplo, não são os da empresa).
const completa = m({ codigo: "2", descricao: "5101 VENDA", cfop: "5101", icms_cst: "20", icms_aliquota: 18, icms_reducao_base: 50, ipi_cst: "50", pis_cst: "01", pis_aliquota: 1.65, cofins_cst: "01", cofins_aliquota: 7.6 });

test("máscara do GRV (sem números) fica incompleta e diz o que falta", () => {
  const grv = m({ codigo: "2", descricao: "5101 VENDA", cfop: "5101", icms_cst: "20", ipi_cst: "50" });
  assert.deepEqual(faltandoNaMascara(grv), ["alíquota do ICMS", "% de redução da base do ICMS", "CST do PIS", "CST da COFINS"]);
  assert.equal(situacaoDaMascara(grv), "incompleta");
  assert.equal(situacaoDaMascara(completa), "a_confirmar");
  assert.equal(situacaoDaMascara({ ...completa, confirmada_em: "2026-10-15T12:00:00Z" }), "confirmada");
  // Não tributada e suspensão não pedem alíquota de ICMS.
  assert.deepEqual(faltandoNaMascara(m({ codigo: "24", descricao: "7101", cfop: "7101", icms_cst: "41", ipi_cst: "53", pis_cst: "08", cofins_cst: "08" })), []);
});

test("sugestão pelo estado do cliente", () => {
  const lista = [completa, m({ codigo: "4", descricao: "6101 PE", cfop: "6101", ufs: ["PE"] }), m({ codigo: "18", descricao: "6101 RJ RS", cfop: "6101", ufs: ["RJ", "RS"] }), m({ codigo: "24", descricao: "7101", cfop: "7101" }), m({ codigo: "1", descricao: "1101", cfop: "1101" })];
  assert.equal(sugerirMascara(lista, "SP", "SP").mascara.codigo, "2");
  assert.equal(sugerirMascara(lista, "rs", "SP").mascara.codigo, "18");
  assert.equal(sugerirMascara(lista, "PE", "SP").mascara.codigo, "4");
  assert.equal(sugerirMascara(lista, "EX", "SP").mascara.codigo, "24");
  const mg = sugerirMascara(lista, "MG", "SP");
  assert.equal(mg.mascara, null);
  assert.match(mg.motivo, /MG/);
  assert.match(sugerirMascara(lista, null, "SP").motivo, /sem estado/);
});

test("IPI: da máscara quando ela tem; senão do NCM do produto", () => {
  const ncm = new Map([["84805000", 0], ["73269090", 5]]);
  assert.equal(aliquotaIpi(completa, "8480.50.00", ncm), 0);
  assert.equal(aliquotaIpi(completa, "73269090", ncm), 5);
  assert.equal(aliquotaIpi({ ...completa, ipi_aliquota: 3.25 }, "73269090", ncm), 3.25);
  assert.equal(aliquotaIpi(completa, "99999999", ncm), null);
});

test("orçamento calcula como a nota: ICMS com redução, IPI por fora", () => {
  const r = impostosDoOrcamento({ itens: [{ quantidade: 10, preco: 100, ncm: "73269090", descricao: "PECA" }], mascara: completa, ipiPorNcm: new Map([["73269090", 5]]) });
  assert.equal(r.ok, true);
  // base 1000 reduzida 50% = 500; ICMS 18% = 90; IPI 5% de 1000 = 50; total 1050.
  assert.deepEqual([r.totais.vProd, r.totais.vBC, r.totais.vICMS, r.totais.vIPI, r.totais.vNF], [1000, 500, 90, 50, 1050]);
  assert.equal(cargaEfetivaIcms(completa), 9);
});

test("orçamento não inventa número: diz o que falta", () => {
  const sem = impostosDoOrcamento({ itens: [{ quantidade: 1, preco: 10, ncm: null, descricao: "ANEL" }], mascara: completa, ipiPorNcm: new Map() });
  assert.deepEqual(sem, { ok: false, faltando: ["NCM do produto ANEL"] });
  const grv = impostosDoOrcamento({ itens: [{ quantidade: 1, preco: 10, ncm: "84805000", descricao: "ANEL" }], mascara: m({ codigo: "2", descricao: "x", cfop: "5101", icms_cst: "20", ipi_cst: "50" }), ipiPorNcm: new Map() });
  assert.equal(grv.ok, false);
  assert.ok(grv.faltando.includes("alíquota do ICMS (máscara 2)"));
  assert.ok(grv.faltando.includes("alíquota do IPI do NCM 8480.50.00"));
  assert.deepEqual(impostosDoOrcamento({ itens: [], mascara: null, ipiPorNcm: new Map() }), { ok: false, faltando: ["a máscara de impostos"] });
});

test("PIS/COFINS sem o ICMS na base quando a máscara manda", () => {
  const item = { codigo: "", descricao: "X", ncm: "", unidade: "PC", quantidade: 1, valorUnitario: 1000, desconto: 0, origem: 0, ...impostosDoItem({ ...completa, icms_reducao_base: 0, pis_cofins_exclui_icms: true }, 0) };
  const [c] = calcularItens({ itens: [item], frete: { modalidade: 9, valor: 0 }, seguro: 0, outrasDespesas: 0, consumidorFinal: false });
  assert.equal(c.vICMS, 180);
  assert.equal(c.vBCPisCofins, 820);
  assert.equal(c.vPIS, 13.53);
  assert.equal(item.mascara, "2");
});

test("nota do orçamento: máscara completa preenche o item; incompleta só dá o CFOP", async () => {
  const { notaDoOrcamento } = await import("../lib/fiscal/emissao/do-orcamento.ts");
  const cliente = { name: "CLIENTE", tax_id: "11444777000161", ie: "1", ind_ie: 1, email_nfe: null, cep: null, logradouro: null, numero: null, complemento: null, bairro: null, municipio: null, codigo_municipio: null, uf: "PE", telefone: null };
  const linha = { item_id: "00000000-0000-0000-0000-000000000001", numero: 7, pedido_cliente: "P1", descricao: "ANEL", preco_unitario: 100, item_pedido: null };
  const produto = { codigo: "5-1-1", ncm: "84805000", unidade: "PC", origem: 0 };
  const pe = { ...completa, id: "pe", codigo: "4", cfop: "6101", natureza: "VENDA DE PRODUCAO DO ESTABELECIMENTO", icms_aliquota: 7, obs_nota: "Redução conforme RICMS." };
  const n1 = notaDoOrcamento({ cliente, linhas: [{ linha, quantidade: 2, produto, mascara: pe, ipiAliquota: 0 }], ufEmitente: "SP", crt: 3 });
  assert.deepEqual([n1.itens[0].cfop, n1.itens[0].icmsCst, n1.itens[0].icmsAliquota, n1.itens[0].icmsReducaoBase, n1.itens[0].pisAliquota, n1.itens[0].mascara], ["6101", "20", 7, 50, 1.65, "4"]);
  assert.match(n1.infoComplementar, /Redução conforme RICMS/);
  const incompleta = m({ id: "x", codigo: "19", descricao: "6101", cfop: "6101", icms_cst: "20", ipi_cst: "50" });
  const n2 = notaDoOrcamento({ cliente, linhas: [{ linha, quantidade: 2, produto, mascara: incompleta, ipiAliquota: null }], ufEmitente: "SP", crt: 3 });
  assert.deepEqual([n2.itens[0].cfop, n2.itens[0].icmsCst, n2.itens[0].icmsAliquota, n2.itens[0].mascara], ["6101", "00", 12, "19"]);
  const n3 = notaDoOrcamento({ cliente, linhas: [{ linha, quantidade: 2, produto }], ufEmitente: "SP", crt: 3 });
  assert.equal(n3.itens[0].cfop, "6101");
  assert.equal(n3.itens[0].mascara, undefined);
});

test("reproduz as notas reais do GRV (NF 11092 PE, 11104 RJ, 11126 SP) centavo a centavo", () => {
  const venda = (codigo, aliq, red) => m({ codigo, descricao: "venda", cfop: codigo === "2" ? "5101" : "6101", icms_cst: "20", icms_aliquota: aliq, icms_reducao_base: red, ipi_enquadramento: "999", ipi_cst: "51", pis_cst: "01", pis_aliquota: 0.65, cofins_cst: "01", cofins_aliquota: 3, pis_cofins_exclui_icms: true });
  const ncm = new Map([["84805000", 0]]);
  const casos = [
    [venda("4", 7, 26.57), [[200, 860]], { vBC: 126299.6, vICMS: 8840.97, vPIS: 1060.53, vCOFINS: 4894.77, vIPI: 0, vNF: 172000 }],
    [venda("18", 12, 26.67), [[100, 880], [100, 150]], { vBC: 75529.9, vICMS: 9063.59, vPIS: 610.59, vCOFINS: 2818.09, vIPI: 0, vNF: 103000 }],
    [venda("2", 18, 51.11), [[13, 6500]], { vBC: 41312.05, vICMS: 7436.17, vPIS: 500.91, vCOFINS: 2311.91, vIPI: 0, vNF: 84500 }],
  ];
  for (const [mascara, itens, esperado] of casos) {
    const r = impostosDoOrcamento({ itens: itens.map(([quantidade, preco]) => ({ quantidade, preco, ncm: "84805000", descricao: "MOLDE" })), mascara, ipiPorNcm: ncm });
    assert.equal(r.ok, true, mascara.codigo);
    for (const [k, v] of Object.entries(esperado)) assert.equal(r.totais[k], v, `${mascara.codigo} ${k}`);
  }
});

test("XML gerado pela máscara bate com a NF 11092 real do GRV (impostos e totais, inclusive IBS/CBS)", async () => {
  const { gerarXmlNfe } = await import("../lib/fiscal/emissao/xml.ts");
  const { notaVazia } = await import("../lib/fiscal/emissao/normalizar.ts");
  const mascara = m({ codigo: "4", descricao: "6101", cfop: "6101", icms_cst: "20", icms_aliquota: 7, icms_reducao_base: 26.57, ipi_enquadramento: "999", ipi_cst: "51",
    pis_cst: "01", pis_aliquota: 0.65, cofins_cst: "01", cofins_aliquota: 3, pis_cofins_exclui_icms: true, ibs_cbs_cst: "000", cclasstrib: "000001", ibs_aliquota: 0.1, cbs_aliquota: 0.9 });
  const emitente = { cnpj: "11222333000181", razaoSocial: "EMPRESA EXEMPLO LTDA", fantasia: null, ie: "123456789012", im: null, cnae: null, crt: 3, logradouro: "RUA UM", numero: "100", complemento: null, bairro: "CENTRO", codigoMunicipio: "3523909", municipio: "ITU", uf: "SP", cep: "13300000", telefone: null };
  const nota = { ...notaVazia(), destinatario: { ...notaVazia().destinatario, documento: "11444777000161", nome: "CLIENTE", indIE: 1, ie: "123", uf: "PE", codigoMunicipio: "2611606", municipio: "RECIFE", cep: "50000000", logradouro: "R", numero: "1", bairro: "B" },
    itens: [{ codigo: "1", descricao: "MOLDE", ncm: "84805000", unidade: "CJ", quantidade: 200, valorUnitario: 860, desconto: 0, origem: 0, ...impostosDoItem(mascara, 0) }] };
  const { xml } = gerarXmlNfe({ nota, emitente, serie: 1, numero: 1, emissao: new Date("2026-09-02T11:54:06Z"), codigoNumerico: "12345678", tpAmb: 2 });
  const imposto = xml.match(/<imposto>.*?<\/imposto>/)[0];
  const total = xml.match(/<total>.*?<\/total>/)[0];
  // Do XML autorizado da NF 11092 (vTotTrib, a estimativa da Lei 12.741, fica de fora: só é exigida na venda ao consumidor final).
  assert.equal(imposto, "<imposto><ICMS><ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>26.5700</pRedBC><vBC>126299.60</vBC><pICMS>7.0000</pICMS><vICMS>8840.97</vICMS></ICMS20></ICMS><IPI><cEnq>999</cEnq><IPINT><CST>51</CST></IPINT></IPI><PIS><PISAliq><CST>01</CST><vBC>163159.03</vBC><pPIS>0.6500</pPIS><vPIS>1060.53</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>163159.03</vBC><pCOFINS>3.0000</pCOFINS><vCOFINS>4894.77</vCOFINS></COFINSAliq></COFINS><IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>157203.73</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>157.20</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>157.20</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>1414.83</vCBS></gCBS></gIBSCBS></IBSCBS></imposto>");
  assert.equal(total, "<total><ICMSTot><vBC>126299.60</vBC><vICMS>8840.97</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>172000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>1060.53</vPIS><vCOFINS>4894.77</vCOFINS><vOutro>0.00</vOutro><vNF>172000.00</vNF></ICMSTot><IBSCBSTot><vBCIBSCBS>157203.73</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>157.20</vIBSUF></gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>157.20</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>1414.83</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS><gMono><vIBSMono>0.00</vIBSMono><vCBSMono>0.00</vCBSMono><vIBSMonoReten>0.00</vIBSMonoReten><vCBSMonoReten>0.00</vCBSMonoReten><vIBSMonoRet>0.00</vIBSMonoRet><vCBSMonoRet>0.00</vCBSMonoRet></gMono></IBSCBSTot><vNFTot>172000.00</vNFTot></total>");
  // Remessa 5901 (NF 11164): enquadramento 108 e IBS/CBS só com CST e classificação.
  const remessa = m({ codigo: "10", descricao: "5901", cfop: "5901", icms_cst: "50", ipi_enquadramento: "108", ipi_cst: "55", pis_cst: "08", cofins_cst: "08", ibs_cbs_cst: "410", cclasstrib: "410999" });
  const n2 = { ...nota, destinatario: { ...nota.destinatario, uf: "SP", codigoMunicipio: "3550308" }, itens: [{ ...nota.itens[0], quantidade: 30, valorUnitario: 100, ...impostosDoItem(remessa, null) }] };
  const x2 = gerarXmlNfe({ nota: n2, emitente, serie: 1, numero: 2, emissao: new Date("2026-10-05T18:05:53Z"), codigoNumerico: "12345678", tpAmb: 2 }).xml;
  assert.equal(x2.match(/<imposto>.*?<\/imposto>/)[0], "<imposto><ICMS><ICMS40><orig>0</orig><CST>50</CST></ICMS40></ICMS><IPI><cEnq>108</cEnq><IPINT><CST>55</CST></IPINT></IPI><PIS><PISNT><CST>08</CST></PISNT></PIS><COFINS><COFINSNT><CST>08</CST></COFINSNT></COFINS><IBSCBS><CST>410</CST><cClassTrib>410999</cClassTrib></IBSCBS></imposto>");
});
