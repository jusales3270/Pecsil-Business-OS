import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { lerIbsCbs, apurar } = await import("../lib/fiscal/ibs-cbs/leitura.ts");

const EMPRESA = "11222333000181";
const FORNECEDOR = "99888777000166";
// Mesma estrutura e mesmos valores de uma nota real de fornecedor (out/2026); nomes e CNPJs fictícios.
const nota = ({ emit = FORNECEDOR, dest = EMPRESA, dhEmi = "2026-10-20T10:00:00-03:00", finNFe = "1", grupo = true } = {}) => `<?xml version="1.0"?><nfeProc><NFe><infNFe versao="4.00" Id="NFe35261099888777000166550010000012341000012345">
<ide><mod>55</mod><nNF>1234</nNF><dhEmi>${dhEmi}</dhEmi><finNFe>${finNFe}</finNFe></ide>
<emit><CNPJ>${emit}</CNPJ><xNome>FORNECEDOR &amp;amp; TESTE LTDA</xNome></emit><dest><CNPJ>${dest}</CNPJ><xNome>EMPRESA TESTE</xNome></dest>
<det nItem="1"><prod><vProd>233.26</vProd><vFrete>84.82</vFrete></prod><imposto><ICMS><ICMS00><vICMS>57.25</vICMS></ICMS00></ICMS><PIS><PISAliq><vPIS>4.30</vPIS></PISAliq></PIS><COFINS><COFINSAliq><vCOFINS>19.82</vCOFINS></COFINSAliq></COFINS>
${grupo ? "<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>236.71</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.24</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.24</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>2.13</vCBS></gCBS></gIBSCBS></IBSCBS>" : ""}</imposto></det>
<total><ICMSTot><vNF>318.08</vNF></ICMSTot>${grupo ? "<IBSCBSTot><vBCIBSCBS>236.71</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>0.24</vIBSUF></gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.24</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>2.13</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot><vNFTot>318.08</vNFTot>" : ""}</total></infNFe></NFe></nfeProc>`;

test("lê o grupo IBSCBS do item e o IBSCBSTot do total; entrada quando a empresa é destinatária", () => {
  const n = lerIbsCbs(nota(), EMPRESA);
  assert.equal(n.lado, "entrada");
  assert.equal(n.chave, "35261099888777000166550010000012341000012345");
  assert.equal(n.competencia, "2026-10");
  assert.equal(n.temGrupo, true);
  assert.deepEqual([n.vBC, n.vIBSUF, n.vIBSMun, n.vIBS, n.vCBS, n.vNF, n.vNFTot], [236.71, 0.24, 0, 0.24, 2.13, 318.08, 318.08]);
  assert.deepEqual(n.itens.map((i) => [i.cst, i.cClassTrib, i.pCBS, i.pIBSUF]), [["000", "000001", 0.9, 0.1]]);
});

test("saída quando a empresa emite; nota sem o grupo fica marcada; XML que não é NF-e é ignorado", () => {
  assert.equal(lerIbsCbs(nota({ emit: EMPRESA, dest: FORNECEDOR }), EMPRESA).lado, "saida");
  const sem = lerIbsCbs(nota({ grupo: false }), EMPRESA);
  assert.equal(sem.temGrupo, false);
  assert.equal(sem.vCBS, 0);
  assert.equal(lerIbsCbs("<CompNfse><Nfse/></CompNfse>", EMPRESA), null);
});

