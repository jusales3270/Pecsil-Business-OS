import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acharPessoa, doVisual, nomeDoArquivo, textoParaConferir, validarDocumento } from "../lib/sara/documentos/documento.ts";
import { gerarPdf, limpar } from "../lib/sara/documentos/pdf.ts";
import { conferirNumeros } from "../lib/sara/central/verificador.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const MODULOS = ["financeiro", "compras", "rh"];
const barras = { componente: "barras", titulo: "Juros por contrato", origem: "contas_a_pagar", fonte: null, formato: "moeda", pontos: [{ rotulo: "FINAME", valor: 98000 }, { rotulo: "Giro", valor: 41000 }], total: 2 };

const relatorio = {
  tipo: "relatorio", titulo: "Comparação de financiamentos", resumo: "Cinco contratos somaram R$ 2.410.000,00.", areas: ["financeiro", "marte"],
  secoes: [
    { titulo: "Contratos", texto: "Taxa efetiva mensal.", tabela: { colunas: ["Contrato", "Taxa"], linhas: [["FINAME", "1,02%"], ["Giro", "2,15%"], ["incompleta"]] } },
    { titulo: "Juros", visual: 1 },
  ],
  insights: [{ texto: "O giro custou o dobro do FINAME.", confianca: "alta" }, { texto: "x" }],
  recomendacoes: ["Comparar o custo efetivo antes de contratar."], quem_decide: "Financeiro (Ana)",
};

test("documentos: valida o relatório e preenche o gráfico com o visual da área", () => {
  const v = validarDocumento(relatorio, [barras], MODULOS);
  assert.ok("documento" in v, JSON.stringify(v));
  const d = v.documento;
  assert.equal(d.tipo, "relatorio");
  assert.deepEqual(d.areas, ["financeiro"], "só módulos conhecidos");
  assert.deepEqual(d.secoes[0].tabela.linhas, [["FINAME", "1,02%"], ["Giro", "2,15%"]], "linha incompleta sai");
  assert.deepEqual(d.secoes[1].grafico, { tipo: "barras", titulo: "Juros por contrato", formato: "moeda", rotulos: ["FINAME", "Giro"], series: [{ nome: "Juros por contrato", valores: [98000, 41000] }] });
  assert.equal(d.insights.length, 1, "insight curto demais sai");
  const semVisual = validarDocumento({ ...relatorio, secoes: [{ titulo: "Juros", visual: 3 }] }, [barras], MODULOS);
  assert.match(semVisual.erro, /aponta para o visual 3, que não existe nesta conversa \(há 1\)/);
  assert.match(validarDocumento({ titulo: "x y z" }, [], MODULOS).erro, /Diga o tipo do documento/);
  assert.match(validarDocumento({ tipo: "relatorio", titulo: "Vazio", secoes: [] }, [], MODULOS).erro, /ao menos uma seção/);
});

test("documentos: carta precisa de destinatário e corpo, e sai sem análise da IA", () => {
  assert.match(validarDocumento({ tipo: "carta", titulo: "Convite", secoes: [{ texto: "Olá" }] }, [], MODULOS).erro, /destinatário/);
  assert.match(validarDocumento({ tipo: "carta", titulo: "Convite", destinatario: { nome: "Sr. Fulano" }, secoes: [{ titulo: "só título" }] }, [], MODULOS).erro, /corpo/);
  const v = validarDocumento({ tipo: "carta", titulo: "Convite", destinatario: { nome: "Sr. Fulano", empresa: "Cliente S.A." }, secoes: [{ texto: "Prezado..." }], insights: [{ texto: "opinião da IA aqui", confianca: "alta" }] }, [], MODULOS);
  assert.deepEqual(v.documento.insights, []);
  assert.equal(v.documento.destinatario.empresa, "Cliente S.A.");
});

test("documentos: o verificador confere o que o modelo escreveu (não o que veio do visual da área)", () => {
  const texto = textoParaConferir(relatorio);
  assert.match(texto, /R\$ 2\.410\.000,00/);
  assert.match(texto, /FINAME \| 1,02%/);
  assert.doesNotMatch(texto, /98\.000|98000/, "o visual é preenchido pela plataforma");
  const fontes = [{ area: "Financeiro", resposta: "Cinco contratos: total R$ 2.410.000,00; FINAME 1,02% a.m.; giro 2,15% a.m." }, barras];
  assert.deepEqual(conferirNumeros(texto, fontes).semFonte, []);
  const inventado = textoParaConferir({ ...relatorio, resumo: "Cinco contratos somaram R$ 2.900.000,00." });
  assert.deepEqual(conferirNumeros(inventado, fontes).semFonte, ["R$ 2.900.000,00"]);
});

test("documentos: acha quem recebe pelo nome falado; ambíguo ou inexistente pergunta", () => {
  const pessoas = [{ id: "1", nome: "Ana Claudia" }, { id: "2", nome: "Rosana" }, { id: "3", nome: "Ricardo Silva" }, { id: "4", nome: "Ricardo Souza" }];
  assert.equal(acharPessoa("Ana", pessoas).pessoa.id, "1");
  assert.equal(acharPessoa("para a Ana", pessoas).pessoa.id, "1");
  assert.equal(acharPessoa("rosana", pessoas).pessoa.id, "2");
  assert.equal(acharPessoa("Ricardo Silva", pessoas).pessoa.id, "3");
  assert.match(acharPessoa("Ricardo", pessoas).erro, /mais de uma pessoa: Ricardo Silva, Ricardo Souza/);
  assert.match(acharPessoa("Zé", pessoas).erro, /Não achei ninguém ativo/);
  assert.equal(nomeDoArquivo("DOC-2026-0007", "Juros: 2022/2026?"), "DOC-2026-0007 Juros 2022 2026.pdf");
  assert.equal(limpar("Relatório ✅ 📈 — ok **negrito**"), "Relatório — ok negrito");
});

