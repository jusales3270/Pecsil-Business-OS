import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { lerNfseXml, lerNfsePdf, pareceNfseXml, pareceNfsePdf, nfseComoNota, obsDoServico } = await import("../lib/fiscal/nfse.ts");
const { lerNotaXml } = await import("../lib/fiscal/nota-carga.ts");
const ler = (c) => readFileSync(new URL(c, import.meta.url), "utf8");

test("NFS-e Nacional: chave de 50 dígitos, prestador, valores, ISS retido", () => {
  const s = lerNfseXml(ler("./fixtures/nfse-nacional-ficticia.xml"));
  assert.equal(s.chave.length, 50);
  assert.equal(s.numero, "1226");
  assert.equal(s.emissao, "2026-10-08");
  assert.deepEqual(s.prestador, { cnpj: "11222333000181", nome: "MANUTENCAO INDUSTRIAL EXEMPLO LTDA", fantasia: "MANUT EXEMPLO", uf: "SP" });
  assert.equal(s.tomadorCnpj, "99888777000166");
  assert.equal(s.valorServicos, 2500);
  assert.equal(s.valorLiquido, 2375);
  assert.equal(s.iss, 125);
  assert.equal(s.issRetido, true);
  assert.match(s.discriminacao, /compressor/);
});

test("NFS-e ABRASF 2.x: número, código de verificação, prestador e ISS", () => {
  const s = lerNfseXml(ler("./fixtures/nfse-abrasf-ficticia.xml"));
  assert.equal(s.chave, "");
  assert.equal(s.numero, "789");
  assert.equal(s.codigoVerificacao, "AB12CD34");
  assert.equal(s.emissao, "2026-10-05");
  assert.equal(s.prestador.cnpj, "55444333000122");
  assert.equal(s.prestador.nome, "CALIBRACOES E ENSAIOS EXEMPLO LTDA");
  assert.equal(s.valorServicos, 1800);
  assert.equal(s.iss, 54);
  assert.equal(s.issRetido, false);
});

test("NFS-e Prefeitura de São Paulo", () => {
  const s = lerNfseXml(ler("./fixtures/nfse-sp-ficticia.xml"));
  assert.equal(s.numero, "4521");
  assert.equal(s.codigoVerificacao, "XYZ98765");
  assert.equal(s.prestador.cnpj, "33222111000144");
  assert.equal(s.valorServicos, 950);
  assert.equal(s.iss, 19);
});

test("leitor único separa produto (NF-e) de serviço (NFS-e)", () => {
  const nfe = lerNotaXml(ler("./fixtures/nfe-ficticia.xml"));
  assert.equal(nfe.modelo, "nfe");
  assert.equal(pareceNfseXml(ler("./fixtures/nfe-ficticia.xml")), false);
  for (const f of ["nfse-nacional-ficticia.xml", "nfse-abrasf-ficticia.xml", "nfse-sp-ficticia.xml"]) {
    const l = lerNotaXml(ler(`./fixtures/${f}`));
    assert.equal(l.modelo, "nfse", f);
    assert.equal(l.nfe.icms, 0, f);
    assert.equal(l.nfe.ipi, 0, f);
    assert.ok(l.servico, f);
  }
  assert.throws(() => lerNotaXml("<outro/>"), /nem de uma NFS-e/);
});

test("nota de serviço no formato da plataforma e observação com ISS", () => {
  const s = lerNfseXml(ler("./fixtures/nfse-nacional-ficticia.xml"));
  const n = nfseComoNota(s);
  assert.equal(n.valorNota, 2500);
  assert.equal(n.emitente.cnpj, "11222333000181");
  assert.equal(n.itens.length, 1);
  assert.equal(obsDoServico(s, false), "Nota de serviço (NFS-e) · ISS R$ 125,00 (retido)");
  assert.match(obsDoServico({ iss: 0, issRetido: false, codigoVerificacao: "AB12" }, true), /código de verificação AB12 · lida do PDF/);
});

