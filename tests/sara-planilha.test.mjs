import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import { coluna, gerarXlsx, nomesDeAbas, serialDaData } from "../lib/sara/documentos/xlsx.ts";
import { abaDoVisual, montarPlanilha, visualDaTela } from "../lib/sara/documentos/planilha.ts";
import { arquivoDoTipo, nomeDoArquivo } from "../lib/sara/documentos/documento.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

/** Lê um arquivo de dentro do zip (o .xlsx), pelo diretório central. */
function doZip(bytes, nome) {
  const b = Buffer.from(bytes);
  const fim = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = b.readUInt32LE(fim + 16);
  for (let i = 0; i < b.readUInt16LE(fim + 10); i++) {
    const n = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), coment = b.readUInt16LE(p + 32);
    const arquivo = b.subarray(p + 46, p + 46 + n).toString("utf8");
    if (arquivo === nome) {
      const local = b.readUInt32LE(p + 42), tamanho = b.readUInt32LE(p + 20);
      const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      return inflateRawSync(b.subarray(ini, ini + tamanho)).toString("utf8");
    }
    p += 46 + n + extra + coment;
  }
  return null;
}

const tabela = { componente: "tabela", titulo: "Contas a pagar", origem: "contas_a_pagar", fonte: null, total: 2,
  colunas: [{ rotulo: "Fornecedor", formato: "texto" }, { rotulo: "Vencimento", formato: "data" }, { rotulo: "Valor", formato: "moeda" }],
  linhas: [["OTZI <&> METALS", "2026-11-12", 86028.5], ["MIRAI", "2026-11-14", 37344]] };

test("planilha: colunas, datas e nomes de aba no formato do Excel", () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(coluna), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  assert.equal(serialDaData("2026-11-10"), 46336);
  assert.equal(serialDaData("1900-03-01"), 61);
  assert.equal(serialDaData("ontem"), null);
  assert.deepEqual(nomesDeAbas(["Caixa: resumo [hoje]", "Caixa resumo hoje", "", "x".repeat(40)]), ["Caixa resumo hoje", "Caixa resumo hoje 2", "Aba 3", "x".repeat(31)]);
});

test("planilha: número continua número (moeda, data), texto escapado, cabeçalho e filtro", () => {
  const bytes = gerarXlsx([abaDoVisual(tabela)], "DOC-2026-0001 Teste");
  assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), "PK");
  const folha = doZip(bytes, "xl/worksheets/sheet1.xml");
  assert.match(folha, /<c r="C2" s="2"><v>86028.5<\/v><\/c>/, "moeda: número com o estilo de reais");
  assert.match(folha, /<c r="B2" s="5"><v>46338<\/v><\/c>/, "data: número de série com o estilo de data");
  assert.match(folha, /OTZI &lt;&amp;&gt; METALS/);
  assert.match(folha, /<c r="A1" t="inlineStr" s="1">/, "cabeçalho em negrito");
  assert.match(folha, /state="frozen"/);
  assert.match(folha, /<autoFilter ref="A1:C3"\/>/);
  assert.match(doZip(bytes, "xl/styles.xml"), /<cellStyle name="Normal" xfId="0" builtinId="0"\/>/);
  assert.match(doZip(bytes, "docProps/core.xml"), /DOC-2026-0001 Teste/);
});

test("planilha: cada visual vira uma aba (indicadores com o formato de cada um, gráficos como nome e valor)", () => {
  const ind = abaDoVisual({ componente: "indicadores", titulo: "Caixa", origem: "x", fonte: null, itens: [{ rotulo: "Saldo", valor: 10.5, formato: "moeda" }, { rotulo: "Vencidos", valor: 411, formato: "numero" }] });
  assert.deepEqual(ind.linhas, [["Saldo", 10.5], ["Vencidos", 411]]);
  assert.deepEqual(ind.formatos, [["texto", "moeda"], ["texto", "numero"]]);
  const barras = abaDoVisual({ componente: "barras", titulo: "OS atrasadas", origem: "x", fonte: null, formato: "numero", campoRotulo: "cliente", pontos: [{ rotulo: "PARGLASS", valor: 9 }], total: 1 }, "Atrasos");
  assert.equal(barras.nome, "Atrasos");
  assert.deepEqual(barras.colunas.map((c) => c.rotulo), ["Cliente", "OS atrasadas"]);
  const datas = abaDoVisual({ componente: "lista_de_datas", titulo: "Vencimentos", origem: "x", fonte: null, formato: "moeda", itens: [{ data: "2026-11-20", rotulo: "Itaú", valor: 500 }], total: 1 });
  assert.deepEqual(datas.colunas.map((c) => c.formato), ["data", "texto", "moeda"]);
});

