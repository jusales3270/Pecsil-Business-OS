import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { lerFeed, lerSenado, lerDoeSp, lerSerieBcb, lerFeriados, textoDeHtml, dataDoFeed, chaveDoItem } = await import("../lib/contabil/sentinela/feeds.ts");
const { triar, temasCitados } = await import("../lib/contabil/sentinela/triagem.ts");
const { validarExtracao, trechoConfere } = await import("../lib/contabil/sentinela/extracao.ts");

test("lê RSS 1.0 (gov.br), RSS 2.0 e Atom e descarta as páginas de pasta e imagem", () => {
  const rdf = `<rdf:RDF><item rdf:about="https://www.gov.br/receitafederal/pt-br/assuntos/noticias/carrossel"><title>Carrossel</title><link>https://www.gov.br/receitafederal/pt-br/assuntos/noticias/carrossel</link></item>
  <item rdf:about="x"><title>Receita publica IN &amp; prazo</title><link>https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/outubro/in</link><description>Nos termos da &lt;b&gt;IN RFB nº 2.330&lt;/b&gt;</description><dc:date>2026-10-24T10:00:00-03:00</dc:date></item></rdf:RDF>`;
  const a = lerFeed(rdf);
  assert.equal(a.length, 1);
  assert.equal(a[0].titulo, "Receita publica IN & prazo");
  assert.match(a[0].resumo, /IN RFB nº 2\.330/);
  assert.equal(a[0].data, "2026-10-24T13:00:00.000Z");
  const rss = `<rss><channel><item><title><![CDATA[STF decide tema]]></title><link>https://noticias.stf.jus.br/x</link><pubDate>Tue, 21 Oct 2026 18:00:00 -0300</pubDate><description>Texto</description></item></channel></rss>`;
  assert.equal(lerFeed(rss)[0].titulo, "STF decide tema");
  const atom = `<feed><entry><title>Nota orientativa S-1.3</title><link rel="alternate" href="https://www.gov.br/esocial/x"/><updated>2026-10-20T12:00:00Z</updated><summary>texto</summary></entry></feed>`;
  assert.equal(lerFeed(atom)[0].url, "https://www.gov.br/esocial/x");
  assert.equal(dataDoFeed("Sex, out 23 2026"), "2026-10-23T15:00:00.000Z", "data do STJ em português");
  assert.equal(dataDoFeed("12/08/2026"), "2026-08-12T15:00:00.000Z", "data brasileira: 12 de agosto, não 8 de dezembro");
  const pdf = `<rdf:RDF><item rdf:about="x"><title>Nota orientativa S-1.3 12/2026</title><link>https://www.gov.br/esocial/pt-br/documentacao-tecnica/manuais/nota-orientativa-s-1-3-12-2026.pdf/view</link></item></rdf:RDF>`;
  assert.equal(lerFeed(pdf).length, 1, "o PDF publicado (…pdf/view) é item, não ruído");
  assert.equal(textoDeHtml("<p>A&nbsp;b</p><script>x()</script>"), "A b");
  assert.equal(chaveDoItem("rfb", { url: "https://x.gov.br/a/?utm=1", titulo: " Título  Novo " }), "rfb|https://x.gov.br/a|título novo");
});

test("Senado, Diário Oficial de SP (sem autuação de terceiros), Banco Central e feriados", () => {
  const sen = { ListaDocumento: { documentos: { documento: [{ id: "44095919", norma: "LEI-15526-2026-09-29", normaNome: "Lei nº 15.526 de 29/09/2026", ementa: "Altera...", dataassinatura: "29/09/2026" }] } } };
  assert.deepEqual(lerSenado(sen).map((i) => [i.titulo, i.url]), [["Lei nº 15.526 de 29/09/2026", "https://legis.senado.leg.br/norma/44095919"]]);
  const doe = { items: [
    { title: "COMUNICADO Nº 062, DE 19 DE OUTUBRO DE 2026", slug: "a", date: "2026-10-20T01:02:20.59", excerpt: "NOTIFICAÇÃO – AIIM ICMS Contribuinte: FULANO I.E. : 1 CNPJ/CPF: 13.106.271/0001-78", hierarchy: "Executivo > Secretaria da Fazenda e Planejamento" },
    { title: "PORTARIA SRE Nº 2, DE 2025", slug: "b", date: "2025-06-30T01:00:00", excerpt: "Dispõe sobre a eliminação da GIA", hierarchy: "Executivo > Secretaria da Fazenda e Planejamento > Subsecretaria da Receita Estadual" },
    { title: "RESOLUÇÃO SS Nº 9", slug: "c", date: "2026-10-20T01:00:00", excerpt: "Saúde", hierarchy: "Executivo > Secretaria da Saúde" },
  ] };
  const lidos = lerDoeSp(doe);
  assert.equal(lidos.length, 1, "só o ato normativo da Fazenda; a autuação com CNPJ e a resolução da Saúde ficam fora");
  assert.match(lidos[0].titulo, /^PORTARIA SRE/);
  assert.deepEqual(lerSerieBcb([{ data: "01/10/2026", valor: "0.82" }, { data: "x", valor: "1" }]), [{ competencia: "2026-10", valor: 0.82 }]);
  assert.deepEqual(lerFeriados([{ date: "2027-01-01", name: "Confraternização mundial", type: "national" }]), [{ data: "2027-01-01", nome: "Confraternização mundial" }]);
});

