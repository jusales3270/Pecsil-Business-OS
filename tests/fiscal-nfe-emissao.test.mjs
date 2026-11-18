import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { calcularItens, calcularTotais } = await import("../lib/fiscal/emissao/calculo.ts");
const { dvChave, chaveDeAcesso, gerarXmlNfe, nfeProcDeTreino, dataHoraBrasilia } = await import("../lib/fiscal/emissao/xml.ts");
const { validarNota, cnpjValido, cpfValido, problemasDoEmitente, avisosIbsCbs } = await import("../lib/fiscal/emissao/regras.ts");
const { normalizarNota, notaVazia, itemPadrao } = await import("../lib/fiscal/emissao/normalizar.ts");

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const sql = ler("../supabase/migrations/202610130003_fiscal_nfe_emissao.sql");

// Dados fictícios (CNPJs de exemplo com dígito válido).
const EMITENTE = {
  cnpj: "11222333000181", razaoSocial: "EMPRESA EXEMPLO LTDA", fantasia: null, ie: "123456789012", im: null, cnae: null, crt: 3,
  logradouro: "RUA UM", numero: "100", complemento: null, bairro: "CENTRO", codigoMunicipio: "3523909", municipio: "ITU", uf: "SP", cep: "13300000", telefone: null,
};
const DEST = {
  documento: "11444777000161", nome: "CLIENTE EXEMPLO LTDA", indIE: 1, ie: "987654321098", email: "nf@cliente.exemplo",
  logradouro: "AV DOIS", numero: "200", complemento: "", bairro: "DISTRITO", codigoMunicipio: "3550308", municipio: "SAO PAULO", uf: "SP", cep: "01001000", fone: "",
};
const item = (extra = {}) => ({ ...itemPadrao("5101", 3), descricao: "PECA FUNDIDA", ncm: "73259910", quantidade: 10, valorUnitario: 100, ...extra });
const nota = (extra = {}) => ({ ...notaVazia(), destinatario: { ...DEST }, itens: [item()], ...extra });

test("CNPJ e CPF: dígito verificador", () => {
  assert.equal(cnpjValido("11.222.333/0001-81"), true);
  assert.equal(cnpjValido("11222333000182"), false);
  assert.equal(cnpjValido("00000000000000"), false);
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("52998224726"), false);
});

test("chave de acesso: 44 dígitos, DV módulo 11, mês de Brasília", () => {
  // Conferido contra um cálculo independente do módulo 11 (pesos 2 a 9, da direita).
  const base = "3526101122233300018155001000000001100000001";
  const soma = [...base].reverse().reduce((a, d, i) => a + Number(d) * (2 + (i % 8)), 0);
  const esperado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  assert.equal(dvChave(base), esperado);
  // 01/11 às 01h UTC ainda é 31/10 em Brasília: AAMM = 2610.
  const chave = chaveDeAcesso({ uf: "SP", emissao: new Date("2026-11-01T01:00:00Z"), cnpj: EMITENTE.cnpj, serie: 1, numero: 42, codigoNumerico: "12345678" });
  assert.match(chave, /^\d{44}$/);
  assert.equal(chave.slice(0, 2), "35");
  assert.equal(chave.slice(2, 6), "2610");
  assert.equal(chave.slice(20, 22), "55");
  assert.equal(chave.slice(25, 34), "000000042");
  assert.equal(Number(chave[43]), dvChave(chave.slice(0, 43)));
  assert.equal(dataHoraBrasilia(new Date("2026-10-13T15:00:00Z")), "2026-10-13T12:00:00-03:00");
});

test("cálculo: rateio do frete fecha centavo a centavo e o último item leva a diferença", () => {
  const n = nota({ itens: [item({ quantidade: 1, valorUnitario: 100 }), item({ quantidade: 1, valorUnitario: 100 }), item({ quantidade: 1, valorUnitario: 100 })], frete: { modalidade: 0, valor: 10 } });
  const itens = calcularItens(n);
  assert.deepEqual(itens.map((i) => i.vFrete), [3.33, 3.33, 3.34]);
  const t = calcularTotais(itens);
  assert.equal(t.vFrete, 10);
});

