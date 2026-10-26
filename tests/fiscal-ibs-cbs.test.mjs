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