const TESES = [
  { id: "t118", tribunal: "STF", tema: "118", situacao: "firmada_modulacao_pendente" },
  { id: "t1390", tribunal: "STJ", tema: "1390", situacao: "firmada_modulacao_pendente" },
  { id: "t1372", tribunal: "STJ", tema: "1372", situacao: "firmada" },
  { id: "t1364", tribunal: "STJ", tema: "1364", situacao: "firmada" },
];

// Regressão (PLANO-CONTABIL-FISCAL §4.4): as mudanças reais de 2026 têm de cair no parâmetro ou na tese certa.
const MUDANCAS_2026 = [
  { titulo: "Decreto nº 12.797, de 23 de dezembro de 2025", resumo: "Regulamenta a Lei nº 14.663, de 2023, que dispõe sobre o valor do salário mínimo e a sua política de valorização.", nivel: "fonte_oficial", chave: "salario_minimo" },
  { titulo: "Publicada a Portaria Interministerial MPS/MF nº 13, de 9/01/2026, que dispõe sobre o reajuste dos benefícios pagos pelo INSS", resumo: "Estabelece a tabela de contribuição dos segurados empregado, doméstico e avulso.", nivel: "fonte_oficial", chave: "inss_segurado_tabela" },
  { titulo: "Lei nº 15.270, de 26/11/2025", resumo: "Altera a legislação do imposto sobre a renda das pessoas físicas, institui redução do imposto e a tributação mínima.", nivel: "fonte_oficial", chave: "irrf_reducao_lei_15270" },
  { titulo: "Lei Complementar nº 224, de 26/12/2025", resumo: "Reduz benefícios fiscais e eleva os percentuais de presunção do lucro presumido.", nivel: "fonte_oficial", chave: "lucro_presumido_percentuais" },
  { titulo: "Contribuintes ganham mais tempo para entregar a DCTFWeb", resumo: "A Instrução Normativa RFB nº 2.248/2025 altera o prazo de entrega.", nivel: "fonte_oficial", chave: "prazo_dctfweb" },
  { titulo: "PORTARIA SRE Nº 2, DE 2025", resumo: "Dispõe sobre a eliminação da GIA e a EFD ICMS/IPI.", nivel: "fonte_oficial", chave: "gia_sp" },
  { titulo: "Receita Federal e CGIBS publicam cronograma dos documentos fiscais eletrônicos com IBS e CBS", resumo: "Ato Conjunto RFB/CGIBS nº 4/2026.", nivel: "fonte_oficial", chave: "reforma_2026_fase_teste" },
  { titulo: "Publicada a NT 2025.002 versão 1.52", resumo: "Nota Técnica da Reforma Tributária do Consumo: grupos IBS e CBS na NF-e.", nivel: "fonte_oficial", chave: "reforma_2026_fase_teste" },
  { titulo: "Resolução CGIBS nº 14/2026 estima a alíquota de referência", resumo: "Comitê Gestor do IBS divulga parâmetro de 27,91%.", nivel: "fonte_oficial", chave: "reforma_aliquota_referencia" },
  { titulo: "Fator Acidentário de Prevenção (FAP) com vigência para 2027 está disponível para consulta", resumo: "Portaria Interministerial MPS/MF nº 16/2026.", nivel: "fonte_oficial", chave: "fap_vigencia_2027" },
  { titulo: "Repetitivo afasta teto de 20 salários mínimos para base de cálculo das contribuições parafiscais", resumo: "A Primeira Seção do STJ fixou a tese do Tema 1.390.", nivel: "tribunal", tribunal: "STJ", chave: "terceiros_base_calculo", tese: "t1390" },
  { titulo: "ICMS-DIFAL não compõe a base do PIS e da Cofins, decide STJ", resumo: "Tema repetitivo 1372.", nivel: "tribunal", tribunal: "STJ", chave: "pis_cofins_aliquotas", tese: "t1372" },
  { titulo: "STJ veda crédito de PIS e Cofins sobre ICMS das compras", resumo: "No Tema 1.364, a Primeira Seção decidiu por unanimidade.", nivel: "tribunal", tribunal: "STJ", tese: "t1364" },
  { titulo: "ISS não integra a base de cálculo do PIS e da Cofins, decide STF", resumo: "Julgamento do Tema 118 da repercussão geral; modulação fica para os embargos.", nivel: "tribunal", tribunal: "STF", tese: "t118" },
];