test("apuração informativa: saída é débito, entrada é crédito, devolução inverte, sem grupo conta à parte", () => {
  const notas = [
    lerIbsCbs(nota({ emit: EMPRESA, dest: FORNECEDOR }), EMPRESA),
    lerIbsCbs(nota(), EMPRESA),
    lerIbsCbs(nota(), EMPRESA),
    lerIbsCbs(nota({ finNFe: "4" }), EMPRESA), // devolução recebida: estorna o crédito
    lerIbsCbs(nota({ grupo: false }), EMPRESA),
    lerIbsCbs(nota({ dhEmi: "2026-09-30T23:00:00-03:00" }), EMPRESA),
  ];
  const [out, set] = apurar(notas);
  assert.equal(out.competencia, "2026-10");
  assert.equal(out.debitoCBS, 4.26, "a saída e a devolução");
  assert.equal(out.creditoCBS, 4.26, "duas entradas");
  assert.equal(out.saldoCBS, 0);
  assert.equal(out.semGrupo, 1);
  assert.equal(set.competencia, "2026-09");
  assert.equal(set.creditoIBS, 0.24);
});

test("nome do emitente sem entidade do XML, mesmo escapada em dobro", () => {
  assert.equal(lerIbsCbs(nota(), EMPRESA).emitenteNome, "FORNECEDOR & TESTE LTDA");
});

const { conferirNota, aliquotasNaData, baseCalculada } = await import("../lib/fiscal/ibs-cbs/conferencia.ts");
const { semRepetidas } = await import("../lib/fiscal/ibs-cbs/leitura.ts");
const parametro = (chave, valor, vigente_de, vigente_ate = null, situacao = "conferido") => ({ id: chave + vigente_de, chave, titulo: chave, escopo: "legal", uf: null, codigo_municipio: null, valor, vigente_de, vigente_ate, fonte: { norma: "LC 214/2025; outra", url: "https://exemplo" }, confianca: "alta", observacao: null, situacao });
const P2026 = parametro("reforma_2026_fase_teste", { cbs: 0.009, ibs: 0.001, recolhimento: "dispensado" }, "2026-01-01", "2026-12-31");

test("conferência: a nota real fecha com a lei da data (base refeita com o frete)", () => {
  const n = lerIbsCbs(nota(), EMPRESA);
  assert.equal(baseCalculada(n.itens[0]), 236.71);
  const c = conferirNota({ temGrupo: true, itens: n.itens, data: "2026-10-20" }, [P2026]);
  assert.equal(c.situacao, "confere");
  assert.equal(c.diferenca, 0);
  assert.deepEqual([c.aliquotas.cbs, c.aliquotas.ibsUF, c.aliquotas.ibsMun], [0.9, 0.1, 0]);
  assert.equal(c.aliquotas.norma, "LC 214/2025");
});

test("conferência: alíquota errada, base sem frete e nota sem lei na data", () => {
  const errada = lerIbsCbs(nota().replace("<pCBS>0.9000</pCBS><vCBS>2.13</vCBS>", "<pCBS>1.0000</pCBS><vCBS>2.37</vCBS>"), EMPRESA);
  const c = conferirNota({ temGrupo: true, itens: errada.itens, data: "2026-10-20" }, [P2026]);
  assert.equal(c.situacao, "diverge");
  assert.equal(c.diferenca, 0.24);
  assert.match(c.motivos.join(" "), /CBS 1%.*manda 0,9%/);
  const semFrete = lerIbsCbs(nota().replace("<vBC>236.71</vBC>", "<vBC>151.89</vBC>").replace("<vIBSUF>0.24</vIBSUF></gIBSUF><gIBSMun>", "<vIBSUF>0.15</vIBSUF></gIBSUF><gIBSMun>").replace("<vCBS>2.13</vCBS></gCBS></gIBSCBS>", "<vCBS>1.37</vCBS></gCBS></gIBSCBS>"), EMPRESA);
  const c2 = conferirNota({ temGrupo: true, itens: semFrete.itens, data: "2026-10-20" }, [P2026]);
  assert.equal(c2.situacao, "diverge");
  assert.match(c2.motivos[0], /base destacada R\$\s151,89, a conta dá R\$\s236,71/);
  assert.equal(conferirNota({ temGrupo: true, itens: lerIbsCbs(nota(), EMPRESA).itens, data: "2027-01-10" }, [P2026]).situacao, "sem_regra");
  assert.equal(conferirNota({ temGrupo: false, itens: [], data: "2026-10-20" }, [P2026]).situacao, "sem_grupo");
  // Lida antes da conferência (sem a composição da base): não acusa divergência.
  const antiga = lerIbsCbs(nota(), EMPRESA).itens.map(({ nItem, cst, cClassTrib, vBC, pIBSUF, pIBSMun, pCBS }) => ({ nItem, cst, cClassTrib, vBC, pIBSUF, pIBSMun, pCBS }));
  assert.equal(conferirNota({ temGrupo: true, itens: antiga, data: "2026-10-20" }, [P2026]).situacao, "manual");
});

