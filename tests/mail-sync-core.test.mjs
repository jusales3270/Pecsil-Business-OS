import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPOS_DELTA,
  DIAS_DE_ANEXO,
  LIMITE_ANEXO,
  LIMITE_CORPO,
  decidirAnexo,
  desdeQuandoBaixarAnexos,
  deveGuardar,
  htmlParaTexto,
  interpretarAnexo,
  interpretarMensagem,
  proximoPasso,
  urlAnexos,
  urlConteudoAnexo,
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

// --- Anexos (desenhos dos pedidos; proprietário, 16/11/2026) ---------------------------------------

const anexoBruto = (extra = {}) => ({
  "@odata.type": "#microsoft.graph.fileAttachment",
  id: "AAMk-anexo-1",
  name: "Molde 750ml.step",
  contentType: "application/octet-stream",
  size: 9_400_000,
  isInline: false,
  ...extra,
});

test("anexo do Graph vira registro com espécie, tamanho e nome", () => {
  const anexo = interpretarAnexo(anexoBruto());
  assert.deepEqual(anexo, {
    graphId: "AAMk-anexo-1",
    nome: "Molde 750ml.step",
    tipoMime: "application/octet-stream",
    tamanho: 9_400_000,
    inline: false,
    especie: "arquivo",
  });
  assert.equal(interpretarAnexo(anexoBruto({ id: null })), null);
  assert.equal(interpretarAnexo(anexoBruto({ name: "" })).nome, "anexo");
  assert.equal(interpretarAnexo(anexoBruto({ size: "x" })).tamanho, 0);
  assert.equal(interpretarAnexo(anexoBruto({ "@odata.type": "#microsoft.graph.itemAttachment" })).especie, "mensagem");
  assert.equal(interpretarAnexo(anexoBruto({ "@odata.type": "#microsoft.graph.referenceAttachment" })).especie, "link");
});

test("desenho do pedido é guardado, inclusive o STEP grande e o PDF marcado como inline", () => {
  assert.deepEqual(decidirAnexo(interpretarAnexo(anexoBruto())), { guardar: true });
  assert.deepEqual(decidirAnexo(interpretarAnexo(anexoBruto({ size: LIMITE_ANEXO }))), { guardar: true });
  // Alguns programas de e-mail marcam o PDF como inline: continua sendo arquivo do pedido.
  const pdf = anexoBruto({ name: "Desenho.pdf", contentType: "application/pdf", isInline: true, size: 30_000 });
  assert.deepEqual(decidirAnexo(interpretarAnexo(pdf)), { guardar: true });
  // Print do desenho colado no corpo (imagem grande) também fica.
  const print = anexoBruto({ name: "image001.png", contentType: "image/png", isInline: true, size: 400_000 });
  assert.deepEqual(decidirAnexo(interpretarAnexo(print)), { guardar: true });
});

test("logotipo da assinatura, link, e-mail anexado e arquivo gigante ficam de fora com o motivo", () => {
  const logo = anexoBruto({ name: "image002.png", contentType: "image/png", isInline: true, size: 12_000 });
  assert.match(decidirAnexo(interpretarAnexo(logo)).motivo, /logotipo/);
  assert.match(decidirAnexo(interpretarAnexo(anexoBruto({ "@odata.type": "#microsoft.graph.referenceAttachment" }))).motivo, /OneDrive/);
  assert.match(decidirAnexo(interpretarAnexo(anexoBruto({ "@odata.type": "#microsoft.graph.itemAttachment" }))).motivo, /E-mail anexado/);
  const gigante = decidirAnexo(interpretarAnexo(anexoBruto({ size: LIMITE_ANEXO + 1 })));
  assert.equal(gigante.guardar, false);
  assert.match(gigante.motivo, /50 MB/);
});

test("endereços dos anexos: lista sem conteúdo e conteúdo bruto pelo $value", () => {
  const lista = urlAnexos("comercial@pecsil.com.br", "AAMk=id/1");
  assert.equal(lista, "/users/comercial%40pecsil.com.br/messages/AAMk%3Did%2F1/attachments?$select=id,name,contentType,size,isInline");
  assert.ok(!lista.includes("contentBytes"));
  assert.equal(urlConteudoAnexo("comercial@pecsil.com.br", "m1", "a=1"), "/users/comercial%40pecsil.com.br/messages/m1/attachments/a%3D1/$value");
});

test("anexo só das mensagens dos últimos dias de anexo", () => {
  const agora = new Date("2026-11-16T12:00:00Z");
  const desde = new Date(desdeQuandoBaixarAnexos(agora));
  assert.equal((agora.getTime() - desde.getTime()) / 86_400_000, DIAS_DE_ANEXO);
});