for (const m of MUDANCAS_2026) {
  test(`regressão 2026: "${m.titulo.slice(0, 60)}…"`, () => {
    const t = triar(m, m.nivel, { teses: TESES, tribunal: m.tribunal ?? null });
    assert.ok(t.relevante, `deveria ser relevante (${t.motivos.join("; ")})`);
    if (m.chave) assert.ok(t.chaves.includes(m.chave), `deveria apontar ${m.chave}; apontou ${t.chaves.join(", ")}`);
    if (m.tese) assert.ok(t.teses.includes(m.tese), `deveria apontar a tese ${m.tese}`);
  });
}

test("passa batido o que não é da empresa", () => {
  const fora = [
    { titulo: "Receita Federal disponibilizará a versão web da DITR 2026", resumo: "Declaração do Imposto sobre a Propriedade Territorial Rural.", nivel: "fonte_oficial" },
    { titulo: "STF valida lei estadual sobre transporte escolar", resumo: "O Plenário julgou a ação direta.", nivel: "tribunal", tribunal: "STF" },
    { titulo: "Receita Federal informa parada programada do sistema de leilão eletrônico", resumo: "Manutenção.", nivel: "fonte_oficial" },
    { titulo: "Cinco dicas para organizar a contabilidade da sua empresa", resumo: "O imposto de renda pode pesar.", nivel: "imprensa" },
    // Falsos positivos vistos na primeira coleta real (25/10/2026):
    { titulo: "RESOLUÇÃO 78/26", resumo: "Indica membros para o Comitê Gestor da Política Nacional de Repressão ao Furto e Roubo de Veículos e Cargas.", nivel: "fonte_oficial" },
    { titulo: "PORTARIA Nº 096/2026-DIFIS (Diretoria de Fiscalização)", resumo: "Atribui quotas de prêmio de produtividade a servidor que participou do Comitê de encontro nacional.", nivel: "fonte_oficial" },
  ];
  for (const f of fora) assert.equal(triar(f, f.nivel, { teses: TESES, tribunal: f.tribunal ?? null }).relevante, false, f.titulo);
  assert.deepEqual(temasCitados("Tema nº 1.390 e Tema Repetitivo 1416; Temas 69"), ["1390", "1416", "69"]);
});

const TEXTO = "Fica estabelecido que, a partir de 1º de janeiro de 2027, o salário mínimo será de R$ 1.700,00 (mil e setecentos reais).";
const CAND = [{ chave: "salario_minimo", titulo: "Salário mínimo nacional", valor: { mensal: 1621, diario: 54.04, hora: 7.37 } }];

test("extração: com trecho que existe no texto e mesmo formato, a proposta vale", () => {
  const e = validarExtracao({ muda_regra: true, tipo: "parametro", chave: "salario_minimo", resumo: "Novo mínimo", vigente_de: "2027-01-01", norma: "Decreto X", trecho: "a partir de 1º de janeiro de 2027, o salário mínimo será de R$ 1.700,00", confianca: "alta", valor_proposto: { mensal: 1700 } }, TEXTO, CAND, []);
  assert.equal(e.tipo, "parametro");
  assert.equal(e.confianca, "alta");
  assert.deepEqual(e.valorProposto, { mensal: 1700, diario: 54.04, hora: 7.37 }, "mantém as chaves do atual e troca só o que o texto muda");
  assert.equal(e.vigenteDe, "2027-01-01");
});

test("extração: trecho inventado derruba a confiança e descarta o valor; chave fora da lista vira sinal", () => {
  const inventado = validarExtracao({ muda_regra: true, tipo: "parametro", chave: "salario_minimo", resumo: "x", trecho: "o salário mínimo será de R$ 2.000,00", confianca: "alta", valor_proposto: { mensal: 2000 } }, TEXTO, CAND, []);
  assert.equal(inventado.confianca, "baixa");
  assert.equal(inventado.valorProposto, null);
  assert.ok(inventado.avisos.some((a) => /não está no texto/.test(a)));
  const formato = validarExtracao({ muda_regra: true, tipo: "parametro", chave: "salario_minimo", resumo: "x", trecho: "o salário mínimo será de R$ 1.700,00", confianca: "alta", valor_proposto: { valor_novo: 1700 } }, TEXTO, CAND, []);
  assert.equal(formato.valorProposto, null, "formato diferente do atual é descartado");
  const fora = validarExtracao({ muda_regra: true, tipo: "parametro", chave: "fgts", resumo: "x", confianca: "alta" }, TEXTO, CAND, []);
  assert.equal(fora.tipo, "sinal");
  assert.equal(fora.chave, null);
  assert.ok(trechoConfere("salario minimo sera de r$ 1.700,00", TEXTO), "sem acento e caixa também confere");
});
