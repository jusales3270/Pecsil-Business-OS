import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { classificar, ignorar, LIMITE_COLETA } from "../lib/coleta/triagem.ts";
import { sha256Hex } from "../lib/coleta/hash.ts";
import { SETORES_DOCUMENTO } from "../lib/documentos/setores.ts";

test("coleta: ignora pastas de sistema, de programas e de mídia pessoal (D2)", () => {
  assert.equal(ignorar("AppData/Local/x.pdf", "x.pdf", 10), "sistema");
  assert.equal(ignorar("Program Files/App/manual.pdf", "manual.pdf", 10), "sistema");
  assert.equal(ignorar(".git/config", "config", 10), "sistema");
  assert.equal(ignorar("Fotos/2024/viagem.jpg", "viagem.jpg", 10), "midia");
  assert.equal(ignorar("Vídeos/aniversario.mp4", "aniversario.mp4", 10), "midia");
  assert.equal(ignorar("Downloads/setup.exe", "setup.exe", 10), "programa");
  assert.equal(ignorar("Documentos/~$planilha.xlsx", "~$planilha.xlsx", 10), "temporario");
  assert.equal(ignorar("Documentos/backup.zip", "backup.zip", 10), "compactado");
  assert.equal(ignorar("Documentos/grande.pdf", "grande.pdf", LIMITE_COLETA + 1), "grande");
  assert.equal(ignorar("Documentos/Contrato forno.pdf", "Contrato forno.pdf", 10), null);
});

test("coleta: setor pelo conteúdo (OFX, NF-e) e pelo nome", () => {
  assert.equal(classificar({ nome: "arquivo123.ofx", tipo: "ofx" }).setor, "financeiro");
  assert.equal(classificar({ nome: "35260911222333000181550010000123451000012345.xml", tipo: "nfe-xml" }).setor, "fiscal");
  assert.equal(classificar({ nome: "Extrato Bradesco 01 a 10-2026.XLS", tipo: "xls" }).setor, "financeiro");
  assert.equal(classificar({ nome: "DANFE CMBA 22913.pdf", tipo: "pdf" }).setor, "fiscal");
  assert.equal(classificar({ nome: "Orçamento MIRAI ferro molibdenio.pdf" }).setor, "compras");
  assert.equal(classificar({ nome: "Proposta comercial Vidros SA.docx" }).setor, "comercial");
  assert.equal(classificar({ nome: "inventario_almoxarifado_set.xlsx" }).setor, "almoxarifado");
  assert.equal(classificar({ nome: "Relatorio corrida forno 3.pdf" }).setor, "fundicao");
  const duvida = classificar({ nome: "documento final v2.pdf" });
  assert.equal(duvida.setor, null);
  assert.equal(duvida.confianca, "duvida");
  for (const r of ["financeiro", "fiscal", "compras", "comercial", "almoxarifado", "fundicao", "producao"]) {
    assert.ok(SETORES_DOCUMENTO.some((s) => s.modulo === r), `${r} precisa ser um setor da guarda`);
  }
});

test("coleta: documento de colaborador e nome com CPF não sobem (RH); pessoal é marcado", () => {
  for (const nome of ["Holerite setembro Joao.pdf", "Ferias 2026 equipe.xlsx", "Atestado medico.pdf", "Rescisão contrato.pdf", "CTPS digital.pdf"]) {
    assert.equal(classificar({ nome }).rh, true, nome);
  }
  const base = "123456789";
  const dv = (b, p) => { let s = 0; for (let i = 0; i < b.length; i++) s += Number(b[i]) * (p - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const cpf = base + dv(base, 10) + dv(base + dv(base, 10), 11);
  assert.equal(classificar({ nome: `Documento ${cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}.pdf` }).rh, true);
  assert.equal(classificar({ nome: "Fotos da familia.pdf" }).pessoal, true);
  assert.equal(classificar({ nome: "NF 12345678901.pdf" }).rh, undefined);
});

test("coleta: sha256 do navegador igual ao do servidor", async () => {
  const dados = new TextEncoder().encode("PecSil coleta de arquivos");
  assert.equal(await sha256Hex(dados), createHash("sha256").update(dados).digest("hex"));
});
