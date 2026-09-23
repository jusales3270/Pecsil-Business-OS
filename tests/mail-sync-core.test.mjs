import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPOS_DELTA,
  LIMITE_CORPO,
  deveGuardar,
  htmlParaTexto,
  interpretarMensagem,
  proximoPasso,
  urlPrimeiraRodada,
} from "../lib/mail/sync-core.ts";

const comercial = {
  id: "c1",
  address: "comercial@pecsil.com.br",
  mailboxId: "comercial@pecsil.com.br",
  mode: "todos",
  readsBody: true,
  deltaLink: null,
};

const diretor = {
  id: "c2",
  address: "diretor@pecsil.com.br",
  mailboxId: "diretor@pecsil.com.br",
  mode: "remetentes_conhecidos",
  readsBody: false,
  deltaLink: null,
};

const item = (extra = {}) => ({
  id: "AAMk-graph-id",
  internetMessageId: "<abc@cliente.com.br>",
  conversationId: "conv-1",
  from: { emailAddress: { name: "Compras Vidraria", address: "Compras@Cliente.com.BR" } },
  toRecipients: [{ emailAddress: { address: "comercial@pecsil.com.br" } }],
  subject: "Pedido de 300 moldes",
  receivedDateTime: "2026-09-21T12:00:00Z",
  hasAttachments: true,
  body: { contentType: "html", content: "<p>Bom dia,</p><p>Preciso de <b>300</b> moldes.</p>" },
  ...extra,
});

test("mensagem do Graph vira registro com remetente em minúsculas", () => {
  const mensagem = interpretarMensagem(item(), comercial);
  assert.equal(mensagem.fromAddress, "compras@cliente.com.br");
  assert.equal(mensagem.fromName, "Compras Vidraria");
  assert.equal(mensagem.internetMessageId, "<abc@cliente.com.br>");
  assert.deepEqual(mensagem.toAddresses, ["comercial@pecsil.com.br"]);
  assert.equal(mensagem.hasAttachments, true);
  assert.equal(mensagem.bodyText, "Bom dia,\nPreciso de 300 moldes.");
});

test("caixa sem permissão de corpo não guarda corpo nenhum", () => {
  const mensagem = interpretarMensagem(item(), diretor);
  assert.equal(mensagem.bodyText, null);
  assert.equal(mensagem.subject, "Pedido de 300 moldes");
});

test("item de remoção e mudança de leitura não viram mensagem", () => {
  // O delta devolve isso na mesma lista; tratar como e-mail criaria registro do nada.
  assert.equal(interpretarMensagem({ id: "x", "@removed": { reason: "deleted" } }, comercial), null);
  assert.equal(interpretarMensagem({ id: "x", isRead: true }, comercial), null);
  assert.equal(interpretarMensagem(item({ internetMessageId: null }), comercial), null);
  assert.equal(interpretarMensagem(item({ from: null }), comercial), null);
});

test("corpo gigante é cortado no limite", () => {
  const longo = item({ body: { contentType: "text", content: "x".repeat(LIMITE_CORPO + 500) } });
  assert.equal(interpretarMensagem(longo, comercial).bodyText.length, LIMITE_CORPO);
});

test("sem corpo, sobra a prévia", () => {
  const semCorpo = item({ body: null, bodyPreview: "Bom dia, segue o pedido" });
  assert.equal(interpretarMensagem(semCorpo, comercial).bodyText, "Bom dia, segue o pedido");
});

test("caixa da empresa guarda tudo; caixa de pessoa só remetente conhecido", () => {
  const mensagem = interpretarMensagem(item(), comercial);
  const conhecidos = new Set(["compras@cliente.com.br"]);
  assert.equal(deveGuardar(mensagem, comercial, new Set()), true);
  assert.equal(deveGuardar(mensagem, diretor, conhecidos), true);
  assert.equal(deveGuardar(mensagem, diretor, new Set()), false);
  const particular = interpretarMensagem(item({ from: { emailAddress: { address: "amigo@gmail.com" } } }), diretor);
  assert.equal(deveGuardar(particular, diretor, conhecidos), false);
});

test("HTML de e-mail vira texto legível", () => {
  assert.equal(htmlParaTexto("<div>Olá<br>mundo</div>"), "Olá\nmundo");
  assert.equal(htmlParaTexto("<style>p{color:red}</style><p>Só o texto</p>"), "Só o texto");
  // Acento em entidade é comum em e-mail brasileiro e precisa chegar legível
  // ao classificador.
  assert.equal(htmlParaTexto("Pre&ccedil;o &gt; R$ 10 &amp; frete"), "Preço > R$ 10 & frete");
  assert.equal(htmlParaTexto("&Ccedil;imento e organiza&ccedil;&atilde;o"), "Çimento e organização");
  assert.equal(htmlParaTexto("&naoexiste; fica como está"), "&naoexiste; fica como está");
  assert.equal(htmlParaTexto("<p>a</p>\n\n\n<p>b</p>"), "a\nb");
});

test("paginação do delta: página, fim e contrato inesperado", () => {
  assert.deepEqual(proximoPasso({ "@odata.nextLink": "https://g/next" }), { tipo: "pagina", url: "https://g/next" });
  assert.deepEqual(proximoPasso({ "@odata.deltaLink": "https://g/delta" }), { tipo: "fim", url: "https://g/delta" });
  assert.deepEqual(proximoPasso({}), { tipo: "indefinido", url: null });
});

test("primeira rodada pede só a Entrada, com os campos mínimos", () => {
  const url = urlPrimeiraRodada("comercial@pecsil.com.br");
  assert.ok(url.includes("/mailFolders/inbox/messages/delta"));
  assert.ok(url.includes(encodeURIComponent("comercial@pecsil.com.br")));
  assert.ok(decodeURIComponent(url).includes(CAMPOS_DELTA));
  // Nada de anexo na leitura: anexo não é pedido ao provedor.
  assert.ok(!CAMPOS_DELTA.includes("attachments,"));
});