// PDF: itens de texto como o pdfjs entrega (x, y, largura, texto). y maior = mais acima.
const item = (x, y, s) => ({ x, y, w: s.length * 5, s });
test("PDF da NFS-e: DANFSe nacional (rótulos em caixas, valor abaixo)", () => {
  const pagina = [
    item(40, 800, "DANFSe v1.0"), item(200, 800, "Documento Auxiliar da NFS-e"),
    item(40, 770, "Chave de Acesso da NFS-e"), item(40, 758, "35239092112223330001810000000000001226101234567890"),
    item(40, 740, "Número da NFS-e"), item(200, 740, "Data e Hora da emissão da NFS-e"),
    item(40, 728, "1226"), item(200, 728, "08/10/2026 10:00:00"),
    item(40, 700, "EMITENTE DA NFS-e"),
    item(40, 688, "CNPJ / CPF / NIF"), item(200, 688, "Nome / Nome Empresarial"),
    item(40, 676, "11.222.333/0001-81"), item(200, 676, "MANUTENCAO INDUSTRIAL EXEMPLO LTDA"),
    item(40, 640, "TOMADOR DO SERVIÇO"), item(40, 628, "CNPJ / CPF / NIF"), item(40, 616, "99.888.777/0001-66"),
    item(40, 580, "Retenção do ISSQN"), item(200, 580, "Retido pelo Tomador"),
    item(40, 560, "ISSQN Apurado"), item(200, 560, "Valor do Serviço"), item(360, 560, "Valor Líquido da NFS-e"),
    item(40, 548, "125,00"), item(200, 548, "2.500,00"), item(360, 548, "2.375,00"),
  ];
  assert.equal(pareceNfsePdf([pagina]), true);
  const s = lerNfsePdf([pagina]);
  assert.deepEqual(s.camposNaoLidos, []);
  assert.equal(s.chave.length, 50);
  assert.equal(s.numero, "1226");
  assert.equal(s.emissao, "2026-10-08");
  assert.equal(s.prestador.cnpj, "11222333000181");
  assert.equal(s.prestador.nome, "MANUTENCAO INDUSTRIAL EXEMPLO LTDA");
  assert.equal(s.tomadorCnpj, "99888777000166");
  assert.equal(s.valorServicos, 2500);
  assert.equal(s.valorLiquido, 2375);
  assert.equal(s.iss, 125);
  assert.equal(s.issRetido, true);
});

test("PDF da NFS-e municipal: rótulo e valor na mesma linha; o que faltar é marcado", () => {
  const pagina = [
    item(40, 800, "PREFEITURA MUNICIPAL DE EXEMPLO"), item(40, 785, "NOTA FISCAL ELETRÔNICA DE SERVIÇOS - NFS-e"),
    item(40, 770, "Número da Nota: 000345"), item(300, 770, "Data de Emissão: 03/10/2026"),
    item(40, 740, "PRESTADOR DE SERVIÇOS"), item(40, 728, "Razão Social: TRANSPORTES EXEMPLO LTDA"), item(40, 716, "CNPJ: 22.333.444/0001-55"),
    item(40, 680, "VALOR TOTAL DA NOTA = R$ 1.250,00"),
  ];
  const s = lerNfsePdf([pagina]);
  assert.equal(s.numero, "000345");
  assert.equal(s.emissao, "2026-10-03");
  assert.equal(s.prestador.cnpj, "22333444000155");
  assert.equal(s.prestador.nome, "TRANSPORTES EXEMPLO LTDA");
  assert.equal(s.valorServicos, 1250);
  // sem campo de ISS: fica zero, sem travar a leitura
  assert.equal(s.iss, 0);
  assert.equal(pareceNfsePdf([[item(40, 800, "DANFE"), item(40, 780, "CHAVE DE ACESSO")]]), false, "DANFE de NF-e vai para o outro leitor");
});

test("banco: chave de 44 (NF-e) ou 50 (NFS-e nacional) no painel e no recebimento", () => {
  const sql = ler("../supabase/migrations/202610130002_notas_de_servico.sql");
  assert.equal((sql.match(/\^\(\\d\{44\}\|\\d\{50\}\)\$/g) ?? []).length, 3);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.almoxarifado_confirmar_recebimento\(p jsonb\)/);
  const campos = ler("../lib/fiscal/icms-campos.ts");
  assert.match(campos, /chave\.length !== 44 && chave\.length !== 50/);
});
