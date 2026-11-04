import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import "./ts-resolver.mjs";
import { zipPequeno } from "./helpers/zip-fixture.mjs";
const { abrirZip, ZipInvalido } = await import("../lib/leitura/zip.ts");
const { lerTexto } = await import("../lib/leitura/texto.ts");
const { lerXlsx } = await import("../lib/arquivos/xlsx.ts");

const fixture = (nome) => new Uint8Array(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url)));
const falhaSegura = (e) => e instanceof ZipInvalido && /limite|inválido|corrompid|compactar/.test(e.message);

test("ZIP: DOCX e XLSX reais continuam legíveis nos dois leitores", async () => {
  const word = await lerTexto(fixture("cotacao-ficticia.docx"));
  assert.equal(word.status, "lido");
  assert.match(word.texto, /Fornecedor Fictício & Cia/);
  const planilha = fixture("extrato-santander-ficticio.xlsx");
  const texto = await lerTexto(planilha);
  assert.equal(texto.status, "lido");
  const valores = lerXlsx(Buffer.from(planilha)).flat().filter((c) => typeof c === "string" && c.trim().length > 3);
  assert.ok(valores.length > 3);
  for (const v of valores.slice(0, 10)) assert.ok(texto.texto.includes(v.trim()), v);
});

test("ZIP: conta bytes emitidos antes de decode mesmo com tamanho falso no diretório", async () => {
  const dados = zipPequeno([{ nome: "word/document.xml", texto: "X".repeat(1_024), declarado: 100 }]);
  const decoder = TextDecoder.prototype.decode;
  const tamanhos = [];
  TextDecoder.prototype.decode = function (input, ...opcoes) { tamanhos.push(input?.byteLength ?? 0); return decoder.call(this, input, ...opcoes); };
  try {
    const zip = abrirZip(dados, { entrada: 128, expandido: 256 });
    await assert.rejects(zip.ler("word/document.xml"), falhaSegura);
    assert.ok(tamanhos.every((n) => n <= 128), "nenhuma string é criada com o conteúdo expandido acima do limite");
  } finally { TextDecoder.prototype.decode = decoder; }
});

