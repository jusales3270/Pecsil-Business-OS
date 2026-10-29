import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import test from "node:test";

process.env.TRANSMISSOR_SECRET = "s".repeat(40);
const m = await import("../servidor.mjs");
const xml = readFileSync(new URL("./nfe-ficticia.xml", import.meta.url), "utf8");

test("segredo: exige 32+ caracteres e compara exato", () => {
  assert.equal(m.segredoConfere("s".repeat(40)), true);
  assert.equal(m.segredoConfere("s".repeat(39)), false);
  assert.equal(m.segredoConfere("x", "curto"), false);
  assert.equal(m.segredoConfere(undefined), false);
});

test("configuração por chamada: UF, CNPJ e certificado obrigatórios; homologação por padrão", () => {
  const ok = m.configDaChamada({ uf: "sp", cnpj: "11.222.333/0001-81", certificado: { pfx: "AAAA", senha: "x" } }, "/tmp");
  assert.equal(ok.ambiente, 2);
  assert.equal(ok.cUF, 35);
  assert.equal(ok.config.dfe.CPFCNPJ, "11222333000181");
  assert.ok(Buffer.isBuffer(ok.config.dfe.pathCertificado), "certificado só em memória");
  assert.equal(m.configDaChamada({ uf: "SP", cnpj: "11222333000181", ambiente: "producao", certificado: { pfx: "A", senha: "x" } }, "/tmp").ambiente, 1);
  assert.throws(() => m.configDaChamada({ uf: "XX", cnpj: "11222333000181", certificado: { pfx: "A", senha: "x" } }, "/tmp"), /UF/);
  assert.throws(() => m.configDaChamada({ uf: "SP", cnpj: "123", certificado: { pfx: "A", senha: "x" } }, "/tmp"), /CNPJ/);
  assert.throws(() => m.configDaChamada({ uf: "SP", cnpj: "11222333000181" }, "/tmp"), /Certificado/);
});

test("erro devolvido nunca traz a senha nem o certificado", () => {
  const p = { certificado: { pfx: "QkFTRTY0Q0VSVA==", senha: "senhaSecreta123" } };
  const msg = m.erroLimpo(new Error("falhou com senhaSecreta123 e QkFTRTY0Q0VSVA== -passin file:/tmp/abc"), p);
  assert.doesNotMatch(msg, /senhaSecreta123|QkFTRTY0Q0VSVA==|\/tmp\/abc/);
});

test("data e hora no fuso de Brasília", () => {
  assert.equal(m.agora(Date.UTC(2026, 9, 12, 2, 30, 0)), "2026-10-11T23:30:00-03:00");
});

test("DANFE de um XML autorizado (sem certificado)", async () => {
  const r = await m.OPERACOES.danfe({ xml });
  const pdf = Buffer.from(r.pdf, "base64");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 5000);
});

