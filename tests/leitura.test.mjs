import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { lerTexto } = await import("../lib/leitura/texto.ts");
const { classificarConteudo, temChaveDeAcesso, contarCpfs } = await import("../lib/leitura/conteudo.ts");
const { combinar } = await import("../lib/coleta/triagem.ts");
const { tipoDoArquivo } = await import("../lib/arquivos/detectar.ts");
const { lerXlsx } = await import("../lib/arquivos/xlsx.ts");
const { textoDoPdf, linhasDoPdf } = await import("../lib/arquivos/pdf-texto.ts");
const { imagensDoPdf, ocr } = await import("../lib/leitura/ocr.ts");
const { pngDe } = await import("../lib/leitura/png.ts");

const fixture = (nome) => new Uint8Array(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url)));
// O mesmo extrator de PDF do servidor (lib/leitura/servidor.ts, que é server-only).
const pdf = async (dados) => (await textoDoPdf(dados.slice(), 400)).map((p) => linhasDoPdf(p).map((l) => l.map((i) => i.s).join(" ")).join("\n"));

test("leitura: Word (.docx) pelo conteúdo, com acentos e entidades", async () => {
  const dados = fixture("cotacao-ficticia.docx");
  assert.equal(tipoDoArquivo(dados), "docx");
  const l = await lerTexto(dados);
  assert.equal(l.status, "lido");
  assert.equal(l.metodo, "docx");
  assert.match(l.texto, /Cotação nº 9876/);
  assert.match(l.texto, /Orçamento de ferro molibdênio/);
  assert.match(l.texto, /Fornecedor Fictício & Cia/);
  assert.equal(classificarConteudo(l.texto).setor, "compras");
});

test("leitura: Excel (.xlsx) com o zip universal traz o mesmo que o leitor do servidor", async () => {
  const dados = fixture("extrato-santander-ficticio.xlsx");
  const l = await lerTexto(dados);
  assert.equal(l.status, "lido");
  const celulas = lerXlsx(Buffer.from(dados)).flat().filter((c) => typeof c === "string" && c.trim().length > 3);
  assert.ok(celulas.length > 3);
  for (const c of celulas.slice(0, 10)) assert.ok(l.texto.includes(c.trim()), c);
});

test("leitura: PDF com texto (DANFE) vai para o Fiscal pela chave de acesso; holerite com nome genérico vira RH", async () => {
  const danfe = await lerTexto(fixture("danfe-texto-ficticio.pdf"), { pdf });
  assert.equal(danfe.status, "lido");
  assert.ok(temChaveDeAcesso(danfe.texto));
  assert.equal(classificarConteudo(danfe.texto).setor, "fiscal");
  const holerite = await lerTexto(fixture("holerite-ficticio.pdf"), { pdf });
  assert.equal(holerite.status, "lido");
  assert.equal(classificarConteudo(holerite.texto).rh, true);
});

test("leitura: XML de NF-e e OFX viram texto", async () => {
  const nfe = await lerTexto(fixture("nfe-ficticia.xml"));
  assert.equal(nfe.status, "lido");
  assert.equal(nfe.metodo, "xml");
  const ofx = await lerTexto(fixture("extrato-ficticio.ofx"));
  assert.equal(ofx.status, "lido");
  assert.equal(ofx.metodo, "ofx");
});

test("leitura: PDF escaneado fica para o OCR, e o OCR local lê a nota e o CNPJ", async () => {
  const dados = fixture("escaneado-ficticio.pdf");
  const l = await lerTexto(dados, { pdf });
  assert.equal(l.status, "sem_texto");
  assert.equal(l.ocr, true);
  const imagens = await imagensDoPdf(dados);
  assert.equal(imagens.length, 1);
  const [texto] = await ocr(imagens);
  assert.match(texto, /11\.222\.333\/0001-81/);
  assert.match(texto, /004567/);
});