test("ZIP: limita entrada declarada, soma, razão, quantidade e prazo", async () => {
  const um = zipPequeno([{ nome: "a", texto: "X".repeat(128) }]);
  assert.throws(() => abrirZip(um, { entrada: 64 }), falhaSegura);
  assert.throws(() => abrirZip(um, { razao: 2 }), falhaSegura);
  const dois = zipPequeno([{ nome: "a", texto: "a".repeat(40) }, { nome: "b", texto: "b".repeat(40) }]);
  assert.throws(() => abrirZip(dois, { expandido: 64 }), falhaSegura);
  assert.throws(() => abrirZip(dois, { entradas: 1 }), falhaSegura);
  const zip = abrirZip(um, { prazoMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(zip.ler("a"), falhaSegura);
});

test("ZIP: orçamento real acumulado também vale para releituras e entradas sem compressão", async () => {
  const zip = abrirZip(zipPequeno([{ nome: "a", texto: "a".repeat(40), metodo: 0 }]), { expandido: 64 });
  assert.equal((await zip.ler("a")).length, 40);
  await assert.rejects(zip.ler("a"), falhaSegura);
});

test("ZIP: corrupção, nomes duplicados e cabeçalho local fora do arquivo viram erro seguro", () => {
  const dados = zipPequeno([{ nome: "a", texto: "abc" }]);
  for (const n of [0, 5, 21, dados.length - 1]) assert.throws(() => abrirZip(dados.subarray(0, n)), ZipInvalido);
  assert.throws(() => abrirZip(zipPequeno([{ nome: "a", texto: "abc" }, { nome: "a", texto: "def" }])), ZipInvalido);
  const corrompido = Buffer.from(dados); corrompido.writeUInt32LE(0xffffff00, dados.length - 22 - 47 + 42);
  assert.throws(() => abrirZip(corrompido), ZipInvalido);
});

test("XLSX síncrono: teto nativo impede expansão com cabeçalho falso", () => {
  const dados = zipPequeno([{ nome: "xl/workbook.xml", texto: "X".repeat(1_024), declarado: 100 }]);
  assert.throws(() => lerXlsx(dados, { entrada: 128, expandido: 256 }), falhaSegura);
});

test("XLSX: índices de linha/coluna não podem criar matrizes gigantes", () => {
  const base = [{ nome: "xl/workbook.xml", texto: '<workbook><sheet r:id="1"/></workbook>' }];
  const linha = zipPequeno([...base, { nome: "xl/worksheets/sheet1.xml", texto: '<row r="4294967295"><c r="A1"><v>1</v></c></row>' }]);
  assert.throws(() => lerXlsx(linha), /limite de linhas/);
  const coluna = zipPequeno([...base, { nome: "xl/worksheets/sheet1.xml", texto: '<row r="1"><c r="ZZZZZZ1"><v>1</v></c></row>' }]);
  assert.throws(() => lerXlsx(coluna), /colunas/);
});

test("leitura: expansão exagerada termina sem texto e sem encaminhar para OCR", async () => {
  const dados = zipPequeno([{ nome: "word/document.xml", texto: "X".repeat(16_384) }]);
  // Metadados declaram expansão maior que o teto, sem criar arquivos enormes no teste.
  const central = dados.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); dados.writeUInt32LE(32_000_001, central + 24);
  const leitura = await lerTexto(dados);
  assert.equal(leitura.status, "sem_texto"); assert.equal(leitura.ocr, false);
  assert.match(leitura.motivo, /limites de leitura segura/);
});


test("XML: DOCX/XLSX malformados não bloqueiam o processo (prazo externo independente)", () => {
  const fonte = `
    import assert from "node:assert/strict";
    import { lerTexto } from ${JSON.stringify(new URL("../lib/leitura/texto.ts", import.meta.url).href)};
    import { lerXlsx } from ${JSON.stringify(new URL("../lib/arquivos/xlsx.ts", import.meta.url).href)};
    import { zipPequeno } from ${JSON.stringify(new URL("./helpers/zip-fixture.mjs", import.meta.url).href)};
    const workbook = {nome: "xl/workbook.xml", texto: '<workbook><sheet r:id="rId1"/></workbook>'};
    const folha = {nome: "xl/worksheets/sheet1.xml", texto: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>texto normal</t></is></c></row></sheetData></worksheet>'};
    let casos = 0;
    for (const xml of ["<w:p>".repeat(120000), "<w:p ".repeat(120000), '<w:p><w:t>' + '<'.repeat(120000) + '</w:t></w:p>']) {
      const zip = zipPequeno([{nome: "word/document.xml", texto: xml}]);
      const r = await lerTexto(zip);
      assert.equal(r.status, "sem_texto"); assert.equal(r.ocr, false); casos++;
    }
    for (const xml of ["<si>".repeat(120000), '<si>' + '<t>'.repeat(120000) + '</si>']) {
      const zip = zipPequeno([workbook, folha, {nome: "xl/sharedStrings.xml", texto: xml}]);
      assert.equal((await lerTexto(zip)).status, "sem_texto");
      assert.throws(() => lerXlsx(zip)); casos++;
    }
    for (const xml of ["<row>".repeat(120000), "<row ".repeat(120000), '<worksheet><sheetData><row><c>'.repeat(30000)]) {
      const zip = zipPequeno([workbook, {nome: folha.nome, texto: xml}]);
      assert.equal((await lerTexto(zip)).status, "sem_texto");
      assert.throws(() => lerXlsx(zip)); casos++;
    }
    for (const extra of [
      {nome: workbook.nome, texto: '<sheet '.repeat(120000)},
      {nome: 'xl/_rels/workbook.xml.rels', texto: '<Relationship '.repeat(80000)},
    ]) {
      const zip = zipPequeno([...(extra.nome === workbook.nome ? [] : [workbook]), folha, extra]);
      assert.throws(() => lerXlsx(zip)); casos++;
    }
    const espacos = ' '.repeat(600000) + 'fim';
    const txt = await lerTexto(new TextEncoder().encode(espacos));
    assert.equal(txt.status, 'lido'); assert.equal(txt.texto, 'fim'); casos++;
    const docxEspacos = await lerTexto(zipPequeno([{nome: 'word/document.xml', texto: '<w:p><w:r><w:t>' + espacos + '</w:t></w:r></w:p>'}]));
    assert.equal(docxEspacos.status, 'lido'); assert.equal(docxEspacos.texto, 'fim'); casos++;
    console.log(JSON.stringify({casos}));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", fonte], { encoding: "utf8", timeout: 5_000 });
  assert.equal(r.error, undefined, `scanner excedeu prazo externo: ${r.error?.message}`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { casos: 12 });
});

test("XML: dimensões são validadas sem alocar matrizes e referências extremas são recusadas", async () => {
  const montar = (dimensao, ref = "A1") => zipPequeno([
    { nome: "xl/workbook.xml", texto: '<workbook><sheet r:id="1"/></workbook>' },
    { nome: "xl/worksheets/sheet1.xml", texto: `<worksheet><dimension ref="${dimensao}"/><sheetData><row r="1"><c r="${ref}" t="inlineStr"><is><t>célula real</t></is></c></row></sheetData></worksheet>` },
  ]);
  const normal = montar("A1:XFD1048576");
  assert.deepEqual(lerXlsx(normal), [["célula real"]], "dimensão máxima do Excel não define tamanho da matriz");
  assert.equal((await lerTexto(normal)).texto, "célula real");
  for (const dados of [montar("A1:ZZZZ9999999999"), montar("B2:A1"), montar("A1", "ZZZZZZ1"), montar("A1", "A99999999")]) {
    assert.throws(() => lerXlsx(dados));
    const l = await lerTexto(dados); assert.equal(l.status, "sem_texto"); assert.equal(l.ocr, false);
  }
});

test("XML: prazo e orçamento de tags abrangem parsing síncrono", async () => {
  const { elementosXml, orcamentoXml, XmlInvalido } = await import("../lib/leitura/xml.ts");
  let agora = 0;
  const prazo = orcamentoXml({ prazoMs: 2, agora: () => agora });
  const iterador = elementosXml('<root><p>texto</p><p>segundo</p></root>', "p", prazo);
  assert.equal(iterador.next().value.conteudo, "texto"); agora = 3;
  assert.throws(() => iterador.next(), XmlInvalido);
  assert.throws(() => [...elementosXml('<root><p>a</p><p>b</p></root>', "p", orcamentoXml({ elementos: 3 }))], XmlInvalido);
  assert.throws(() => [...elementosXml('<root><a><b>texto</b></a></root>', "a", orcamentoXml({ profundidade: 2 }))], XmlInvalido);
});


test("XML: DOCX com caixa de texto aninhada e entidades longas preserva conteúdo sem duplicar", async () => {
  const word = zipPequeno([{ nome: "word/document.xml", texto: '<w:document><w:body><w:p><w:r><w:t>Antes </w:t></w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Caixa</w:t></w:r></w:p></w:txbxContent></w:drawing><w:r><w:t> Depois</w:t></w:r></w:p></w:body></w:document>' }]);
  assert.equal((await lerTexto(word)).texto, "Antes Caixa Depois");
  const xml = '&amp;'.repeat(8_000);
  const planilha = zipPequeno([
    { nome: "xl/workbook.xml", texto: '<workbook><sheet r:id="1"/></workbook>' },
    { nome: "xl/worksheets/sheet1.xml", texto: `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${xml}</t></is></c></row></sheetData></worksheet>` },
  ]);
  assert.deepEqual(lerXlsx(planilha), [["&".repeat(8_000)]]);
  assert.equal((await lerTexto(planilha)).texto, "&".repeat(8_000));
});
