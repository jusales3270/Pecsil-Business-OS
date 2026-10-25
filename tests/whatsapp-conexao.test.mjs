import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("conexão: caído é conferido de novo em 30 s antes de avisar; aviso no sino (não pelo WhatsApp), uma vez, e 'voltou' depois", () => {
  const c = ler("lib/whatsapp/conexao.ts");
  assert.match(c, /export const CAIDO: EstadoCanal\[\] = \["desconectado", "aguardando_qr", "sem_instancia", "fora_do_ar"\]/);
  assert.match(c, /await d\.esperar\(30_000\);\n\s+s = await d\.situacao\(c\.instancia\);/, "confere de novo antes de avisar");
  assert.match(c, /if \(caido && !avisouQueda\)/, "não repete o aviso de queda");
  assert.match(c, /else if \(!caido && avisouQueda\)/, "avisa que voltou só depois de uma queda avisada");
  assert.match(c, /from\("notifications"\)\.insert/);
  assert.doesNotMatch(c, /enviarTexto|enviarAudio/, "o aviso não vai pelo WhatsApp (é ele que está fora)");
  assert.match(c, /if \(s\.estado === "sem_configuracao"\) continue;/, "sem Evolution configurada (ambiente local) não avisa");
  assert.match(ler("scripts/sync-os-cron.mjs"), /"\/api\/whatsapp\/conexao\/vigiar"/);
  assert.match(ler("app/api/whatsapp/conexao/vigiar/route.ts"), /segredoConfere\(request\.headers\.get\("x-sync-secret"\)\)/);
});

test("central: envio de documento que já existia aparece com a prévia no cartão", () => {
  const r = ler("lib/sara/responder.ts");
  assert.match(r, /a\.ferramenta === "enviar_pelo_whatsapp"/);
  assert.match(r, /from\("sara_documentos"\)\.select\("id, numero, titulo, tipo, paginas"\)/, "com a sessão de quem pede (RLS dos documentos)");
  assert.match(r, /^\s+documentos,$/m);
});