test("alíquota pela data: a nova vigência aprovada vale para as notas da data dela, sem reler o XML", () => {
  const p2027 = parametro("ibs_cbs_aliquotas", { cbs: 0.088, ibs: 0.001, ibs_uf: 0.0005, ibs_mun: 0.0005 }, "2027-01-01");
  const rascunho = parametro("ibs_cbs_aliquotas", { cbs: 0.09, ibs: 0.001, ibs_uf: 0.0005 }, "2027-01-01", null, "rascunho");
  assert.equal(aliquotasNaData([P2026, p2027], "2026-12-31").cbs, 0.9);
  const a = aliquotasNaData([P2026, p2027, rascunho], "2027-03-01");
  assert.deepEqual([a.cbs, a.ibsUF, a.ibsMun, a.aConferir], [8.8, 0.05, 0.05, false]);
  // 2027 ainda sem número (texto da lei) não serve: fica "sem alíquota legal".
  assert.equal(aliquotasNaData([parametro("reforma_2027", { cbs: "plena: referência menos 0,1 p.p.", ibs: "0,05% + 0,05%" }, "2027-01-01")], "2027-03-01"), null);
});

test("a mesma chave enviada por dois caminhos conta uma vez", () => {
  const r = semRepetidas([{ chave: "1", id: "a" }, { chave: "1", id: "b" }, { chave: null, id: "c" }, { chave: null, id: "d" }, { chave: "2", id: "e" }]);
  assert.deepEqual(r.notas.map((n) => n.id), ["a", "c", "d", "e"]);
  assert.equal(r.repetidas, 1);
});

test("Simples Nacional: sem o grupo em 2026 é dispensa, não falta; com o grupo, sem conferência automática", () => {
  const simples = (grupo) => lerIbsCbs(nota({ grupo }).replace("<xNome>FORNECEDOR", "<CRT>1</CRT><xNome>FORNECEDOR"), EMPRESA);
  assert.equal(simples(true).emitenteCrt, 1);
  const sem = simples(false);
  assert.equal(conferirNota({ temGrupo: false, itens: [], data: "2026-10-20", crt: 1 }, [P2026]).situacao, "simples");
  assert.equal(conferirNota({ temGrupo: false, itens: [], data: "2027-02-01", crt: 1 }, [P2026]).situacao, "sem_grupo");
  assert.equal(conferirNota({ temGrupo: true, itens: simples(true).itens, data: "2026-10-20", crt: 1 }, [P2026]).situacao, "simples");
  const [l] = apurar([sem, lerIbsCbs(nota({ grupo: false }), EMPRESA)]);
  assert.deepEqual([l.semGrupo, l.simplesSemGrupo], [1, 1]);
});

test("um centavo exato de diferença é arredondamento, não divergência", () => {
  // 0,80 − 0,79 em ponto flutuante dá 0,010000000000000009.
  const n = lerIbsCbs(nota().replace("<vBC>236.71</vBC>", "<vBC>236.72</vBC>").replace("<vCBS>2.13</vCBS></gCBS></gIBSCBS>", "<vCBS>2.12</vCBS></gCBS></gIBSCBS>"), EMPRESA);
  assert.equal(conferirNota({ temGrupo: true, itens: n.itens, data: "2026-10-20", crt: 3 }, [P2026]).situacao, "confere");
});
