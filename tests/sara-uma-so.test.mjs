import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acharPessoa } from "../lib/sara/documentos/documento.ts";
import { contextoParaVerificar } from "../lib/sara/escopo.ts";
import { resumoFalado } from "../lib/sara/central/fala.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

// Correções de 24/10/2026, depois do registro das 21:24–22:05 (pedido do proprietário: "ela deveria ser a própria central").

test("uma SARA só: a voz passa as palavras da pessoa e não anuncia que vai consultar a central", () => {
  const voz = ler("lib/sara/central/voz-ao-vivo.ts");
  assert.match(voz, /name: "responder"/);
  assert.match(voz, /name: "responder_pela_area"/);
  assert.doesNotMatch(voz, /consultar_sara_central|perguntar_a_area/);
  assert.match(voz, /Você e a SARA central são a mesma SARA: nunca diga que vai consultar a central/);
  assert.match(voz, /não reescreva em terceira pessoa/);
  assert.doesNotMatch(voz, /consulto o Financeiro|estou consultando o Financeiro/);
  const holo = ler("modules/warroom/src/holograma/SaraHolograma.tsx");
  // A pergunta digitada vai direto à central (sem passar pela camada de voz).
  assert.doesNotMatch(holo, /v\.perguntar\(pergunta\)/);
  assert.match(holo, /thinking: "PENSANDO"/);
});

test("destinatário: primeiro nome único e 'para mim'", () => {
  const pessoas = [{ id: "1", nome: "Júnior" }, { id: "2", nome: "Ana Paula Souza" }, { id: "3", nome: "Ricardo Silva" }, { id: "4", nome: "Ricardo Lima" }];
  assert.equal(acharPessoa("Júnior Salles", pessoas).pessoa?.id, "1", "o primeiro nome basta quando é único");
  assert.equal(acharPessoa("Ana", pessoas).pessoa?.id, "2");
  assert.match(acharPessoa("Ricardo Souza", pessoas).erro, /Não achei/, "primeiro nome repetido não adivinha");
  assert.match(acharPessoa("Fulano", pessoas).erro, /Não achei/);
  const enviar = ler("lib/whatsapp/enviar.ts");
  assert.match(enviar, /export const ehQuemPede/);
  assert.match(enviar, /if \(ehQuemPede\(nome\)\)/);
  assert.match(enviar, /const NUMERO = \/\^DOC-/, "aceita o número do documento");
});

test("trava: 'preparei' sem ação vira nova tentativa e, se não der, aviso de que nada foi preparado", async () => {
  const { prometeuCartao } = await import("../lib/sara/responder.ts").catch(() => ({}));
  const r = ler("lib/sara/responder.ts");
  assert.match(r, /else if \(!r\.acoes\.length && prometeuCartao\(r\.texto\)/);
  assert.match(r, /Nada foi preparado nesta resposta: não há cartão para permitir/);
  if (prometeuCartao) {
    assert.ok(prometeuCartao("O envio está preparado, Senhor, mas falta o seu toque em Permitir no cartão da tela."));
    assert.ok(!prometeuCartao("Há 50 cotações esperando aprovação, somando R$ 94.989,13."));
  }
});

test("verificador de escopo: o contexto só acompanha mensagens curtas", () => {
  assert.equal(contextoParaVerificar("sim, pode enviar", "texto anterior"), "texto anterior");
  assert.equal(contextoParaVerificar("e o outro?", "x"), "x");
  assert.equal(contextoParaVerificar("Sara, qual é a projeção do faturamento para o primeiro trimestre de 2027?", "x"), null);
  assert.equal(contextoParaVerificar("sim", null), null);
  const e = ler("lib/sara/escopo.ts");
  assert.match(e, /projeções, previsões, metas e planejamento da empresa para qualquer período/);
  assert.match(e, /serve só para entender uma continuação curta/);
});

test("fala: no WhatsApp o resto fica 'na plataforma'; no holograma, 'no painel'", () => {
  const t = "Há duas OCs aprovadas sem compra.\n\n| OC | Fornecedor |\n|---|---|\n| 7 | PLAM |";
  assert.match(resumoFalado(t), /O detalhe está no painel\.$/);
  assert.match(resumoFalado(t, 420, { detalhe: "O detalhe está na plataforma.", semTexto: "x" }), /O detalhe está na plataforma\.$/);
});

test("criar uma vez: documentos e mensagens de voz são reaproveitados pelo número", () => {
  assert.match(ler("lib/sara/central/sara.ts"), /Crie cada documento e cada mensagem de voz UMA vez/);
  assert.match(ler("lib/sara/central/mensagem-de-voz.ts"), /Grave UMA vez por pedido/);
  assert.match(ler("lib/sara/central/documentos.ts"), /Crie UMA vez por pedido/);
});