const empresa = { razao_social: "EMPRESA EXEMPLO LTDA", nome_fantasia: "Exemplo", cnpj: "00.000.000/0001-00", municipio: "ITU", uf: "SP" };
async function textoDoPdf(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const d = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const paginas = [];
  for (let i = 1; i <= d.numPages; i++) paginas.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" "));
  return paginas;
}

test("documentos: o PDF do relatório tem o timbre, o número, a marca da IA nos insights e Página X de Y", async () => {
  const v = validarDocumento(relatorio, [barras], MODULOS);
  const pdf = await gerarPdf(v.documento, { numero: "DOC-2026-0001", empresa, logo: new Uint8Array(readFileSync(new URL("../public/logo-pecsil.png", import.meta.url))), quando: new Date("2026-10-23T12:00:00-03:00") });
  assert.ok(pdf.bytes.length > 10_000);
  const paginas = await textoDoPdf(pdf.bytes);
  assert.equal(paginas.length, pdf.paginas);
  const tudo = paginas.join(" ");
  assert.match(tudo, /EMPRESA EXEMPLO LTDA/);
  assert.match(tudo, /CNPJ 00\.000\.000\/0001-00/);
  assert.match(tudo, /Comparação de financiamentos/);
  assert.match(tudo, /Documento nº DOC-2026-0001 · emitido em 23\/10\/2026/);
  assert.match(tudo, /Análise da SARA \(IA\)/);
  assert.match(tudo, /confiança alta/);
  assert.match(tudo, /Documento interno · gerado pela SARA central/);
  paginas.forEach((p, i) => assert.match(p, new RegExp(`Página ${i + 1} de ${paginas.length}`), `rodapé da página ${i + 1}`));
});

test("documentos: a carta sai em papel timbrado, com local e data, sem marca de IA", async () => {
  const v = validarDocumento({ tipo: "carta", titulo: "Convite", assunto: "Visita técnica", destinatario: { nome: "Sr. Fulano", cargo: "Engenharia", empresa: "Cliente S.A." },
    secoes: [{ texto: "Prezado Sr. Fulano,\n\nConvidamos para uma visita." }], assinatura: { nome: "Júnior", cargo: "Diretor" } }, [], MODULOS);
  const pdf = await gerarPdf(v.documento, { numero: "DOC-2026-0002", empresa, logo: null, quando: new Date("2026-10-23T12:00:00-03:00") });
  const tudo = (await textoDoPdf(pdf.bytes)).join(" ");
  assert.match(tudo, /Itu, 23 de outubro de 2026/);
  assert.match(tudo, /Assunto: Visita técnica/);
  assert.match(tudo, /Atenciosamente/);
  assert.match(tudo, /Júnior/);
  assert.doesNotMatch(tudo, /SARA|\(IA\)|interno/, "documento externo sem marca de IA");
});

test("documentos: só a central cria e envia; as SARAs dos módulos só recebem", () => {
  const sessao = ler("lib/sara/sessao.ts");
  const central = sessao.slice(sessao.indexOf("if (sara.central) {"), sessao.indexOf("const dados = consultarDados"));
  assert.match(central, /ferramentaCriarDocumento\(documentos\), ENVIAR_DOCUMENTO\]/);
  const modulo = sessao.slice(sessao.indexOf("const dados = consultarDados"));
  assert.doesNotMatch(modulo, /ferramentaCriarDocumento|ENVIAR_DOCUMENTO/);
  assert.match(modulo, /MOSTRAR, DOCUMENTOS_RECEBIDOS\]/);
  const docs = ler("lib/sara/central/documentos.ts");
  assert.match(docs, /acao: \{\s*nivel: "operar", modulos: \["warroom"\]/, "enviar é ação com Permitir");
  assert.match(docs, /conferirNumeros\(textoParaConferir\(e\), ctx\.fontes\)/);
  const sql = ler("supabase/migrations/202610230006_sara_documentos.sql");
  assert.match(sql, /not public\.has_feature\('warroom\.sara'\) then\s*raise exception 'Só a SARA central cria documentos\.'/);
  assert.match(sql, /d\.criado_por is distinct from me then raise exception 'Só quem criou o documento envia\.'/);
  assert.match(sql, /insert into storage\.buckets \(id, name, public\) values \('sara-documentos', 'sara-documentos', false\)/);
  assert.match(sql, /revoke insert, update, delete on public\.sara_documentos, public\.sara_documento_envios from anon, authenticated/);
  assert.match(ler("app/api/sara/documentos/[id]/pdf/route.ts"), /session\.supabase\.from\("sara_documentos"\)\.select\("id, numero, titulo, caminho"\)\.eq\("id", id\)/, "quem pode abrir é o RLS");
  assert.match(ler("modules/event-catalog.ts"), /"sara\.documento\.enviado"/);
});
