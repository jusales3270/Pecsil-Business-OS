import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";
const { caminhoArquivoSaraValido } = await import("../lib/sara/caminho-arquivo.ts");
const { AudioInvalido, lerAudioLimitado } = await import("../lib/sara/audio-limitado.ts");
const org = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", doc = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const outro = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const pasta = `${org}/${doc}`;

test("SARA object keys accept generated PDF/audio and reject legacy traversal before Storage URL normalization", () => {
  for (const arquivo of ["DOC-2026-0001 Relatorio.pdf", "DOC-2026-0002 mensagem de voz.mp3", "relatorio_geral-v2.1.pdf"]) assert.equal(caminhoArquivoSaraValido(`${pasta}/${arquivo}`, org, doc), true);
  for (const caminho of [
    `${pasta}/../../${outro}/${outro}/secreto.pdf`, `${pasta}/../segredo.pdf`, `${pasta}/.`, `${pasta}/..`, `${pasta}/`, `${pasta}//normal.pdf`,
    `${pasta}/%2e%2e%2f${outro}%2fsecreto.pdf`, `${pasta}/%252e%252e%252fsecreto.pdf`, `${pasta}/%2E%2e`, `${pasta}/%2Fsegredo.pdf`,
    `${pasta}/..\\..\\${outro}\\secreto.pdf`, `${pasta}/normal.pdf?path=outro`, `${pasta}/normal.pdf#fragmento`, `${pasta}/arquivo\u0000.pdf`,
    `${pasta}/normal.pdf\n`, `${pasta}/normal.pdf `, `${pasta}/normal.pdf.`, `${org}/${outro}/normal.pdf`, `${outro}/${doc}/normal.pdf`,
  ]) assert.equal(caminhoArquivoSaraValido(caminho, org, doc), false, JSON.stringify(caminho));
  for (const caminho of [null, undefined, 123, {}, []]) assert.equal(caminhoArquivoSaraValido(caminho, org, doc), false);
  assert.equal(caminhoArquivoSaraValido(`${pasta}/normal.pdf`, "invalid", doc), false);
});

const request = (body, headers = {}) => new Request("https://test.invalid/audio", { method: "POST", duplex: "half", body, headers });

test("audio reads a normal bounded stream preserving bytes exactly", async () => {
  const resultado = await lerAudioLimitado(request(new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(1, 2)); c.enqueue(Uint8Array.of(3, 4, 5)); c.close(); } })), { bytes: 5, prazoMs: 100 });
  assert.deepEqual(new Uint8Array(resultado), Uint8Array.of(1, 2, 3, 4, 5));
});

test("audio stops and cancels chunked and misleading Content-Length streams at the actual byte limit", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    let lidos = 0, cancelado = false;
    const body = new ReadableStream({ pull(c) { lidos++; c.enqueue(new Uint8Array(1024)); if (lidos === 100) c.close(); }, cancel() { cancelado = true; } }, { highWaterMark: 0 });
    await assert.rejects(lerAudioLimitado(request(body, headers), { bytes: 2048, prazoMs: 100 }), (e) => e instanceof AudioInvalido && e.status === 413);
    assert.equal(cancelado, true);
    assert.equal(lidos, 3, "never drains the remaining 97 chunks");
  }
});

test("audio rejects an oversized declared length before reading the body", async () => {
  let lidos = 0, cancelado = false;
  const body = new ReadableStream({ pull(c) { lidos++; c.enqueue(new Uint8Array(1024)); }, cancel() { cancelado = true; } }, { highWaterMark: 0 });
  await assert.rejects(lerAudioLimitado(request(body, { "content-length": "999999999" }), { bytes: 1024, prazoMs: 100 }), (e) => e.status === 413);
  assert.equal(lidos, 0);
  assert.equal(cancelado, true);
});

test("audio times out and cancels a stalled upload with an absolute deadline", async () => {
  let cancelado = false;
  const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelado = true; } }, { highWaterMark: 0 });
  await assert.rejects(lerAudioLimitado(request(body), { bytes: 1024, prazoMs: 10 }), (e) => e instanceof AudioInvalido && e.status === 408);
  assert.equal(cancelado, true);
});
