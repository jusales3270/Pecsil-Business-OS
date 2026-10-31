import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { complementoEscrito, dividir, lerMensagem, paraWhatsApp } from "../lib/whatsapp/mensagem.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const aviso = (data, extra = {}) => ({ event: "messages.upsert", instance: "pecsil-interno", data, ...extra });
const chave = (k = {}) => ({ remoteJid: "5515912345678@s.whatsapp.net", fromMe: false, id: "3EB0ABC", ...k });

test("W3: lê texto, áudio, foto e documento do aviso da Evolution", () => {
  const t = lerMensagem(aviso({ key: chave(), pushName: " Ju ", message: { conversation: " Quantas OS atrasadas? " } }));
  assert.deepEqual(t, { instancia: "pecsil-interno", waId: "3EB0ABC", numero: "5515912345678", jid: "5515912345678@s.whatsapp.net", base64: null, nome: "Ju", tipo: "texto", texto: "Quantas OS atrasadas?", mimetype: null });
  assert.equal(lerMensagem(aviso({ key: chave(), message: { extendedTextMessage: { text: "com link" } } })).texto, "com link");
  const a = lerMensagem(aviso({ key: chave(), message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" }, base64: "T2dnUw==" } }));
  assert.equal(a.tipo, "audio"); assert.equal(a.base64, "T2dnUw=="); assert.match(a.mimetype, /ogg/);
  assert.equal(lerMensagem(aviso({ key: chave(), message: { imageMessage: { caption: "que peça é essa?" } } })).tipo, "imagem");
  assert.equal(lerMensagem(aviso({ key: chave(), message: { documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", caption: "nota" } } } } })).tipo, "documento");
  assert.equal(lerMensagem(aviso({ key: chave(), message: { stickerMessage: {} } })).tipo, "outro");
});

test("W3: endereço novo do WhatsApp (LID) usa o telefone do campo alternativo", () => {
  const r = lerMensagem(aviso({ key: chave({ remoteJid: "123456789@lid", senderPn: "5515912345678@s.whatsapp.net" }), message: { conversation: "oi" } }));
  assert.equal(r.numero, "5515912345678");
  assert.equal(r.jid, "123456789@lid", "responde no mesmo chat");
  assert.deepEqual(lerMensagem(aviso({ key: chave({ remoteJid: "123456789@lid" }), message: { conversation: "oi" } })).descartar, "numero_desconhecido");
});

test("W3: descarta o que não é conversa de uma pessoa (sem responder nada)", () => {
  assert.equal(lerMensagem(aviso({ key: chave({ fromMe: true }), message: { conversation: "eco" } })).descartar, "do_proprio_chip");
  assert.equal(lerMensagem(aviso({ key: chave({ remoteJid: "120363@g.us" }), message: { conversation: "grupo" } })).descartar, "grupo");
  assert.equal(lerMensagem(aviso({ key: chave({ remoteJid: "status@broadcast" }), message: { conversation: "s" } })).descartar, "grupo");
  assert.equal(lerMensagem({ event: "connection.update", instance: "x", data: {} }).descartar, "evento");
  assert.equal(lerMensagem({ event: "MESSAGES_UPSERT", instance: "pecsil-interno", data: { key: chave(), message: { conversation: "maiúsculo" } } }).texto, "maiúsculo");
  assert.equal(lerMensagem(null).descartar, "evento");
});

test("W3: resposta da SARA no formato do WhatsApp", () => {
  const md = "### Cotações\n**3 pendentes**, veja em [Compras › Pendentes](/?module=compras&secao=pendentes).\n\n| Nº | Fornecedor | Total |\n|---|---|---:|\n| 266 | World Tools | R$ 1.200,00 |\n- item um\n* item dois";
  assert.equal(paraWhatsApp(md, "https://home.pecsil.com.br/"),
    "*Cotações*\n*3 pendentes*, veja em Compras › Pendentes: https://home.pecsil.com.br/?module=compras&secao=pendentes.\n\nNº · Fornecedor · Total\n266 · World Tools · R$ 1.200,00\n• item um\n• item dois");
  assert.equal(paraWhatsApp("[site](https://x.com)", "https://p"), "site: https://x.com");
});

test("W3: texto longo em partes, quebrando no parágrafo", () => {
  const p = dividir(`${"a".repeat(3000)}\n\n${"b".repeat(3000)}`, 3500);
  assert.equal(p.length, 2); assert.equal(p[0], "a".repeat(3000)); assert.equal(p[1], "b".repeat(3000));
  assert.deepEqual(dividir("curto"), ["curto"]);
  assert.ok(dividir("x".repeat(8000), 3500).every((x) => x.length <= 3500));
});

test("W3: com áudio, o que não dá para ouvir vai por escrito", () => {
  assert.equal(complementoEscrito({ acoesPendentes: 0, visuais: 0, linkSara: "L" }), null);
  assert.match(complementoEscrito({ acoesPendentes: 1, visuais: 0, linkSara: "L" }), /^Preparei uma ação que precisa do seu Permitir na plataforma: L$/);
  assert.match(complementoEscrito({ acoesPendentes: 2, visuais: 3, linkSara: "L" }), /2 ações que precisam[\s\S]*3 gráficos/);
});

test("W3: webhook com segredo (404 se errado), atendimento em silêncio para quem está fora da lista", () => {
  const rota = ler("app/api/whatsapp/webhook/[segredo]/route.ts");
  assert.match(rota, /timingSafeEqual/);
  assert.match(rota, /if \(!confere\(segredo\)\) return new NextResponse\(null, \{ status: 404 \}\)/);
  const a = ler("lib/whatsapp/atender.ts");
  // Fora da lista: ignora ANTES de marcar como lida ou mostrar "digitando".
  const iFora = a.indexOf('return ignorar("fora_da_lista")'), iLida = a.indexOf("await d.marcarLida(");
  assert.ok(iFora > 0 && iLida > iFora, "fora da lista sai antes de qualquer sinal");
  assert.match(a, /responder\(p, sara, \{ pergunta/);
  assert.match(a, /const s = await sessaoComo\(admin, perfil\.id\)/);
  assert.match(ler("supabase/migrations/202610240003_whatsapp_mensagens.sql"), /revoke insert, update, delete on public\.whatsapp_mensagens from authenticated/);
});

test("botões, lista e enquete: a escolha vem junto (tipo outro) e a SARA só confirma o recebimento", () => {
  const b = lerMensagem(aviso({ key: chave(), message: { buttonsResponseMessage: { selectedButtonId: "teste-sim", selectedDisplayText: "Sim" } } }));
  assert.equal(b.tipo, "outro"); assert.deepEqual(b.escolha, { forma: "botao", id: "teste-sim", texto: "Sim" });
  assert.deepEqual(lerMensagem(aviso({ key: chave(), message: { templateButtonReplyMessage: { selectedId: "x", selectedDisplayText: "Não" } } })).escolha, { forma: "botao", id: "x", texto: "Não" });
  assert.deepEqual(lerMensagem(aviso({ key: chave(), message: { listResponseMessage: { title: "Sim", singleSelectReply: { selectedRowId: "teste-sim" } } } })).escolha, { forma: "lista", id: "teste-sim", texto: "Sim" });
  assert.deepEqual(lerMensagem(aviso({ key: chave(), message: { interactiveResponseMessage: { body: { text: "Sim" }, nativeFlowResponseMessage: { paramsJson: '{"id":"teste-sim"}' } } } })).escolha, { forma: "botao", id: "teste-sim", texto: "Sim" });
  assert.deepEqual(lerMensagem(aviso({ key: chave(), message: { pollUpdateMessage: { vote: { encPayload: "x", encIv: "y" } } } })).escolha, { forma: "enquete", id: null, texto: "" }, "voto cifrado: sem a opção");
  assert.equal(lerMensagem(aviso({ key: chave(), message: { pollUpdateMessage: { vote: { selectedOptions: ["Não"] } } } })).escolha.texto, "Não");
  assert.equal(lerMensagem(aviso({ key: chave(), message: { stickerMessage: {} } })).escolha, undefined);
  const a = ler("lib/whatsapp/atender.ts");
  assert.match(a, /if \(m\.escolha\)/);
  assert.match(a, /Por enquanto é só teste: nada foi feito/);
  assert.ok(a.indexOf("if (m.escolha)") > a.indexOf('return ignorar("fora_da_lista")'), "fora da lista continua em silêncio");
});

test("I-24: só um agradecimento vira reação; qualquer outra palavra vai para a SARA", async () => {
  const { soAgradecimento } = await import("../lib/whatsapp/mensagem.ts");
  for (const t of ["obrigado", "Obrigada!", "muito obrigado", "valeu", "vlw", "obg", "Obrigado, Sara", "obrigada mesmo 🙏", "brigado!!"]) assert.equal(soAgradecimento(t), true, t);
  for (const t of ["obrigado, e o saldo?", "valeu, manda o PDF", "", null, "ok", "não precisa, obrigado", "obrigatório"]) assert.equal(soAgradecimento(t), false, String(t));
  const a = readFileSync(new URL("../lib/whatsapp/atender.ts", import.meta.url), "utf8");
  assert.ok(a.indexOf("await d.marcarLida(") < a.indexOf("soAgradecimento(m.texto)"), "só para quem está na lista");
  assert.ok(a.indexOf("soAgradecimento(m.texto)") < a.indexOf("await responder("), "sem gastar o modelo");
});

test("I-24: reação pela Evolution com a chave da mensagem recebida", async () => {
  process.env.EVOLUTION_API_URL ??= "http://evolution.teste"; process.env.EVOLUTION_API_KEY ??= "k";
  const { reagir } = await import("../lib/whatsapp/evolution.ts");
  const pedidos = [];
  const buscar = async (u, i) => { pedidos.push({ u: String(u), i }); return new Response("{}", { status: 201 }); };
  await reagir("pecsil-comercial", "5511@s.whatsapp.net", "ABC", "🙏", buscar);
  assert.match(pedidos[0].u, /\/message\/sendReaction\/pecsil-comercial$/);
  assert.deepEqual(JSON.parse(pedidos[0].i.body), { key: { remoteJid: "5511@s.whatsapp.net", fromMe: false, id: "ABC" }, reaction: "🙏" });
});
