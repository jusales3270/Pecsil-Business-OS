import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import "./ts-resolver.mjs";
const { lerFormularioLimitado, EnvioInvalido } = await import("../lib/security/upload.ts");
const { criarLimitesCotar, ipDoFornecedor } = await import("../lib/security/cotar-limites.ts");

// Executa a rota real e seus leitores/limites reais, isolando apenas Supabase, Storage e OCR.
// Não acessa rede nem usa credenciais de produção.
const estado = { conv: null, erroConvite: null, erroRpc: null, eventos: [], enviado: null, consulta: null };
globalThis.__cotarSecurityTest = estado;
const modulo = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/app/api/cotar/%5Bcodigo%5D/route.ts") || context.parentURL?.endsWith("/app/api/cotar/[codigo]/route.ts")) {
      if (specifier === "next/server") return { url: modulo('export const NextResponse = {json: (body, options) => Response.json(body, options)}'), shortCircuit: true };
      if (specifier.endsWith("/supabase/admin")) return { url: modulo(`
        export function createSupabaseAdminClient() {
          const e = globalThis.__cotarSecurityTest;
          return {
            from(tabela) { return { select(colunas) { return { eq(coluna, hash) { e.consulta = { tabela, colunas, coluna, hash }; return { async maybeSingle() { e.eventos.push("autorizar"); return { data: e.conv, error: e.erroConvite }; } }; } }; } }; },
            storage: { from() { return { async upload() { e.eventos.push("upload"); return { error: null }; }, async remove() { e.eventos.push("remover"); return { error: null }; } }; } },
            async rpc(nome, args) { e.eventos.push("responder"); e.enviado = { nome, args }; return { data: { itens: 1, documento: args.p_arquivo_caminho ? "doc" : null, organizacao: "org" }, error: e.erroRpc }; }
          };
        }`), shortCircuit: true };
      if (specifier.endsWith("/documentos/guardar")) return { url: modulo('import { createHash } from "node:crypto"; export const sha256 = (dados) => createHash("sha256").update(dados).digest("hex");'), shortCircuit: true };
      if (specifier.endsWith("/documentos/setores")) return { url: modulo('export const caminhoDocumento = (org, modulo, id) => `${org}/${modulo}/${id}.pdf`;'), shortCircuit: true };
      if (specifier.endsWith("/leitura/servidor")) return { url: modulo('export const lerEGravar = async () => { globalThis.__cotarSecurityTest.eventos.push("ler"); };'), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/cotar/[codigo]/route.ts");
let numero = 0;
const contexto = () => ({ params: Promise.resolve({ codigo: `cotacao-teste-${String(++numero).padStart(20, "0")}` }) });
function preparar(conv = { organization_id: "org", situacao: "aberto", expira_em: "2099-01-01T00:00:00Z" }) {
  Object.assign(estado, { conv, erroConvite: null, erroRpc: null, eventos: [], enviado: null, consulta: null });
}
function formulario(pdf = false) {
  const f = new FormData();
  f.append("itens", JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", valor_unit: 10, quantidade: 3, ipi: 0, obs: "" }]));
  f.append("prazoEntrega", ""); f.append("condicao", "30 DDL"); f.append("freteTipo", "CIF"); f.append("freteValor", "0"); f.append("observacao", "");
  if (pdf) f.append("arquivo", new File(["%PDF-1.7\nproposta"], "proposta.pdf", { type: "application/pdf" }));
  return f;
}
const request = (f = formulario()) => new Request("https://example.test/api/cotar/token", { method: "POST", body: f });

for (const [nome, conv] of [["inexistente", null], ["expirado", { situacao: "aberto", expira_em: "2000-01-01T00:00:00Z" }], ["respondido", { situacao: "respondido", expira_em: "2099-01-01T00:00:00Z" }], ["validade inválida", { situacao: "aberto", expira_em: "x" }]]) {
  test(`cotar: convite ${nome} não consome o corpo`, async () => {
    preparar(conv); const req = request();
    assert.equal((await POST(req, contexto())).status, 400);
    assert.equal(req.bodyUsed, false); assert.deepEqual(estado.eventos, ["autorizar"]);
  });
}
test("cotar: erro ao conferir convite não consome corpo nem chama RPC", async () => {
  preparar(); estado.erroConvite = { message: "banco indisponível" }; const req = request();
  assert.equal((await POST(req, contexto())).status, 503); assert.equal(req.bodyUsed, false);
  assert.deepEqual(estado.eventos, ["autorizar"]);
});
test("cotar: envio válido sem anexo mantém autorização, hash e RPC de resposta única", async () => {
  preparar(); const ctx = contexto(), { codigo } = await ctx.params;
  const res = await POST(request(), ctx);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, itens: 1 });
  assert.deepEqual(estado.eventos, ["autorizar", "responder"]);
  assert.equal(estado.consulta.tabela, "compras_convites"); assert.equal(estado.consulta.coluna, "token_hash");
  assert.equal(estado.consulta.hash, createHash("sha256").update(codigo).digest("hex"));
  assert.equal(estado.enviado.nome, "compras_convite_responder"); assert.equal(estado.enviado.args.p_codigo, codigo);
  assert.equal(estado.enviado.args.p_arquivo_caminho, null);
});
test("cotar: PDF válido sobe depois da autorização e é lido depois da confirmação", async () => {
  preparar(); const res = await POST(request(formulario(true)), contexto());
  assert.equal(res.status, 200); assert.deepEqual(estado.eventos, ["autorizar", "upload", "responder", "ler"]);
  assert.equal(estado.enviado.args.p_arquivo_mime, "application/pdf"); assert.equal(estado.enviado.args.p_arquivo_tamanho, 17);
});
test("cotar: disputa de resposta única continua na RPC e remove anexo rejeitado", async () => {
  preparar(); estado.erroRpc = { message: "Esta cotação já foi respondida por este link." };
  assert.equal((await POST(request(formulario(true)), contexto())).status, 400);
  assert.deepEqual(estado.eventos, ["autorizar", "upload", "responder", "remover"]);
});
test("cotar: corpo chunked acima do teto é cancelado antes de upload/RPC", async () => {
  preparar(); let cancelado = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(64_000)); }, cancel() { cancelado = true; } }, { highWaterMark: 0 });
  const req = new Request("https://example.test", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=teste" }, body, duplex: "half" });
  assert.equal((await POST(req, contexto())).status, 413);
  assert.equal(cancelado, true); assert.deepEqual(estado.eventos, ["autorizar"]);
});
test("cotar: campos duplicados, arquivos falsos e preços infinitos não são enviados", async () => {
  preparar(); const duplicado = formulario(); duplicado.append("condicao", "outra");
  assert.equal((await POST(request(duplicado), contexto())).status, 400);
  assert.equal(estado.enviado, null);
  preparar(); const falso = formulario(); falso.append("arquivo", new File(["nao e PDF"], "arquivo.pdf", { type: "application/pdf" }));
  assert.equal((await POST(request(falso), contexto())).status, 400); assert.equal(estado.enviado, null);
  preparar(); const invalido = formulario(); invalido.set("itens", '[{"id":"11111111-1111-4111-8111-111111111111","valor_unit":1e999,"quantidade":1,"ipi":0,"obs":""}]');
  assert.equal((await POST(request(invalido), contexto())).status, 400); assert.equal(estado.enviado, null);
});
test("upload: bytes reais vencem Content-Length falso e timeout cancela leitura", async () => {
  let cancelado = false;
  const corpo = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(32)); }, cancel() { cancelado = true; } }, { highWaterMark: 0 });
  const req = new Request("https://example.test", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "1" }, body: corpo, duplex: "half" });
  await assert.rejects(lerFormularioLimitado(req, { bytes: 16 }), (e) => e instanceof EnvioInvalido && e.status === 413);
  assert.equal(cancelado, true);
  let tempoCancelado = false;
  const parado = new Request("https://example.test", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: new ReadableStream({ cancel() { tempoCancelado = true; } }, { highWaterMark: 0 }), duplex: "half" });
  await assert.rejects(lerFormularioLimitado(parado, { prazoMs: 2 }), (e) => e instanceof EnvioInvalido && e.status === 408);
  assert.equal(tempoCancelado, true);
});
test("upload: limita a quantidade de partes antes de criar objetos de formulário", async () => {
  const f = new FormData(); for (let i = 0; i < 10; i++) f.append(`campo${i}`, "x");
  await assert.rejects(lerFormularioLimitado(request(f), { partes: 8 }), /Muitos campos/);
});
test("cotar: limites de IP/token/concorrrência expiram e não confiam em IP falsificado", () => {
  const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 177.10.20.30" });
  assert.equal(ipDoFornecedor(headers, false), null); assert.equal(ipDoFornecedor(headers, true), "177.10.20.30");
  assert.equal(ipDoFornecedor(new Headers({ "x-real-ip": "1.1.1.1" }), true), null);
  let agora = 0;
  const limite = criarLimitesCotar({ janelaMs: 1000, maxIp: 3, maxToken: 2, agora: () => agora });
  const a = limite("ip1", "hash1"); assert.equal(a.ok, true);
  assert.equal(limite("ip2", "hash1").ok, false, "mesmo token não pode ter dois envios ativos");
  a.liberar(); a.liberar();
  const b = limite("ip2", "hash1"); assert.equal(b.ok, true); b.liberar();
  assert.equal(limite("ip3", "hash1").ok, false, "trocar IP não contorna limite do token");
  const c = limite("ip1", "hash2"); assert.equal(c.ok, true);
  assert.equal(limite("ip1", "hash3").ok, true);
  assert.equal(limite("ip1", "hash4").ok, false, "limite de concorrência por IP");
  c.liberar(); agora = 1001;
  assert.equal(limite("ip3", "hash1").ok, true);
});
