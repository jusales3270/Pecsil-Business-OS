import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_TENTATIVAS, proximaTentativa, proximoHorarioPermitido, silencioso } from "../lib/whatsapp/agendados-regras.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const br = (s) => new Date(`${s}-03:00`);

test("agendados: horário silencioso (20h–7h e domingo, horário de Brasília)", () => {
  assert.equal(silencioso(br("2026-10-26T07:30:00")), false, "segunda 7h30 sai");
  assert.equal(silencioso(br("2026-10-26T06:59:00")), true);
  assert.equal(silencioso(br("2026-10-26T20:00:00")), true);
  assert.equal(silencioso(br("2026-10-25T10:00:00")), true, "domingo");
  assert.equal(silencioso(br("2026-10-31T19:59:00")), false, "sábado à tarde sai");
});

test("agendados: o que cai no silêncio espera o próximo horário permitido (7h do próximo dia útil)", () => {
  assert.deepEqual(proximoHorarioPermitido(br("2026-10-26T07:30:00")), br("2026-10-26T07:30:00"), "permitido: não muda");
  assert.deepEqual(proximoHorarioPermitido(br("2026-10-26T05:00:00")), br("2026-10-26T07:00:00"), "madrugada de segunda: 7h do mesmo dia");
  assert.deepEqual(proximoHorarioPermitido(br("2026-10-26T21:00:00")), br("2026-10-27T07:00:00"), "segunda à noite: terça 7h");
  assert.deepEqual(proximoHorarioPermitido(br("2026-10-31T22:00:00")), br("2026-11-02T07:00:00"), "sábado à noite pula o domingo");
  assert.deepEqual(proximoHorarioPermitido(br("2026-11-01T09:00:00")), br("2026-11-02T07:00:00"), "domingo de manhã: segunda 7h");
  assert.equal(MAX_TENTATIVAS, 3);
  assert.equal(proximaTentativa(br("2026-10-26T07:30:00")).getTime() - br("2026-10-26T07:30:00").getTime(), 600_000);
});

test("agendados: só o servidor grava e pega; trava de uma vez só; tarefa de 10 em 10 minutos chama a rota com o segredo", () => {
  const m = ler("supabase/migrations/202610250005_whatsapp_agendados.sql");
  assert.match(m, /revoke insert, update, delete on public\.whatsapp_agendados from authenticated/);
  assert.match(m, /where id = p_id and situacao = 'agendado' and quando <= now\(\)/, "sai de 'agendado' uma vez só");
  assert.match(m, /revoke all on function public\.whatsapp_agendado_pegar\(uuid\) from public, anon, authenticated/);
  assert.match(ler("scripts/sync-os-cron.mjs"), /"\/api\/whatsapp\/agendados\/rodar"/);
  const rota = ler("app/api/whatsapp/agendados/rodar/route.ts");
  assert.match(rota, /segredoConfere\(request\.headers\.get\("x-sync-secret"\)\)/);
  const l = ler("lib/whatsapp/agendados.ts");
  assert.match(l, /if \(silencioso\(agora\)\)/);
  assert.match(l, /rpc\("whatsapp_agendado_pegar"/);
  assert.ok(l.indexOf("a.documentos.length") < l.indexOf("if (a.texto)"), "primeiro os arquivos (o áudio), depois o texto");
  const f = ler("app/api/foundation/whatsapp/route.ts");
  assert.match(f, /\.eq\("situacao", "agendado"\)\.select\("id, para_nome"\)/, "cancelar só o que ainda não saiu");
});
