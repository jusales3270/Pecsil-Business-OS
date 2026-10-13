import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { calcularItens, calcularTotais } = await import("../lib/fiscal/emissao/calculo.ts");
const { dvChave, chaveDeAcesso, gerarXmlNfe, nfeProcDeTreino, dataHoraBrasilia } = await import("../lib/fiscal/emissao/xml.ts");
const { validarNota, cnpjValido, cpfValido, problemasDoEmitente } = await import("../lib/fiscal/emissao/regras.ts");
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
  assert.ok(dev.erros.some((p) => p.campo === "referencia"));
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
  assert.match(xml, /<ICMS00><orig>0<\/orig><CST>00<\/CST><modBC>3<\/modBC><vBC>1000.00<\/vBC><pICMS>18.00<\/pICMS><vICMS>180.00<\/vICMS><\/ICMS00>/);
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

test("treino nunca fala com a SEFAZ e o portão humano está nas rotas", () => {
  const raiz = new URL("../app/api/fiscal/nfe/", import.meta.url);
  const rotas = [];
  const andar = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) andar(u); else rotas.push(readFileSync(u, "utf8"));
    }
  };
  andar(raiz);
  const tudo = rotas.join("\n") + ler("../lib/fiscal/emissao/servidor.ts");
  for (const proibido of [".autorizar(", ".evento(", ".inutilizar(", "credenciaisDaOrganizacao"]) {
    assert.ok(!tudo.includes(proibido), `o treino não pode chamar ${proibido}`);
  }
  assert.match(ler("../lib/fiscal/emissao/servidor.ts"), /AMBIENTES_LIBERADOS: AmbienteNfe\[\] = \["treino"\]/);
  const acao = ler("../app/api/fiscal/nfe/[id]/acao/route.ts");
  assert.match(acao, /validar: "operar", enviar: "operar", devolver: "aprovar", transmitir: "aprovar", cancelar: "aprovar", carta: "aprovar"/);
  assert.match(acao, /if \(!ambienteLiberado\(n\.ambiente\)\)/);
  assert.match(ler("../app/api/fiscal/nfe/inutilizar/route.ts"), /requireFeature\("fiscal\.nfe", "aprovar"\)/);
  assert.match(ler("../app/api/fiscal/nfe/route.ts"), /export async function DELETE[\s\S]*requireFeature\("fiscal\.nfe", "aprovar"\)[\s\S]*!== "treino"/);
});