test("DANFE de XML incompleto: erro do pedido, sem marca d'água e sem derrubar o serviço", async () => {
  const incompleto = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe versao="4.00" Id="NFe35190111222333000181550010000000011000000011"><ide><nNF>1</nNF></ide></infNFe></NFe></nfeProc>`;
  await assert.rejects(m.OPERACOES.danfe({ xml: incompleto }), (e) => e instanceof m.ErroDoPedido && e.codigo === "DANFE_INVALIDO");
  // A biblioteca ainda mexe no arquivo depois de falhar: o processo precisa continuar de pé.
  await new Promise((ok) => setTimeout(ok, 1500));
  const r = await m.OPERACOES.danfe({ xml });
  assert.equal(Buffer.from(r.pdf, "base64").subarray(0, 4).toString(), "%PDF");
  assert.doesNotMatch(readFileSync(new URL("../servidor.mjs", import.meta.url), "utf8"), /NFE_GerarDanfe\(/, "a função pronta sempre põe a marca NFeWizard-io");
});

test("validação pelo esquema oficial roda sem certificado", async () => {
  const r = await m.OPERACOES.validar({ xml });
  assert.ok(r && typeof r === "object");
});

test("distribuição: cada documento sai com NSU, schema e o XML original (assinado), lido do retorno puro", async () => {
  const assinado = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>35261000000000000191550010000000011000000010</chNFe><Signature>ass</Signature></resNFe>`;
  const z = (s) => gzipSync(Buffer.from(s)).toString("base64");
  const retorno = `<retDistDFeInt versao="1.01"><tpAmb>2</tpAmb><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><ultNSU>000000000000002</ultNSU><maxNSU>000000000000005</maxNSU><loteDistDFeInt><docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">${z(assinado)}</docZip><docZip NSU="000000000000002" schema="procNFe_v4.00.xsd">${z("<nfeProc/>")}</docZip></loteDistDFeInt></retDistDFeInt>`;
  // A biblioteca devolve só o objeto convertido; o XML puro vem do arquivo que ela grava na pasta da chamada.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const pasta = mkdtempSync(join(tmpdir(), "teste-dist-"));
  mkdirSync(join(pasta, "retorno", "NFEDistribuicaoDFe"), { recursive: true });
  writeFileSync(join(pasta, "retorno", "NFEDistribuicaoDFe", "NFEDistribuicaoDFe-retorno.xml"), retorno);
  const puro = m.retornoDistribuicaoDaPasta(pasta);
  rmSync(pasta, { recursive: true, force: true });
  const r = m.normalizarDistribuicao({ retDistDFeInt: { cStat: ["138"] } }, puro);
  assert.equal(r.cStat, "138");
  assert.equal(r.ultimoNsu, "000000000000002");
  assert.equal(r.maxNsu, "000000000000005");
  assert.equal(r.documentos.length, 2);
  assert.deepEqual(r.documentos[0], { nsu: "000000000000001", schema: "resNFe_v1.01.xsd", xml: assinado });
  assert.equal(r.documentos[1].schema, "procNFe_v4.00.xsd");
  // 137 = nenhum documento novo: o código e o NSU vêm do XML puro da SEFAZ.
  const vazio = m.normalizarDistribuicao({}, `<retDistDFeInt versao="1.01"><tpAmb>1</tpAmb><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo><ultNSU>000000000000000</ultNSU><maxNSU>000000000000000</maxNSU></retDistDFeInt>`);
  assert.deepEqual([vazio.cStat, vazio.motivo, vazio.maxNsu, vazio.documentos.length], ["137", "Nenhum documento localizado", "000000000000000", 0]);
  // Sem o XML da SEFAZ não se inventa resposta (antes saía um "137" falso e a busca nunca trazia nada).
  assert.throws(() => m.normalizarDistribuicao({ data: {}, xMotivo: "Nenhum documento localizado", filesList: [] }), /sem o XML da SEFAZ/);
});

test("resposta da SEFAZ padronizada: código e motivo à vista", () => {
  const r = m.respostaSefaz({ retConsStatServ: { cStat: ["107"], xMotivo: ["Servico em Operacao"] } });
  assert.equal(r.cStat, "107");
  assert.equal(r.motivo, "Servico em Operacao");
  assert.equal(m.respostaSefaz(null).cStat, null);
});

test("certificado: lê titular, CNPJ e validade; senha errada é recusada", async () => {
  const { default: forge } = await import("node-forge");
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = new Date("2027-01-01T00:00:00Z");
  const nome = [{ name: "commonName", value: "EMPRESA TESTE LTDA:11222333000181" }];
  cert.setSubject(nome);
  cert.setIssuer([{ name: "commonName", value: "AC TESTE" }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const pfx = forge.util.encode64(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], "senha-certa", { algorithm: "aes256" })).getBytes());
  const dados = m.lerCertificado(pfx, "senha-certa");
  assert.equal(dados.titular, "EMPRESA TESTE LTDA");
  assert.equal(dados.cnpj, "11222333000181");
  assert.equal(dados.validade, "2027-01-01T00:00:00.000Z");
  assert.equal(dados.emissor, "AC TESTE");
  assert.throws(() => m.lerCertificado(pfx, "senha-errada"), /Senha do certificado incorreta/);
  assert.throws(() => m.lerCertificado("bGl4bw==", "x"), /inválido/);
});

test("servidor: /saude aberto, operações exigem o segredo", async () => {
  const srv = m.criarServidor().listen(0);
  const porta = srv.address().port;
  try {
    const saude = await (await fetch(`http://127.0.0.1:${porta}/saude`)).json();
    assert.equal(saude.ok, true);
    const sem = await fetch(`http://127.0.0.1:${porta}/v1/status`, { method: "POST", body: "{}" });
    assert.equal(sem.status, 401);
    const desconhecida = await fetch(`http://127.0.0.1:${porta}/v1/apagar-tudo`, { method: "POST", headers: { "x-transmissor-secret": "s".repeat(40) }, body: "{}" });
    assert.equal(desconhecida.status, 404);
    const semCert = await fetch(`http://127.0.0.1:${porta}/v1/status`, { method: "POST", headers: { "x-transmissor-secret": "s".repeat(40) }, body: JSON.stringify({ uf: "SP", cnpj: "11222333000181" }) });
    assert.equal(semCert.status, 400);
    assert.equal((await semCert.json()).erro.codigo, "SEM_CERTIFICADO");
  } finally {
    srv.close();
  }
});

