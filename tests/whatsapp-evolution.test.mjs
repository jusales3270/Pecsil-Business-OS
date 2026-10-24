import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { estadoDaConexao, evolution, INSTANCIA_INTERNA, nomeDeInstancia, numeroLegivel, numeroWhatsApp, pedirQr, situacao } from "../lib/whatsapp/evolution.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const resposta = (status, corpo) => ({ ok: status < 400, status, text: async () => JSON.stringify(corpo) });

test("whatsapp: número com DDD vira o formato do WhatsApp (55 + DDD + número)", () => {
  assert.deepEqual(numeroWhatsApp("(15) 91234-5678"), { numero: "5515912345678" });
  assert.deepEqual(numeroWhatsApp("15 3333-4444"), { numero: "551533334444" });
  assert.deepEqual(numeroWhatsApp("+55 15 91234-5678"), { numero: "5515912345678" });
  assert.deepEqual(numeroWhatsApp("015 91234-5678"), { numero: "5515912345678" });
  assert.ok("erro" in numeroWhatsApp("91234-5678"));
  assert.ok("erro" in numeroWhatsApp(""));
  assert.equal(numeroLegivel("5515912345678@s.whatsapp.net"), "+55 15 91234-5678");
  assert.equal(numeroLegivel("5515912345678:12@s.whatsapp.net"), "+55 15 91234-5678");
  assert.equal(numeroLegivel(null), null);
});

test("whatsapp: estado da conexão da Evolution", () => {
  assert.equal(estadoDaConexao("open"), "conectado");
  assert.equal(estadoDaConexao("connecting"), "aguardando_qr");
  assert.equal(estadoDaConexao("close"), "desconectado");
  assert.equal(estadoDaConexao(undefined), "desconectado");
});

test("whatsapp: chamada com a chave do servidor, erro com a mensagem da Evolution", async () => {
  let visto = null;
  const buscar = async (url, init) => { visto = { url, init }; return resposta(400, { response: { message: ["número inválido"] } }); };
  await assert.rejects(evolution({ url: "http://evo:8080", chave: "k" }, "POST", "/message/sendText/x", { a: 1 }, buscar), /número inválido/);
  assert.equal(visto.url, "http://evo:8080/message/sendText/x");
  assert.equal(visto.init.headers.apikey, "k");
});

test("whatsapp: situação e QR Code (sem configuração, sem instância, conectado)", async () => {
  const antes = { ...process.env };
  try {
    delete process.env.EVOLUTION_API_URL; delete process.env.EVOLUTION_API_KEY;
    assert.equal((await situacao()).estado, "sem_configuracao");
    process.env.EVOLUTION_API_URL = "http://evo:8080/"; process.env.EVOLUTION_API_KEY = "k";
    // Sem instância: o QR cria a instância do chip interno (WhatsApp Web) e devolve a imagem.
    const pedidos = [];
    const vazia = async (url, init) => { pedidos.push(`${init.method} ${url}`); return url.includes("/instance/create") ? resposta(201, { qrcode: { base64: "data:image/png;base64,AAA" } }) : resposta(200, []); };
    assert.equal((await situacao("pecsil-comercial", vazia)).estado, "sem_instancia");
    assert.deepEqual(await pedirQr("pecsil-comercial", vazia), { qr: "data:image/png;base64,AAA", conectado: false });
    assert.ok(pedidos.some((p) => p === "POST http://evo:8080/instance/create"));
    assert.ok(pedidos.some((p) => p.includes("instanceName=pecsil-comercial")), "cada número é a sua instância");
    await assert.rejects(situacao("../admin", vazia).then((x) => { if (x.estado === "fora_do_ar") throw new Error(x.detalhe); }), /Instância inválida/);
    // Conectado: mostra o número; pedir QR não cria nada.
    const ligada = async () => resposta(200, [{ name: INSTANCIA_INTERNA, connectionStatus: "open", ownerJid: "5515912345678@s.whatsapp.net", profileName: "Pecsil" }]);
    assert.deepEqual(await situacao(INSTANCIA_INTERNA, ligada), { estado: "conectado", numero: "+55 15 91234-5678", nome: "Pecsil" });
    assert.deepEqual(await pedirQr(INSTANCIA_INTERNA, ligada), { qr: null, conectado: true });
    // Evolution fora do ar.
    const fora = async () => { throw new Error("connect ECONNREFUSED"); };
    assert.equal((await situacao(INSTANCIA_INTERNA, fora)).estado, "fora_do_ar");
  } finally { process.env = antes; }
});

test("whatsapp: nome da instância de um número novo, fixo e sem repetir", () => {
  assert.equal(nomeDeInstancia("Atendimento a Clientes", []), "pecsil-atendimento-a-clientes");
  assert.equal(nomeDeInstancia("Comercial", ["pecsil-comercial"]), "pecsil-comercial-2");
  assert.equal(nomeDeInstancia("Comercial", ["pecsil-comercial", "pecsil-comercial-2"]), "pecsil-comercial-3");
  assert.equal(nomeDeInstancia("Fiscal & Contábil!", []), "pecsil-fiscal-contabil");
  assert.equal(nomeDeInstancia("!!!", []), "pecsil-canal");
});

test("whatsapp: tela na Fundação, só do proprietário; chave nunca no navegador", () => {
  const pagina = ler("app/page.tsx");
  assert.match(pagina, /OWNER_ONLY_VIEWS: View\[\] = \[[^\]]*"WhatsApp"/);
  assert.match(pagina, /view==="WhatsApp"\?<WhatsappCanal/);
  assert.match(ler("app/api/foundation/whatsapp/route.ts"), /if \(!access\?\.isOwner\)/);
  assert.doesNotMatch(ler("app/components/whatsapp-canal.tsx"), /EVOLUTION_API|apikey/);
  assert.doesNotMatch(ler("lib/whatsapp/evolution.ts"), /NEXT_PUBLIC_/);
});
