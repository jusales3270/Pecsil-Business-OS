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

test("validação pelo esquema oficial roda sem certificado", async () => {
  const r = await m.OPERACOES.validar({ xml });
  assert.ok(r && typeof r === "object");
});

test("distribuição: cada documento sai com NSU, schema e o XML original (assinado)", () => {
  const assinado = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>35261000000000000191550010000000011000000010</chNFe><Signature>ass</Signature></resNFe>`;
  const z = (s) => gzipSync(Buffer.from(s)).toString("base64");
  const retorno = `<retDistDFeInt versao="1.01"><tpAmb>2</tpAmb><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><ultNSU>000000000000002</ultNSU><maxNSU>000000000000005</maxNSU><loteDistDFeInt><docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">${z(assinado)}</docZip><docZip NSU="000000000000002" schema="procNFe_v4.00.xsd">${z("<nfeProc/>")}</docZip></loteDistDFeInt></retDistDFeInt>`;
  const r = m.normalizarDistribuicao({ data: { retDistDFeInt: {}, xml: retorno }, xMotivo: "Documento localizado" });
  assert.equal(r.cStat, "138");
  assert.equal(r.ultimoNsu, "000000000000002");
  assert.equal(r.maxNsu, "000000000000005");
  assert.equal(r.documentos.length, 2);
  assert.deepEqual(r.documentos[0], { nsu: "000000000000001", schema: "resNFe_v1.01.xsd", xml: assinado });
  assert.equal(r.documentos[1].schema, "procNFe_v4.00.xsd");
  // 137 = nenhum documento novo (a biblioteca não devolve o XML nesse caso)
  const vazio = m.normalizarDistribuicao({ data: {}, xMotivo: "Nenhum documento localizado", filesList: [] });
  assert.equal(vazio.cStat, "137");
  assert.equal(vazio.documentos.length, 0);
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