test("leitura: foto é reconhecida como imagem (vai para o OCR); PNG gerado é válido", async () => {
  const png = pngDe(2, 1, 1, new Uint8Array([0, 255]));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(tipoDoArquivo(new Uint8Array(png)), "imagem");
  const l = await lerTexto(new Uint8Array(png));
  assert.equal(l.status, "sem_texto");
  assert.equal(l.ocr, true);
});

test("conteúdo: regras de setor e de RH", () => {
  assert.equal(classificarConteudo("Banco Itaú — Extrato de conta corrente\nSaldo anterior 1.000,00").setor, "financeiro");
  assert.equal(classificarConteudo("34191.79001 01043.510047 91020.150008 1 12340000012345").setor, "financeiro");
  assert.equal(classificarConteudo("PROPOSTA COMERCIAL nº 12 para Vidros SA").setor, "comercial");
  assert.equal(classificarConteudo("Ordem de Serviço 4521 — molde 33").setor, "producao");
  assert.equal(classificarConteudo("Relatório de análise química da liga").setor, "fundicao");
  assert.equal(classificarConteudo("Reunião de alinhamento").setor, null);
  const base = ["529982247", "111444777", "123456789"];
  const dv = (b, p) => { let s = 0; for (let i = 0; i < b.length; i++) s += Number(b[i]) * (p - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const cpfs = base.map((b) => { const d1 = dv(b, 10); const c = b + d1 + dv(b + d1, 11); return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4"); });
  assert.equal(contarCpfs(cpfs.join("\n")), 3);
  assert.equal(classificarConteudo(`Lista\n${cpfs.join("\n")}`).rh, true);
  assert.equal(classificarConteudo(`Contrato assinado por ${cpfs[0]}`).rh, undefined);
});

test("triagem: o conteúdo decide o setor e barra RH escondido; RH e pessoal pelo nome continuam", () => {
  const duvida = { setor: null, confianca: "duvida", motivo: "o nome não diz o setor" };
  assert.equal(combinar(duvida, { setor: "fiscal", motivo: "pelo conteúdo: nota" }).setor, "fiscal");
  assert.equal(combinar({ setor: "compras", confianca: "regra", motivo: "nome" }, { setor: null, rh: true, motivo: "pelo conteúdo: holerite" }).rh, true);
  assert.equal(combinar({ setor: null, confianca: "regra", rh: true, motivo: "nome" }, { setor: "fiscal", motivo: "x" }).rh, true);
  assert.equal(combinar({ setor: null, confianca: "regra", pessoal: true, motivo: "nome" }, { setor: "fiscal", motivo: "x" }).pessoal, true);
  assert.equal(combinar({ setor: "compras", confianca: "regra", motivo: "nome" }, { setor: null, motivo: "nada" }).setor, "compras");
});

test("o worker do pdfjs servido ao navegador é o mesmo do pacote instalado", () => {
  const versao = JSON.parse(readFileSync(new URL("../node_modules/pdfjs-dist/package.json", import.meta.url), "utf8")).version;
  const servido = readFileSync(new URL(`../public/pdfjs/pdf.worker-${versao}.min.mjs`, import.meta.url));
  const pacote = readFileSync(new URL("../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url));
  assert.equal(createHash("sha256").update(servido).digest("hex"), createHash("sha256").update(pacote).digest("hex"),
    "atualize public/pdfjs/ (e WORKER_PDF em lib/leitura/pdf-navegador.ts) com o worker da versão instalada");
  assert.match(readFileSync(new URL("../lib/leitura/pdf-navegador.ts", import.meta.url), "utf8"), new RegExp(`pdf\\.worker-${versao.replace(/\./g, "\\.")}\\.min\\.mjs`));
});

test("chave de acesso: quebrada em duas linhas vale; com dígito verificador errado, não", () => {
  assert.equal(temChaveDeAcesso("CHAVE DE ACESSO\n3526 0911 2223 3300 0181 5500 1000\n0123 4510 0001 2349"), true);
  assert.equal(temChaveDeAcesso("3526 0911 2223 3300 0181 5500 1000 0123 4510 0001 2345"), false);
  assert.equal(temChaveDeAcesso("Pedido 12345678901234567890123456789012345678901234"), false);
});