test("autorização: XML autorizado lido da pasta, protocolo e código do protocolo da nota", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const pasta = mkdtempSync(join(tmpdir(), "teste-aut-"));
  try {
    assert.equal(m.xmlAutorizadoDaPasta(pasta), null, "sem arquivo: nada");
    mkdirSync(join(pasta, "autorizacao", "NFEAutorizacao"), { recursive: true });
    const nfeProc = `<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35261011222333000181550010000000011000000011"/></NFe><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>35261011222333000181550010000000011000000011</chNFe><dhRecbto>2026-10-30T10:00:00-03:00</dhRecbto><nProt>135260000123456</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`;
    writeFileSync(join(pasta, "autorizacao", "NFEAutorizacao", "35261011222333000181550010000000011.xml"), nfeProc);
    const xml = m.xmlAutorizadoDaPasta(pasta);
    assert.match(xml, /<nfeProc/);
    const r = m.resultadoAutorizacao({ success: true, xMotivo: [{ cStat: "100" }] }, xml);
    assert.deepEqual([r.cStat, r.protocolo, r.recebidoEm, r.chave], ["100", "135260000123456", "2026-10-30T10:00:00-03:00", "35261011222333000181550010000000011000000011"]);
    assert.equal(r.xmlAutorizado, xml);
    const semAut = m.resultadoAutorizacao({ xMotivo: [{ cStat: "105", xMotivo: "Lote em processamento" }] }, null);
    assert.deepEqual([semAut.cStat, semAut.xmlAutorizado], ["105", null], "sem a autorização: sem XML");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("eventos e inutilização: código e protocolo do retorno do evento, não do lote", () => {
  // Formato do xml2js da biblioteca: listas em cada nível.
  const cancelamento = { success: true, response: [{ retEnvEvento: [{ cStat: ["128"], xMotivo: ["Lote de evento processado"], retEvento: [{ infEvento: [{ cStat: ["135"], xMotivo: ["Evento registrado e vinculado a NF-e"], nProt: ["135260000999999"], dhRegEvento: ["2026-10-30T11:00:00-03:00"] }] }] }] }] };
  assert.deepEqual(m.respostaEvento(cancelamento), { cStat: "135", motivo: "Evento registrado e vinculado a NF-e", protocolo: "135260000999999", recebidoEm: "2026-10-30T11:00:00-03:00", bruto: null });
  const inutilizacao = { retInutNFe: [{ infInut: [{ cStat: ["102"], xMotivo: ["Inutilização de número homologado"], nProt: ["135260000777777"], dhRecbto: ["2026-10-30T12:00:00-03:00"] }] }] };
  assert.deepEqual([m.respostaEvento(inutilizacao).cStat, m.respostaEvento(inutilizacao).protocolo], ["102", "135260000777777"]);
});

test("eventos vão para a biblioteca como lote (idLote + lista), com verEvento", () => {
  const fonte = readFileSync(new URL("../servidor.mjs", import.meta.url), "utf8");
  assert.match(fonte, /const lote = \(evento\) => \(\{ idLote: Date\.now\(\) % 1_000_000_000, evento: \[evento\] \}\)/);
  for (const f of ["NFE_Cancelamento", "NFE_CartaDeCorrecao", "NFE_CienciaDaOperacao"]) assert.match(fonte, new RegExp(`w\\.${f}\\(lote\\(`), f);
  assert.match(fonte, /verEvento: "1\.00"/);
});

test("consulta: o código do primeiro nível vale (101 cancelada), o protocolo vem de dentro", () => {
  const cancelada = { tpAmb: "2", cStat: "101", xMotivo: "Cancelamento de NF-e homologado", chNFe: "35261046839106000184550010000000011980540291",
    protNFe: { infProt: { cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: "135260009694610", dhRecbto: "2026-10-29T16:03:20-03:00" } } };
  assert.deepEqual(m.respostaConsulta(cancelada), { cStat: "101", motivo: "Cancelamento de NF-e homologado", protocolo: "135260009694610", recebidoEm: "2026-10-29T16:03:20-03:00", bruto: null });
  const naoConsta = { cStat: ["217"], xMotivo: ["Rejeicao: NF-e nao consta na base de dados da SEFAZ"] };
  assert.equal(m.respostaConsulta(naoConsta).cStat, "217");
  assert.equal(m.respostaConsulta(naoConsta).protocolo, null);
});