test("cálculo: ICMS, IPI, PIS e COFINS por item e o total da nota", () => {
  const n = nota({ itens: [item({ ipiAliquota: 5 })], frete: { modalidade: 0, valor: 50 } });
  const [c] = calcularItens(n);
  assert.equal(c.vProd, 1000);
  assert.equal(c.vBCIPI, 1050);
  assert.equal(c.vIPI, 52.5);
  assert.equal(c.vBC, 1050); // contribuinte: IPI fora da base do ICMS
  assert.equal(c.vICMS, 189);
  assert.equal(c.vPIS, 16.5);
  assert.equal(c.vCOFINS, 76);
  const t = calcularTotais([c]);
  assert.equal(t.vNF, 1102.5); // 1000 + 50 de frete + 52,50 de IPI
});

test("cálculo: consumidor final põe o IPI na base do ICMS; CST 20 reduz a base", () => {
  const [cf] = calcularItens(nota({ consumidorFinal: true, itens: [item({ ipiAliquota: 10 })] }));
  assert.equal(cf.vBC, 1100);
  const [red] = calcularItens(nota({ itens: [item({ icmsCst: "20", icmsReducaoBase: 33.33 })] }));
  assert.equal(red.vBC, 666.7);
  const [isento] = calcularItens(nota({ itens: [item({ icmsCst: "40" })] }));
  assert.equal(isento.vICMS, 0);
});

test("regras: nota correta passa; CFOP incoerente com o destino é apontado", () => {
  assert.deepEqual(validarNota(nota(), EMITENTE).erros, []);
  const fora = validarNota(nota({ destinatario: { ...DEST, uf: "MG", codigoMunicipio: "3106200" } }), EMITENTE);
  assert.ok(fora.erros.some((p) => p.campo === "itens.0.cfop" && /começando por 6/.test(p.mensagem)));
});

test("regras: duplicatas têm de fechar com a nota; não contribuinte exige consumidor final", () => {
  const dup = validarNota(nota({ pagamento: { forma: "15", duplicatas: [{ numero: "001", vencimento: "2026-11-12", valor: 999.99 }] } }), EMITENTE);
  assert.ok(dup.erros.some((p) => p.campo === "pagamento.duplicatas" && /centavo a centavo/.test(p.mensagem)));
  const nc = validarNota(nota({ destinatario: { ...DEST, indIE: 9, ie: "" } }), EMITENTE);
  assert.ok(nc.erros.some((p) => p.campo === "consumidorFinal"));
  const cst = validarNota(nota({ itens: [item({ icmsCst: "102" })] }), EMITENTE);
  assert.ok(cst.erros.some((p) => p.campo === "itens.0.icmsCst"), "CSOSN não vale no regime normal");
  const dev = validarNota(nota({ finalidade: 4 }), EMITENTE);
  assert.ok(dev.erros.some((p) => p.campo === "itens.0.dfeReferenciado"), "devolução sem a nota e o item devolvidos");
});

test("regras: emitente incompleto vira lista do que falta na Configuração fiscal", () => {
  const p = problemasDoEmitente({ ...EMITENTE, codigoMunicipio: "", razaoSocial: "" });
  assert.deepEqual(p.map((x) => x.campo).sort(), ["emitente.codigoMunicipio", "emitente.razaoSocial"]);
  assert.equal(problemasDoEmitente(null).length, 1);
});