test("planilha da SARA central: só visuais desta conversa, pelo número que a plataforma deu", () => {
  assert.deepEqual(montarPlanilha({ titulo: "Contas", abas: [{ visual: 2 }] }, [tabela]), { erro: "Visual 2 não existe nesta conversa (há 1). Peça às áreas a tabela ou o gráfico (ou monte com mostrar) e use o número que a plataforma devolveu." });
  assert.ok("erro" in montarPlanilha({ titulo: "x", abas: [{ visual: 1 }] }, [tabela]), "título curto demais");
  assert.ok("erro" in montarPlanilha({ titulo: "Contas", abas: [] }, [tabela]));
  const ok = montarPlanilha({ titulo: "Contas da semana", abas: [{ visual: 1, nome: "Pagar" }] }, [tabela]);
  assert.equal(ok.abas[0].nome, "Pagar");
  assert.deepEqual(ok.abas[0].linhas, tabela.linhas, "as linhas são as da plataforma");
});

test("Baixar em Excel: só o formato de visual da plataforma, com limite e sem objeto estranho nas células", () => {
  assert.equal(visualDaTela({ componente: "qualquer" }), null);
  assert.equal(visualDaTela(null), null);
  const v = visualDaTela({ componente: "tabela", titulo: "T", colunas: [{ rotulo: "A", formato: "moeda" }], linhas: [[{ x: 1 }, 2], [5]], origem: "o" });
  assert.deepEqual(v.linhas, [[null], [5]]);
  const muitas = visualDaTela({ componente: "tabela", titulo: "T", colunas: [{ rotulo: "A" }], linhas: Array.from({ length: 5000 }, (_, i) => [i]) });
  assert.equal(muitas.linhas.length, 2000);
});

test("planilha: tipo, extensão e envio (plataforma e WhatsApp) com o arquivo certo", () => {
  assert.deepEqual(arquivoDoTipo("planilha"), { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" });
  assert.equal(arquivoDoTipo("relatorio").ext, "pdf");
  assert.equal(nomeDoArquivo("DOC-2026-0030", "Contas: novembro", "planilha"), "DOC-2026-0030 Contas novembro.xlsx");
  assert.equal(nomeDoArquivo("DOC-2026-0030", "Relatório"), "DOC-2026-0030 Relatório.pdf");
  assert.match(ler("lib/whatsapp/enviar.ts"), /enviarDocumento\(d\.instancia, d\.numero, base64, `\$\{nome\}\.\$\{arq\.ext\}`, doc\.titulo, arq\.mime\)/);
  assert.match(ler("lib/whatsapp/agendados.ts"), /arquivoDoTipo\(doc\.tipo\)\.mime/);
  assert.match(ler("lib/whatsapp/evolution.ts"), /mediatype: "document", mimetype, media: base64/);
  assert.match(ler("supabase/migrations/202611100001_sara_planilha.sql"), /'relatorio', 'carta', 'mensagem_voz', 'planilha'/);
  assert.match(ler("app/api/sara/documentos/route.ts"), /\["relatorio", "carta", "planilha"\]/);
});

test("visuais numerados: a central e as áreas devolvem o número; o documento e a planilha apontam por ele", () => {
  assert.match(ler("lib/sara/laco.ts"), /numero_do_visual: numero/);
  assert.match(ler("lib/sara/central/subagente.ts"), /visuais_numerados: numerados/);
  assert.match(ler("lib/sara/responder.ts"), /aoMostrar: p\.documentos\?\.numerar/);
  const sessao = ler("lib/sara/sessao.ts");
  assert.match(sessao, /ferramentaCriarPlanilha\(documentos\)/);
  assert.match(sessao, /numerar: \(v\) => \{ numerados\.push\(v\); return numerados\.length; \}/);
});
