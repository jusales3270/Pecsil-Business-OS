import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { cancelamentoDoXml, classificarEnvio, lacunasDaNumeracao, lerEventoNfe, lerNfeEmitida, mesDaChave, naturezaDaSaida, numeroDaChave } = await import("../lib/fiscal/emitidas-envio.ts");
const { ladoDaNota, lerIbsCbs } = await import("../lib/fiscal/ibs-cbs/leitura.ts");
const { receitaPorMes } = await import("../lib/contabil/apuracao/receita.ts");

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const EMPRESA = "11222333000181";
const CLIENTE = "99888777000166";
// Chave: cUF 35 · AAMM 2601 · CNPJ · mod 55 · série 001 · nNF 000010580 · tpEmis 1 · código · DV (fictícia).
const chave = (nNF, cnpj = EMPRESA, aamm = "2601") => `35${aamm}${cnpj}55001${String(nNF).padStart(9, "0")}1000127173`;
const nfe = ({ nNF = 10582, emit = EMPRESA, tpNF = "1", finNFe = "1", dhEmi = "2026-01-06T10:00:00-03:00", cfop = "6101", vProd = "9568.00", aamm = "2601" } = {}) =>
  `<?xml version="1.0"?><nfeProc><NFe><infNFe versao="4.00" Id="NFe${chave(nNF, emit, aamm)}"><ide><mod>55</mod><serie>1</serie><nNF>${nNF}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>${tpNF}</tpNF><finNFe>${finNFe}</finNFe></ide>
<emit><CNPJ>${emit}</CNPJ><xNome>EMPRESA TESTE</xNome></emit><dest><CNPJ>${CLIENTE}</CNPJ><xNome>CLIENTE &amp;amp; TESTE S.A.</xNome></dest>
<det nItem="1"><prod><CFOP>${cfop}</CFOP><vProd>${vProd}</vProd></prod><imposto></imposto></det><total><ICMSTot><vNF>${vProd}</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const cce = (nNF, aamm = "2601") => `<?xml version="1.0"?><procEventoNFe versao="1.00"><evento><infEvento Id="ID110110${chave(nNF, EMPRESA, aamm)}01"><chNFe>${chave(nNF, EMPRESA, aamm)}</chNFe><dhEvento>2026-02-06T10:00:00-03:00</dhEvento><tpEvento>110110</tpEvento><nSeqEvento>1</nSeqEvento><detEvento><xCorrecao>VENCIMENTO CORRETO: 01/07/2026.</xCorrecao></detEvento></infEvento></evento><retEvento><infEvento><cStat>135</cStat></infEvento></retEvento></procEventoNFe>`;
const ctx = (extra = {}) => ({ mes: "2026-01", cnpjEmpresa: EMPRESA, jaNaPlataforma: new Set(), arquivoJaGuardado: [], ...extra });

test("emitidas: lê a NF-e emitida e o evento; mês e número saem da chave", () => {
  const n = lerNfeEmitida("a.xml", nfe(), EMPRESA);
  assert.equal(n.tipo, "nfe");
  assert.equal(n.numero, "10582");
  assert.equal(n.destinatario, "CLIENTE & TESTE S.A.");
  assert.deepEqual(n.porCfop, { 6101: 9568 });
  const e = lerEventoNfe("b.xml", cce(10595));
  assert.deepEqual([e.tipo, e.evento, e.sequencia, numeroDaChave(e.chave), mesDaChave(e.chave)], ["evento", "110110", "1", "10595", "2026-01"]);
  assert.equal(lerEventoNfe("c.xml", nfe()), null, "NF-e não é evento");
  assert.equal(lerNfeEmitida("d.xml", cce(1), EMPRESA), null, "evento não é NF-e");
});

test("emitidas: natureza da saída pelo CFOP", () => {
  assert.equal(naturezaDaSaida({ 6101: 10 }), "venda");
  assert.equal(naturezaDaSaida({ 7101: 10, 7501: 5 }), "exportacao");
  assert.equal(naturezaDaSaida({ 5901: 10 }), "remessa");
  assert.equal(naturezaDaSaida({ 6916: 10 }), "remessa");
  assert.equal(naturezaDaSaida({ 1201: 10 }), "devolucao");
});

test("emitidas: cada arquivo do envio recebe a situação certa", () => {
  const lidos = [
    lerNfeEmitida("venda.xml", nfe({ nNF: 10582 }), EMPRESA),
    lerNfeEmitida("importacao.xml", nfe({ nNF: 10580, tpNF: "0", cfop: "3551" }), EMPRESA),
    lerNfeEmitida("remessa.xml", nfe({ nNF: 10606, cfop: "5901" }), EMPRESA),
    lerNfeEmitida("venda-de-novo.xml", nfe({ nNF: 10582 }), EMPRESA),
    lerNfeEmitida("ja.xml", nfe({ nNF: 10583 }), EMPRESA),
    lerNfeEmitida("fevereiro.xml", nfe({ nNF: 10700, dhEmi: "2026-02-02T10:00:00-03:00", aamm: "2602" }), EMPRESA),
    lerNfeEmitida("recebida.xml", nfe({ nNF: 55, emit: CLIENTE }), EMPRESA),
    lerEventoNfe("cce.xml", cce(10595)),
    { nome: "danfe.pdf", tipo: "danfe", chave: chave(10582), numero: "10582", emissao: "2026-01-06", emitenteCnpj: EMPRESA, destinatario: null, valor: 9568 },
    { nome: "danfe-sozinho.pdf", tipo: "danfe", chave: chave(10599), numero: "10599", emissao: "2026-01-16", emitenteCnpj: EMPRESA, destinatario: null, valor: 1 },
    { nome: "planilha.xml", tipo: "erro", erro: "Não é XML de NF-e" },
    lerNfeEmitida("mesmo-arquivo.xml", nfe({ nNF: 10584 }), EMPRESA),
  ];
  const l = classificarEnvio(lidos, ctx({ jaNaPlataforma: new Set([chave(10583)]), arquivoJaGuardado: lidos.map((_, i) => i === 11) }));
  assert.deepEqual(l.map((x) => [x.arquivo, x.situacao, x.entra]), [
    ["venda.xml", "saida", true], ["importacao.xml", "entrada_propria", true], ["remessa.xml", "saida", true],
    ["venda-de-novo.xml", "repetida_no_envio", false], ["ja.xml", "ja_na_plataforma", false], ["fevereiro.xml", "outro_mes", false],
    ["recebida.xml", "outra_empresa", false], ["cce.xml", "evento", true], ["danfe.pdf", "danfe", true], ["danfe-sozinho.pdf", "danfe", true],
    ["planilha.xml", "nao_reconhecido", false], ["mesmo-arquivo.xml", "ja_na_plataforma", false],
  ]);
  assert.equal(l[0].natureza, "venda");
  assert.equal(l[2].natureza, "remessa");
  assert.equal(l[5].mesDaNota, "2026-02");
  assert.match(l[5].nota, /fevereiro de 2026/);
  assert.match(l[8].nota, /junto da nota/, "DANFE com o XML no envio");
  assert.match(l[9].nota, /sem o XML/, "DANFE sem o XML avisa");
  assert.match(l[7].nota, /Carta de correção da NF 10595/);
});

test("emitidas: números que faltam na sequência, com os que só têm evento", () => {
  assert.deepEqual(lacunasDaNumeracao(["10586", "10587", "10589", "10591", "10594", "10596"], ["10595"]), [
    { numero: 10588, soEvento: false }, { numero: 10590, soEvento: false }, { numero: 10592, soEvento: false }, { numero: 10593, soEvento: false }, { numero: 10595, soEvento: true },
  ]);
  assert.deepEqual(lacunasDaNumeracao(["10"]), [], "um número só: sem sequência");
  assert.deepEqual(lacunasDaNumeracao(["1", "9000"]), [], "salto grande não é falta de nota");
});

test("lado: a nota de entrada que a empresa emite é entrada; a devolução emitida por ela segue saída", () => {
  assert.equal(ladoDaNota(EMPRESA, CLIENTE, EMPRESA, "1", "1"), "saida");
  assert.equal(ladoDaNota(EMPRESA, null, EMPRESA, "0", "1"), "entrada", "importação");
  assert.equal(ladoDaNota(EMPRESA, EMPRESA, EMPRESA, "0", "3"), "entrada", "ajuste de crédito");
  assert.equal(ladoDaNota(EMPRESA, CLIENTE, EMPRESA, "0", "4"), "saida", "devolução: a apuração inverte");
  assert.equal(ladoDaNota(CLIENTE, EMPRESA, EMPRESA, "1", "1"), "entrada");
  assert.equal(lerIbsCbs(nfe({ tpNF: "0", cfop: "3101" }), EMPRESA).lado, "entrada");
});

test("receita: a devolução de venda emitida pela empresa é abatida", () => {
  const meses = receitaPorMes([
    { lado: "saida", competencia: "2026-01", receita: { porCfop: { 6101: 1000 } } },
    { lado: "saida", competencia: "2026-01", receita: { porCfop: { 1201: 200 } } },
    { lado: "entrada", competencia: "2026-01", receita: { porCfop: { 3101: 5000 } } },
  ]);
  assert.deepEqual([meses[0].industria, meses[0].devolucoes, meses[0].notas], [1000, 200, 1]);
});

test("repetidas: a mesma NF-e não conta duas vezes (banco, leitura, envio e portal)", () => {
  const mig = ler("supabase/migrations/202610290005_fiscal_notas_sem_repeticao.sql");
  assert.match(mig, /fiscal_ibscbs_notas_chave_unica on public\.fiscal_ibscbs_notas \(organization_id, chave\)\s+where chave is not null and repetida_de is null/);
  assert.match(mig, /fiscal_entradas_chave_unica/);
  assert.match(mig, /Este arquivo já foi anexado aqui/);
  for (const f of ["lib/fiscal/ibs-cbs/servidor.ts", "lib/fiscal/entradas/servidor.ts"]) assert.match(ler(f), /repetida_de: original/, f);
  for (const f of ["app/api/fiscal/apuracoes/route.ts", "app/api/fiscal/ibs-cbs/route.ts", "app/api/fiscal/entradas/route.ts", "lib/sara/agentes/fiscal.ts"]) assert.match(ler(f), /is\("repetida_de", null\)/, f);
  assert.match(ler("lib/documentos/guardar.ts"), /notaJaNaPlataforma: true/);
  assert.match(ler("app/api/fiscal/portal/anexo/route.ts"), /reaproveitado/);
  assert.match(ler("modules/fiscal/src/NotasEmitidas.tsx"), /<NotasDoMes /);
});

test("receita: 7501 (exportação de mercadoria recebida para exportar) é venda; 5501/6501 (a remessa) não", async () => {
  const { classificarCfop } = await import("../lib/contabil/apuracao/receita.ts");
  assert.equal(classificarCfop("7501"), "industria");
  assert.equal(classificarCfop("5501"), null);
  assert.equal(classificarCfop("6501"), null);
  const [m] = receitaPorMes([{ lado: "saida", competencia: "2026-01", receita: { porCfop: { 7101: 100, 7501: 50 } } }]);
  assert.deepEqual([m.industria, m.exportacao], [150, 150]);
});

test("portal: vários anexos, sem repetir a nota, excluir pelo lado que enviou e ver na própria plataforma", () => {
  const mig = ler("supabase/migrations/202610290006_fiscal_portal_anexo_excluir.sql");
  assert.match(mig, /create or replace function public\.fiscal_portal_anexo_excluir\(p_anexo uuid\)/);
  assert.match(mig, /if a\.lado <> lado then/, "só o lado que enviou");
  assert.match(mig, /situacao = 'fechada'/, "competência fechada não exclui");
  assert.match(mig, /fiscal_portal\.anexo_excluido/, "auditoria");
  const rota = ler("app/api/fiscal/portal/anexo/route.ts");
  assert.match(rota, /export async function DELETE/);
  assert.match(rota, /já está anexada aqui/, "mesma NF-e em outro arquivo");
  assert.match(rota, /lerIbsCbs\(admin/, "a nota anexada é lida na hora");
  const ver = ler("app/api/fiscal/portal/anexo/[id]/route.ts");
  assert.match(ver, /xml: "text\/plain; charset=utf-8"/, "XML vai como texto");
  assert.match(ver, /content-security-policy": "sandbox/, "nada do arquivo executa");
  const tela = ler("modules/fiscal/src/PortalEscritorio.tsx");
  assert.match(tela, /rotulo="Anexar arquivos" multiplo/);
  assert.match(tela, /useSoltarArquivo/);
  assert.match(tela, /<VisualizarArquivo /);
  assert.doesNotMatch(tela, /target="_blank"[^>]*>\s*<b>\{a\.nome\}/, "anexo não abre mais em outra aba");
});

test("portal: lixeira padrão da plataforma e NF-e aberta no DANFE", () => {
  const ds = ler("packages/design-system/components.tsx");
  assert.match(ds, /export function BotaoExcluir/, "botão de excluir no design system");
  const tela = ler("modules/fiscal/src/PortalEscritorio.tsx");
  assert.match(tela, /<BotaoExcluir rotulo=/);
  assert.doesNotMatch(tela, />×</, "sem o × solto");
  assert.match(tela, /danfe=\{\/\\\.xml\$\/i\.test\(aberto\.nome\)/);
  const vis = ler("app/components/visualizar-arquivo.tsx");
  assert.match(vis, /"danfe" \| "resumo" \| "xml"/);
  assert.match(ler("app/api/fiscal/portal/anexo/[id]/route.ts"), /obterTransmissor\(\)\.danfe/);
  const transmissor = ler("services/transmissor-nfe/servidor.mjs");
  assert.match(transmissor, /generatePDF\(false\)/, "DANFE sem a marca NFeWizard-io");
  assert.match(transmissor, /DANFE_INVALIDO/, "XML que não monta não derruba o serviço");
});

test("cancelamento: o XML do evento 110111 aceito pela SEFAZ tira a nota das apurações", () => {
  const ev = (tp, cStat) => `<?xml version="1.0"?><procEventoNFe versao="1.00"><evento><infEvento Id="ID${tp}${chave(10588)}01"><chNFe>${chave(10588)}</chNFe><dhEvento>2026-01-09T10:00:00-03:00</dhEvento><tpEvento>${tp}</tpEvento><nSeqEvento>1</nSeqEvento><detEvento><nProt>135260000000001</nProt><xJust>ERRO NO VALOR DO PEDIDO DO CLIENTE</xJust></detEvento></infEvento></evento><retEvento><infEvento><cStat>${cStat}</cStat><nProt>135260000000999</nProt></infEvento></retEvento></procEventoNFe>`;
  assert.deepEqual(cancelamentoDoXml(ev("110111", "135")), { chave: chave(10588), data: "2026-01-09T10:00:00-03:00", protocolo: "135260000000999", justificativa: "ERRO NO VALOR DO PEDIDO DO CLIENTE" });
  assert.ok(cancelamentoDoXml(ev("110112", "155")), "cancelamento por substituição fora de prazo também vale");
  assert.equal(cancelamentoDoXml(ev("110111", "573")), null, "rejeitado pela SEFAZ não cancela");
  assert.equal(cancelamentoDoXml(ev("110110", "135")), null, "carta de correção não cancela");
  assert.equal(cancelamentoDoXml(nfe()), null);
  const mig = ler("supabase/migrations/202610290008_fiscal_notas_canceladas.sql");
  assert.match(mig, /create trigger fiscal_dfe_eventos_cancelamento/);
  assert.match(mig, /create trigger fiscal_nfe_cancelada after update of situacao on public\.fiscal_nfe/);
  assert.match(mig, /before insert on public\.fiscal_ibscbs_notas/, "leitura de nota já cancelada entra marcada");
  for (const f of ["app/api/fiscal/apuracoes/route.ts", "app/api/fiscal/ibs-cbs/route.ts", "app/api/fiscal/entradas/route.ts", "lib/sara/agentes/fiscal.ts"]) assert.match(ler(f), /is\("cancelada_em", null\)/, f);
  assert.match(ler("lib/fiscal/ibs-cbs/servidor.ts"), /registrarSeCancelamento/);
});

test("notas recebidas: a busca e a ciência usam o ambiente próprio (produção); a emissão segue o dela", () => {
  const s = ler("lib/fiscal/servidor.ts");
  assert.match(s, /uso === "dfe" \? \(c\.dfe_ambiente \?\? c\.ambiente\) : c\.ambiente/);
  assert.equal((s.match(/credenciaisDaOrganizacao\(admin, org, (config|undefined), "dfe"\)/g) ?? []).length, 2, "rodada e ciência");
  assert.match(ler("supabase/migrations/202610290007_fiscal_dfe_ambiente.sql"), /dfe_ambiente text not null default 'producao'/);
});
