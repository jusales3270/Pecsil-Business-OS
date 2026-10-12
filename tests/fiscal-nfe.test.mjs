import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { lerDocumentoDistribuido, proximaConsulta } = await import("../lib/fiscal/dfe.ts");
const { lerCadastroSefaz } = await import("../lib/fiscal/cadastro.ts");
const { criarTransmissorHttp } = await import("../lib/fiscal/transmissor/http.ts");
const { ErroTransmissor } = await import("../lib/fiscal/transmissor/contrato.ts");

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const sql = ler("../supabase/migrations/202610120002_fiscal_nfe_base.sql");
const nfeProc = ler("./fixtures/nfe-ficticia.xml");
const sqlCert = ler("../supabase/migrations/202610120003_fiscal_certificado_permissao.sql");
const CHAVE = "35261011222333000181550010000123451000012345";

test("distribuição: resumo da nota (resNFe)", () => {
  const xml = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${CHAVE}</chNFe><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR &amp; FILHOS</xNome><IE>123</IE><dhEmi>2026-10-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1500.50</vNF><digVal>x</digVal><dhRecbto>2026-10-10T10:00:01-03:00</dhRecbto><nProt>135260000000001</nProt><cSitNFe>3</cSitNFe></resNFe>`;
  const r = lerDocumentoDistribuido({ nsu: "000000000000007", schema: "resNFe_v1.01.xsd", xml });
  assert.equal(r.arquivo, null, "resumo não vai para Documentos");
  assert.deepEqual(
    { tipo: r.registro.tipo, nsu: r.registro.nsu, chave: r.registro.chave, nome: r.registro.emitente_nome, valor: r.registro.valor, situacao: r.registro.situacao, tipo_nf: r.registro.tipo_nf },
    { tipo: "resumo", nsu: "000000000000007", chave: CHAVE, nome: "FORNECEDOR & FILHOS", valor: 1500.5, situacao: "cancelada", tipo_nf: 1 },
  );
});

test("distribuição: nota completa (nfeProc) vai para Documentos como veio", () => {
  const r = lerDocumentoDistribuido({ nsu: "8", schema: "procNFe_v4.00.xsd", xml: nfeProc });
  assert.equal(r.registro.tipo, "nota");
  assert.equal(r.registro.nsu, "000000000000008");
  assert.equal(r.registro.chave, CHAVE);
  assert.equal(r.registro.emitente_cnpj, "11222333000181");
  assert.equal(r.registro.emitente_nome, "FERRAMENTAS EXEMPLO & CIA LTDA");
  assert.equal(r.registro.valor, 233.63);
  assert.equal(r.registro.situacao, "autorizada");
  assert.equal(r.arquivo.nome, `NFe${CHAVE}.xml`);
  assert.equal(r.arquivo.xml, nfeProc, "o XML guardado é o original, sem mexer");
  assert.match(r.arquivo.titulo, /^NF-e 12345 · FERRAMENTAS EXEMPLO/);
});

test("distribuição: eventos (cancelamento pelo emitente)", () => {
  const res = `<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cOrgao>35</cOrgao><CNPJ>11222333000181</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-10-11T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><xEvento>Cancelamento</xEvento><dhRecbto>2026-10-11T09:00:01-03:00</dhRecbto><nProt>135260000000002</nProt></resEvento>`;
  const r = lerDocumentoDistribuido({ nsu: "9", schema: "resEvento_v1.01.xsd", xml: res });
  assert.deepEqual(
    { tipo: r.registro.tipo, tp: r.registro.tp_evento, desc: r.registro.descricao, seq: r.registro.sequencia, prot: r.registro.protocolo },
    { tipo: "evento", tp: "110111", desc: "Cancelamento", seq: 1, prot: "135260000000002" },
  );
  const proc = `<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><evento versao="1.00"><infEvento Id="ID110111${CHAVE}01"><cOrgao>35</cOrgao><tpAmb>1</tpAmb><CNPJ>11222333000181</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-10-11T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>135260000000001</nProt><xJust>Erro na emissao da nota fiscal</xJust></detEvento></infEvento></evento><retEvento versao="1.00"><infEvento><cStat>135</cStat><chNFe>${CHAVE}</chNFe><nProt>135260000000003</nProt></infEvento></retEvento></procEventoNFe>`;
  const p = lerDocumentoDistribuido({ nsu: "10", schema: "procEventoNFe_v1.00.xsd", xml: proc });
  assert.equal(p.registro.tp_evento, "110111");
  assert.equal(p.registro.protocolo, "135260000000003", "o protocolo é o do registro do evento, não o da nota");
  assert.equal(lerDocumentoDistribuido({ nsu: "11", schema: null, xml: "<outra/>" }), null);
  assert.equal(lerDocumentoDistribuido({ nsu: null, schema: null, xml: nfeProc }), null, "sem NSU não registra");
});

test("distribuição: regra da 1 hora da SEFAZ", () => {
  const agora = Date.parse("2026-10-12T10:00:00Z");
  const minutos = (d) => (d.getTime() - agora) / 60_000;
  assert.equal(minutos(proximaConsulta({ cStat: "137", ultimoNsu: "000000000000005", maxNsu: "000000000000005" }, agora)), 61);
  assert.equal(minutos(proximaConsulta({ cStat: "138", ultimoNsu: "000000000000005", maxNsu: "000000000000005" }, agora)), 61, "chegou ao fim da fila");
  assert.equal(minutos(proximaConsulta({ cStat: "138", ultimoNsu: "000000000000005", maxNsu: "000000000000090" }, agora)), 1, "ainda há documentos");
});

test("cadastro da SEFAZ → campos do emitente", () => {
  const bruto = { retConsCad: { infCons: { cStat: ["111"], infCad: [{ IE: ["123456789110"], CNPJ: ["11222333000181"], UF: ["SP"], cSit: ["1"], xNome: ["EMPRESA EXEMPLO LTDA"], xRegApur: ["NORMAL - REGIME PERIÓDICO DE APURAÇÃO"], CNAE: ["2451200"], ender: [{ xLgr: ["RUA EXEMPLO"], nro: ["100"], xBairro: ["CENTRO"], cMun: ["3523909"], xMun: ["ITU"], CEP: ["13300000"] }] }] } } };
  const c = lerCadastroSefaz(bruto);
  assert.equal(c.ie, "123456789110");
  assert.equal(c.razao_social, "EMPRESA EXEMPLO LTDA");
  assert.equal(c.situacao, "habilitado");
  assert.equal(c.codigo_municipio, "3523909");
  assert.equal(c.cep, "13300000");
  assert.equal(c.complemento, null);
  assert.equal(lerCadastroSefaz({ retConsCad: { infCons: { cStat: "259" } } }), null);
});

/** fetch falso: registra as chamadas e responde o que o teste mandar. */
function fetchFalso(respostas) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url, init, corpo: JSON.parse(init.body) });
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  };
  return { f, chamadas };
}
const CRED = { uf: "SP", cnpj: "11222333000181", ambiente: "homologacao", certificado: { pfx: "UEZY", senha: "segredo-do-certificado" } };

test("transmissor HTTP: segredo no cabeçalho e credenciais a cada chamada", async () => {
  const { f, chamadas } = fetchFalso([{ corpo: { ok: true, resultado: { cStat: "107", motivo: "Servico em Operacao", bruto: {} } } }]);
  const t = criarTransmissorHttp({ url: "http://transmissor:3100/", segredo: "x".repeat(40), fetch: f });
  const r = await t.status(CRED);
  assert.equal(r.cStat, "107");
  assert.equal(chamadas[0].url, "http://transmissor:3100/v1/status");
  assert.equal(chamadas[0].init.headers["x-transmissor-secret"], "x".repeat(40));
  assert.equal(chamadas[0].corpo.certificado.senha, "segredo-do-certificado");
});

test("transmissor HTTP: consulta repete na queda de rede; autorizar NUNCA repete às cegas", async () => {
  const consulta = fetchFalso([new TypeError("fetch failed"), { corpo: { ok: true, resultado: { cStat: "100", motivo: "Autorizado", bruto: {} } } }]);
  const t1 = criarTransmissorHttp({ url: "http://t", segredo: "x".repeat(40), fetch: consulta.f });
  assert.equal((await t1.consultar(CRED, "1".repeat(44))).cStat, "100");
  assert.equal(consulta.chamadas.length, 2);

  const autorizar = fetchFalso([new TypeError("fetch failed"), { corpo: { ok: true, resultado: {} } }]);
  const t2 = criarTransmissorHttp({ url: "http://t", segredo: "x".repeat(40), fetch: autorizar.f });
  await assert.rejects(t2.autorizar(CRED, "<NFe/>"), (e) => e instanceof ErroTransmissor && e.codigo === "INDISPONIVEL");
  assert.equal(autorizar.chamadas.length, 1, "uma nota não pode ir duas vezes sem consultar antes");
});

test("transmissor HTTP: códigos de erro e DANFE", async () => {
  const { f } = fetchFalso([
    { status: 400, corpo: { ok: false, erro: { codigo: "JUSTIFICATIVA", mensagem: "A justificativa precisa de ao menos 15 caracteres." } } },
    { status: 502, corpo: { ok: false, erro: { codigo: "CONSUMO_INDEVIDO", mensagem: "Rejeição: Consumo Indevido" } } },
    { corpo: { ok: true, resultado: { pdf: Buffer.from("%PDF-1.4").toString("base64") } } },
  ]);
  const t = criarTransmissorHttp({ url: "http://t", segredo: "x".repeat(40), fetch: f });
  await assert.rejects(t.evento(CRED, { tipo: "cancelamento", chave: "1".repeat(44), protocolo: "1", justificativa: "curta" }), (e) => e.codigo === "PEDIDO_INVALIDO" && /15 caracteres/.test(e.message));
  await assert.rejects(t.distribuicao(CRED, { ultimoNsu: "0".repeat(15) }), (e) => e.codigo === "CONSUMO_INDEVIDO");
  assert.equal((await t.danfe("<nfeProc/>")).subarray(0, 4).toString(), "%PDF");
});

test("transmissor: sem configuração, erro claro (e nunca no navegador)", async () => {
  const { obterTransmissor, transmissorConfigurado } = await import("../lib/fiscal/transmissor/index.ts");
  const antes = { url: process.env.TRANSMISSOR_URL, seg: process.env.TRANSMISSOR_SECRET };
  delete process.env.TRANSMISSOR_URL;
  process.env.TRANSMISSOR_SECRET = "curto";
  assert.equal(transmissorConfigurado(), false);
  assert.throws(() => obterTransmissor(), (e) => e.codigo === "NAO_CONFIGURADO");
  if (antes.url !== undefined) process.env.TRANSMISSOR_URL = antes.url;
  if (antes.seg !== undefined) process.env.TRANSMISSOR_SECRET = antes.seg; else delete process.env.TRANSMISSOR_SECRET;
  for (const arquivo of ["../lib/fiscal/transmissor/index.ts", "../lib/fiscal/transmissor/http.ts", "../lib/fiscal/servidor.ts"]) {
    assert.doesNotMatch(ler(arquivo), /NEXT_PUBLIC_TRANSMISSOR|NEXT_PUBLIC_FISCAL/, arquivo);
  }
});

test("certificado: nunca em log nem em resposta", () => {
  const servidor = ler("../lib/fiscal/servidor.ts");
  const rota = ler("../app/api/fiscal/config/certificado/route.ts");
  // Nenhum console.* recebe as credenciais ou o certificado.
  for (const linha of [...servidor.split("\n"), ...rota.split("\n")].filter((l) => /console\./.test(l))) {
    assert.doesNotMatch(linha, /cred|certificado|pfx|senha/i, linha);
  }
  // A rota devolve só os dados públicos.
  assert.match(rota, /NextResponse\.json\(\{ titular: dados\.titular, cnpj: dados\.cnpj, validade: dados\.validade, emissor: dados\.emissor \}\)/);
});

test("certificado: permissão própria, auditoria de risco alto e aviso ao proprietário", () => {
  // Enviar e remover: o proprietário ou quem recebeu "Certificado digital".
  assert.equal((sqlCert.match(/not \(public\.is_owner\(\) or public\.has_feature\('fiscal\.certificado', 'operar'\)\)/g) ?? []).length, 2);
  // Cada ação vai para audit_logs com risco alto…
  assert.match(sqlCert, /insert into public\.audit_logs[\s\S]*'high'/);
  // …sem o arquivo nem a senha (o registro só leva titular, CNPJ e validade).
  const registro = sqlCert.slice(sqlCert.indexOf("create or replace function public.fiscal_certificado_registrar"), sqlCert.indexOf("create or replace function public.fiscal_certificado_salvar"));
  assert.doesNotMatch(registro, /p_pfx|p_senha|decrypted_secret/);
  // Avisa os proprietários (o notify_feature não inclui o dono) e quem cuida do certificado.
  assert.match(registro, /p\.is_owner or exists/);
  // A função de registro não é chamável pelo cliente; ler o certificado continua só do servidor.
  assert.match(sqlCert, /revoke all on function public\.fiscal_certificado_registrar\([^)]*\) from public, anon, authenticated;/);
  assert.doesNotMatch(sqlCert, /fiscal_certificado_ler/);
  // Ligar a produção continua só do proprietário (esta migração não mexe nisso).
  assert.doesNotMatch(sqlCert, /fiscal_config_salvar/);
});

test("migração: cofre, permissões e multiempresa", () => {
  // Ler o certificado: só a chave de serviço.
  assert.match(sql, /revoke all on function public\.fiscal_certificado_ler\(uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.fiscal_certificado_ler\(uuid\) to service_role;/);
  // A tabela com os ids do cofre não tem política nenhuma.
  assert.doesNotMatch(sql, /create policy \w+ on public\.fiscal_certificado_segredos/);
  // Enviar e remover: só o proprietário. Produção: só o proprietário liga.
  assert.match(sql, /if org is null or not public\.is_owner\(\) then\s+raise exception 'Só o proprietário envia o certificado digital\.'/);
  assert.match(sql, /'producao' and atual\.ambiente <> 'producao' and not public\.is_owner\(\)/);
  // Registrar documentos e notas da SEFAZ: só o servidor.
  assert.match(sql, /grant execute on function public\.fiscal_dfe_registrar\(uuid, jsonb\) to service_role;/);
  assert.match(sql, /grant execute on function public\.company_document_register_sistema\([^)]*\) to service_role;/);
  // Começa em homologação; o emitente vem da organização, nunca fixo no código.
  assert.match(sql, /ambiente text not null default 'homologacao'/);
  assert.doesNotMatch(sql, /46\.?839\.?106|pecsil/i);
});