test("normalizar: números no formato brasileiro, textos limpos e listas com limite", () => {
  const n = normalizarNota({
    natureza: "venda", destinatario: { documento: "11.444.777/0001-61", uf: "sp", cep: "01001-000" },
    itens: [{ quantidade: "1.234,5", valorUnitario: "10.25", ncm: "7325.99.10", icmsAliquota: "18" }, ...Array.from({ length: 300 }, () => ({}))],
    frete: { modalidade: 7, valor: "" }, pagamento: { duplicatas: [{ valor: "1.000,00", vencimento: "2026-11-12" }] },
  });
  assert.equal(n.natureza, "VENDA");
  assert.equal(n.destinatario.documento, "11444777000161");
  assert.equal(n.destinatario.uf, "SP");
  assert.equal(n.destinatario.cep, "01001000");
  assert.equal(n.itens[0].quantidade, 1234.5);
  assert.equal(n.itens[0].valorUnitario, 10.25);
  assert.equal(n.itens[0].ncm, "73259910");
  assert.equal(n.itens.length, 200);
  assert.equal(n.frete.modalidade, 9, "modalidade inválida volta a 9");
  assert.equal(n.frete.valor, 0);
  assert.equal(n.pagamento.duplicatas[0].valor, 1000);
});

test("XML: leiaute 4.00 com chave no Id, tpAmb 2 no treino, impostos e cobrança", () => {
  const n = nota({ pagamento: { forma: "15", duplicatas: [{ numero: "001", vencimento: "2026-11-12", valor: 1000 }] }, infoComplementar: "SIMULACAO DE TREINO NA PLATAFORMA - SEM VALOR FISCAL." });
  const { xml, chave, totais } = gerarXmlNfe({ nota: n, emitente: EMITENTE, serie: 1, numero: 7, emissao: new Date("2026-10-13T15:00:00Z"), codigoNumerico: "87654321", tpAmb: 2 });
  assert.match(xml, new RegExp(`<infNFe versao="4.00" Id="NFe${chave}">`));
  assert.match(xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(xml, /<ICMS00><orig>0<\/orig><CST>00<\/CST><modBC>3<\/modBC><vBC>1000.00<\/vBC><pICMS>18.0000<\/pICMS><vICMS>180.00<\/vICMS><\/ICMS00>/);
  assert.match(xml, /<PISAliq><CST>01<\/CST>/);
  assert.match(xml, /<cobr><fat><nFat>7<\/nFat>/);
  assert.match(xml, /<vNF>1000.00<\/vNF>/);
  assert.match(xml, /SEM VALOR FISCAL/);
  assert.equal(totais.vNF, 1000);
  // Ordem do esquema: ide → emit → dest → det → total → transp → cobr → pag → infAdic.
  const ordem = ["<ide>", "<emit>", "<dest>", "<det ", "<total>", "<transp>", "<cobr>", "<pag>", "<infAdic>"].map((t) => xml.indexOf(t));
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
  assert.ok(ordem.every((i) => i > 0));
});

test("XML autorizado do treino: protocolo fictício e motivo dizendo que é simulação", () => {
  const { xml, chave } = gerarXmlNfe({ nota: nota(), emitente: EMITENTE, serie: 1, numero: 8, emissao: new Date(), codigoNumerico: "11223344", tpAmb: 2 });
  const proc = nfeProcDeTreino(xml, chave, "926101234567890", new Date());
  assert.match(proc, /^<\?xml version="1.0" encoding="UTF-8"\?><nfeProc versao="4.00"/);
  assert.match(proc, /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  assert.match(proc, /<cStat>100<\/cStat><xMotivo>SIMULACAO - TREINO - SEM VALOR FISCAL<\/xMotivo>/);
  assert.match(proc, /<tpAmb>2<\/tpAmb>/);
});

test("migração: escrita só pelo servidor, leitura por fiscal.nfe, numeração atômica que pula faixa inutilizada", () => {
  for (const t of ["fiscal_nfe", "fiscal_nfe_eventos", "fiscal_nfe_numeracao"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  }
  assert.match(sql, /revoke insert, update, delete on public\.fiscal_nfe, public\.fiscal_nfe_eventos, public\.fiscal_nfe_numeracao from anon, authenticated/);
  assert.equal((sql.match(/has_feature\('fiscal\.nfe'\)/g) ?? []).length, 3);
  assert.match(sql, /revoke all on function public\.fiscal_nfe_reservar_numero\(uuid, text, int\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.fiscal_nfe_reservar_numero\(uuid, text, int\) to service_role/);
  assert.match(sql, /unique \(organization_id, ambiente, serie, numero\)/);
  assert.match(sql, /tipo = 'inutilizacao'[\s\S]*reservado between e\.numero_inicio and e\.numero_fim/);
  assert.match(sql, /check \(length\(trim\(texto\)\) between 15 and 1000\)/);
});

test("treino nunca fala com a SEFAZ, homologação fala com trava e consulta, produção bloqueada; portão humano nas rotas", () => {
  const raiz = new URL("../app/api/fiscal/nfe/", import.meta.url);
  const rotas = [];
  const andar = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) andar(u); else rotas.push(readFileSync(u, "utf8"));
    }
  };
  andar(raiz);
  void rotas;
  // Produção só com a Configuração fiscal em produção (docs/PLANO-VIRADA-FISCAL.md, 1.5): a rota e a gravação conferem.
  const srv = ler("../lib/fiscal/emissao/servidor.ts");
  assert.match(srv, /export async function ambientesDaOrganizacao[\s\S]*?producaoLigada\(admin, org\)\) \? \["treino", "homologacao", "producao"\] : \["treino", "homologacao"\]/);
  assert.match(srv, /export async function producaoLigada[\s\S]*?data\?\.ambiente === "producao"/);
  const nfeRota = ler("../app/api/fiscal/nfe/route.ts");
  assert.ok((nfeRota.match(/ambientesDaOrganizacao\(admin, autor\.org\)/g) ?? []).length >= 2, "GET e POST das notas só no ambiente que a empresa vê");
  const faturar = ler("../app/api/fiscal/faturar/route.ts");
  assert.ok((faturar.match(/ambiente === "producao" && !(\(await )?producaoLigada|ambiente === "producao" && !producao/g) ?? []).length >= 2, "A faturar só abre a produção com a Configuração em produção");
  // Quem fala com a SEFAZ é só o que não é treino, e com a Configuração no MESMO ambiente da nota.
  const sefaz = ler("../lib/fiscal/emissao/sefaz.ts");
  assert.match(sefaz, /export const naSefaz = \(ambiente: AmbienteNfe\) => ambiente !== "treino";/);
  assert.match(sefaz, /if \(cred\.ambiente !== ambiente\)/);
  const acao = ler("../app/api/fiscal/nfe/[id]/acao/route.ts");
  assert.match(acao, /const cred = sefaz \? await credenciaisDaEmissao/, "credenciais só fora do treino");
  assert.match(acao, /if \(!sefaz\) \{\s*const protocolo = protocoloDeTreino\(\);/, "treino segue simulado, antes de qualquer chamada");
  assert.match(acao, /\.eq\("situacao", "validada"\)\.select\("id"\);\s*if \(!trava\?\.length\)/, "trava: um clique só vai à SEFAZ");
  assert.match(acao, /tipo === "rejeitada"[\s\S]*situacao: "rejeitada"/);
  assert.match(acao, /Consulte na SEFAZ antes de transmitir de novo/, "sem resposta: nunca reenviar às cegas");
  assert.match(acao, /n\[aã\]o consta/, "217 como rejeição da biblioteca vira 'não consta'");
  for (const r of ["../app/api/fiscal/nfe/inutilizar/route.ts"]) assert.match(ler(r), /if \(naSefaz\(ambiente\)\)/);
  assert.match(acao, /validar: "operar", enviar: "operar", devolver: "aprovar", transmitir: "aprovar", consultar: "aprovar", cancelar: "aprovar", carta: "aprovar"/);
  assert.match(acao, /if \(!ambienteLiberado\(n\.ambiente\)\)/);
  assert.match(ler("../app/api/fiscal/nfe/inutilizar/route.ts"), /requireFeature\("fiscal\.nfe", "aprovar"\)/);
  assert.match(ler("../app/api/fiscal/nfe/route.ts"), /export async function DELETE[\s\S]*requireFeature\("fiscal\.nfe", "aprovar"\)[\s\S]*!== "treino"/);
});

const { lerBrasilApiCnpj, lerViaCep, consultarCnpj, consultarCep, ConsultaIndisponivel } = await import("../lib/fiscal/consulta-publica.ts");
const sqlClientes = ler("../supabase/migrations/202610130004_clientes_dados_fiscais.sql");

test("consulta pública: BrasilAPI junta o tipo do logradouro e traz o código IBGE", () => {
  const d = lerBrasilApiCnpj({
    razao_social: "EMPRESA EXEMPLO LTDA", descricao_situacao_cadastral: "ATIVA", cep: "13300000", descricao_tipo_de_logradouro: "RUA",
    logradouro: "DAS FLORES", numero: "", complemento: null, bairro: "CENTRO", municipio: "ITU", uf: "sp", codigo_municipio_ibge: 3523909, ddd_telefone_1: "1140230000", email: "Fiscal@Exemplo.com",
  });
  assert.equal(d.logradouro, "RUA DAS FLORES");
  assert.equal(d.numero, "SN");
  assert.equal(d.codigoMunicipio, "3523909");
  assert.equal(d.uf, "SP");
  assert.equal(d.telefone, "1140230000");
  assert.equal(d.email, "fiscal@exemplo.com");
  assert.equal(lerBrasilApiCnpj({ descricao_tipo_de_logradouro: "AVENIDA", logradouro: "AVENIDA PAULISTA" }).logradouro, "AVENIDA PAULISTA");
});

test("consulta pública: ViaCEP traz o IBGE; CEP inexistente volta null", () => {
  assert.deepEqual(lerViaCep({ cep: "01001-000", logradouro: "Praça da Sé", complemento: "lado ímpar", bairro: "Sé", localidade: "São Paulo", uf: "SP", ibge: "3550308" }),
    { cep: "01001000", logradouro: "Praça da Sé", complemento: "lado ímpar", bairro: "Sé", municipio: "São Paulo", codigoMunicipio: "3550308", uf: "SP" });
  assert.equal(lerViaCep({ erro: "true" }), null);
});

test("consulta pública: CPF nunca sai; 404 é não encontrado; queda vira aviso", async () => {
  let chamadas = 0;
  const falso = (status, corpo) => async () => { chamadas++; return new Response(JSON.stringify(corpo), { status }); };
  await assert.rejects(() => consultarCnpj("52998224725", falso(200, {})), /Só CNPJ/);
  assert.equal(chamadas, 0, "CPF não pode gerar chamada externa");
  assert.equal(await consultarCnpj("11222333000181", falso(404, { message: "não encontrado" })), null);
  await assert.rejects(() => consultarCnpj("11222333000181", async () => { throw new Error("rede"); }), ConsultaIndisponivel);
  await assert.rejects(() => consultarCep("01001000", falso(500, {})), ConsultaIndisponivel);
});

test("migração dos clientes: campos fiscais com checagem e gravação só pelo servidor", () => {
  for (const c of ["ie", "ind_ie", "email_nfe", "cep", "logradouro", "codigo_municipio", "uf", "telefone"]) assert.match(sqlClientes, new RegExp(`add column if not exists ${c} `));
  assert.match(sqlClientes, /revoke all on function public\.customer_dados_fiscais_gravar\(uuid, uuid, jsonb, text\) from public, anon, authenticated/);
  assert.match(sqlClientes, /grant execute on function public\.customer_dados_fiscais_gravar\(uuid, uuid, jsonb, text\) to service_role/);
  assert.match(sqlClientes, /if doc is null or nome is null then return null; end if;/, "sem documento não cria cliente");
  assert.match(ler("../app/api/fiscal/consulta/route.ts"), /requireFeature\("fiscal\.nfe", "operar"\)/);
});

test("IBS/CBS: base com frete, seguro e outras, sem o IPI (LC 214 art. 12)", () => {
  const ibs = { ibsCbsCst: "000", cClassTrib: "000001", ibsAliquota: 0.1, cbsAliquota: 0.9, ipiCst: "50", ipiAliquota: 10, pisCst: "01", pisAliquota: 1.65, cofinsCst: "01", cofinsAliquota: 7.6 };
  const [c] = calcularItens(nota({ itens: [item(ibs)], frete: { ...notaVazia().frete, valor: 80 }, seguro: 15, outrasDespesas: 5 }));
  assert.equal(c.vFrete + c.vSeg + c.vOutro, 100);
  assert.ok(c.vIPI > 0);
  assert.equal(c.vBCIBSCBS, Math.round((c.vProd - c.vDesc + 100 - c.vICMS - c.vPIS - c.vCOFINS) * 100) / 100);
  assert.equal(c.vCBS, Math.round(c.vBCIBSCBS * 0.9) / 100);
});

test("IBS/CBS: CST aceito, cClassTrib do mesmo CST e alíquota conferida com a lei", () => {
  const erros = (extra) => validarNota(nota({ itens: [item({ ibsCbsCst: "000", cClassTrib: "000001", ibsAliquota: 0.1, cbsAliquota: 0.9, ...extra })] }), EMITENTE).erros.map((e) => e.campo);
  assert.deepEqual(erros({}).filter((c) => /ibs|cbs|cClass/i.test(c)), []);
  assert.ok(erros({ cClassTrib: "410999" }).includes("itens.0.cClassTrib"));
  assert.ok(erros({ cClassTrib: "0001" }).includes("itens.0.cClassTrib"));
  assert.ok(erros({ ibsCbsCst: "200", cClassTrib: "200001" }).includes("itens.0.ibsCbsCst"));
  assert.ok(erros({ cbsAliquota: 0 }).includes("itens.0.cbsAliquota"));
  assert.deepEqual(erros({ ibsCbsCst: "410", cClassTrib: "410999", ibsAliquota: undefined, cbsAliquota: undefined }).filter((c) => /ibs|cbs|cClass/i.test(c)), []);

  const legal = { cbs: 0.009, ibs: 0.001, norma: "LC 214/2025", aConferir: false };
  const certa = nota({ itens: [item({ ibsCbsCst: "000", cClassTrib: "000001", ibsAliquota: 0.1, cbsAliquota: 0.9 })] });
  assert.deepEqual(avisosIbsCbs(certa, 3, legal), []);
  const errada = nota({ itens: [item({ ibsCbsCst: "000", cClassTrib: "000001", ibsAliquota: 0.1, cbsAliquota: 0.8 })] });
  assert.match(avisosIbsCbs(errada, 3, legal)[0].mensagem, /CBS 0,80%.*CBS 0,90%/);
  assert.match(avisosIbsCbs(nota(), 3, legal)[0].mensagem, /grupo IBS\/CBS/);
  assert.deepEqual(avisosIbsCbs(nota(), 1, legal), []);
  assert.match(avisosIbsCbs(certa, 3, null)[0].mensagem, /Não há parâmetro legal/);
  assert.equal(avisosIbsCbs(certa, 3, { ...legal, aConferir: true }).length, 1);
});

const { lerNotaDevolvivel } = await import("../lib/fiscal/emissao/devolucao.ts");
// Chave fictícia com DV certo: nota de venda do fornecedor (o destinatário da devolução) para a empresa.
const CHAVE_DEV = chaveDeAcesso({ uf: "SP", emissao: new Date("2026-10-10T13:00:00Z"), cnpj: DEST.documento, serie: 1, numero: 7847, codigoNumerico: "23456789" });
const devolucao = (itens) => nota({ finalidade: 4, tipo: 1, natureza: "DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO", referencia: CHAVE_DEV, itens });

test("devolução: cada item leva a nota e o item devolvidos (DFeReferenciado) e o refNFe sai (NT 2025.002 v1.52)", () => {
  const n = devolucao([item({ cfop: "5201", dfeReferenciado: { nItem: 2 } }), item({ cfop: "5201", dfeReferenciado: { nItem: 1 } })]);
  assert.deepEqual(validarNota(n, EMITENTE).erros.filter((p) => /dfeReferenciado|referencia/.test(p.campo)), []);
  const { xml } = gerarXmlNfe({ nota: n, emitente: EMITENTE, serie: 1, numero: 10, emissao: new Date("2026-11-05T12:00:00Z"), codigoNumerico: "12345678", tpAmb: 2 });
  assert.ok(!xml.includes("<NFref>"), "refNFe proibido na devolução (RV VC02-05/VC02-14)");
  const dets = xml.match(/<det nItem="\d+">.*?<\/det>/g);
  // Ordem do esquema: imposto, infAdProd, vItem, DFeReferenciado.
  assert.match(dets[0], new RegExp(`</imposto>(<infAdProd>.*</infAdProd>)?(<vItem>[\\d.]+</vItem>)?<DFeReferenciado><chaveAcesso>${CHAVE_DEV}</chaveAcesso><nItem>2</nItem></DFeReferenciado></det>$`));
  assert.match(dets[1], /<nItem>1<\/nItem><\/DFeReferenciado><\/det>$/);
  // Complementar continua com o refNFe no cabeçalho.
  const comp = gerarXmlNfe({ nota: nota({ finalidade: 2, referencia: CHAVE_DEV }), emitente: EMITENTE, serie: 1, numero: 11, emissao: new Date(), codigoNumerico: "12345678", tpAmb: 2 }).xml;
  assert.ok(comp.includes(`<NFref><refNFe>${CHAVE_DEV}</refNFe></NFref>`) && !comp.includes("DFeReferenciado"));
});

test("devolução: regras do grupo VC (nº do item, chave válida, sem repetir, mesmo emitente, emitente = destinatário)", () => {
  const erros = (itens, extra = {}) => validarNota({ ...devolucao(itens), ...extra }, EMITENTE).erros.filter((p) => /dfeReferenciado|referencia/.test(p.campo)).map((p) => p.mensagem).join(" | ");
  assert.match(erros([item({ cfop: "5201" })]), /número do item na nota devolvida/);
  assert.match(erros([item({ cfop: "5201", dfeReferenciado: { nItem: 1, chave: CHAVE_DEV.slice(0, 43) + ((Number(CHAVE_DEV[43]) + 1) % 10) } })]), /dígito verificador/);
  assert.match(erros([item({ cfop: "5201", dfeReferenciado: { nItem: 1, chave: "123" } })]), /44 dígitos/);
  assert.match(erros([item({ cfop: "5201", dfeReferenciado: { nItem: 1 } }), item({ cfop: "5201", dfeReferenciado: { nItem: 1 } })]), /já foi referenciado/);
  const propria = chaveDeAcesso({ uf: "SP", emissao: new Date("2026-10-10T13:00:00Z"), cnpj: EMITENTE.cnpj, serie: 1, numero: 5, codigoNumerico: "34567890" });
  const terceiro = chaveDeAcesso({ uf: "SP", emissao: new Date("2026-10-10T13:00:00Z"), cnpj: "06990590000123", serie: 1, numero: 5, codigoNumerico: "34567890" });
  assert.match(erros([item({ cfop: "5201", dfeReferenciado: { nItem: 1 } }), item({ cfop: "5201", dfeReferenciado: { nItem: 1, chave: terceiro } })]), /mesmo emitente/);
  assert.match(erros([item({ cfop: "5201", dfeReferenciado: { nItem: 1 } })], { referencia: terceiro }), /destinatário desta nota/);
  // Nota de entrada emitida pela própria empresa também pode ser devolvida.
  assert.equal(erros([item({ cfop: "5201", dfeReferenciado: { nItem: 1 } })], { referencia: propria }), "");
});

test("devolução: os itens vêm da nota original com o nº do item", () => {
  const original = `<nfeProc><NFe><infNFe versao="4.00" Id="NFe${CHAVE_DEV}"><ide><nNF>7847</nNF><tpNF>1</tpNF><dhEmi>2026-10-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${DEST.documento}</CNPJ><xNome>FORNECEDOR &amp;amp; FILHOS</xNome></emit>
<det nItem="1"><prod><cProd>A1</cProd><xProd>AREIA BASE</xProd><NCM>25051000</NCM><CFOP>5101</CFOP><uCom>kg</uCom><qCom>1500.0000</qCom><vUnCom>1.2300</vUnCom><vProd>1845.00</vProd><vDesc>5.00</vDesc></prod><imposto><ICMS><ICMS00><orig>0</orig></ICMS00></ICMS></imposto></det>
<det nItem="2"><prod><cProd>B2</cProd><xProd>RESINA</xProd><NCM>39094099</NCM><CFOP>5101</CFOP><uCom>UN</uCom><qCom>3</qCom><vUnCom>200</vUnCom><vProd>600.00</vProd></prod><imposto><ICMS><ICMS00><orig>1</orig></ICMS00></ICMS></imposto></det></infNFe></NFe></nfeProc>`;
  const n = lerNotaDevolvivel(original);
  assert.equal(n.chave, CHAVE_DEV);
  assert.equal(n.emitente.nome, "FORNECEDOR & FILHOS");
  assert.deepEqual(n.itens.map((i) => [i.nItem, i.codigo, i.unidade, i.quantidade, i.valorUnitario, i.desconto, i.origem]), [[1, "A1", "KG", 1500, 1.23, 5, 0], [2, "B2", "UN", 3, 200, 0, 1]]);
  assert.equal(lerNotaDevolvivel("<xml/>"), null);
});

test("produção (virada de 01/12): máscara confirmada, Configuração em produção e numeração depois da do GRV", () => {
  const srv = ler("../lib/fiscal/emissao/servidor.ts");
  const bloco = srv.slice(srv.indexOf('if (registro.ambiente === "producao") {'), srv.indexOf("// Homologação: a SEFAZ de teste"));
  assert.match(bloco, /problemasDeMascaraNaProducao\(admin, org, registro\.nota\)/);
  assert.match(bloco, /if \(!\(await producaoLigada\(admin, org\)\)\) erros\.push/);
  assert.match(bloco, /if \(!registro\.numero\) erros\.push\(\.\.\.\(await problemasDaNumeracaoNaProducao/);
  const num = srv.slice(srv.indexOf("export async function problemasDaNumeracaoNaProducao"), srv.indexOf("export type Autor"));
  assert.match(num, /if \(!serieCfg\) return \[/, "sem o próximo número gravado, a produção não sai");
  assert.match(num, /usada\?\.proximo \?\? serieCfg\.proximo_numero/);
  assert.match(num, /eq\("emitente_cnpj", cnpj\)/, "só as notas da própria empresa contam");
  assert.match(num, /if \(proximo <= maior\)/);
  // A chave: série nas posições 23–25 e número nas 26–34.
  const chave = "35261146839106000184550010000012341123456789";
  assert.equal(Number(chave.slice(22, 25)), 1);
  assert.equal(Number(chave.slice(25, 34)), 1234);
  // A troca para produção exige a palavra digitada na tela e a permissão de aprovar no banco.
  const cfg = ler("../modules/fiscal/src/ConfiguracaoFiscal.tsx");
  assert.match(cfg, /palavra\.trim\(\)\.toLocaleUpperCase\("pt-BR"\) !== "PRODUÇÃO"/);
  assert.match(cfg, /dados\?\.podeProducao && c/);
  assert.match(ler("../app/api/fiscal/config/route.ts"), /event_type: "fiscal\.config\.ambiente"[^\n]*risk_level: "high"/, "a troca de ambiente vai para a auditoria");
  assert.match(ler("../supabase/migrations/202610160008_decisoes_por_area.sql"), /p ->> 'ambiente' = 'producao' and atual\.ambiente <> 'producao' and not public\.has_feature\('fiscal\.nfe', 'aprovar'\)/);
});
