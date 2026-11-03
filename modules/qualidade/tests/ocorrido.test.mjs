import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { horaDoOcorrido } from "../../../lib/sara/acoes-areas.ts";
import { qualidade } from "../../../lib/sara/agentes/qualidade.ts";

const agora = Date.parse("2026-11-03T15:00:00-03:00");

test("hora do ocorrido: Brasília, nunca no futuro nem de mais de um ano", () => {
  assert.deepEqual(horaDoOcorrido("2026-11-03T14:20", agora), { iso: "2026-11-03T14:20:00-03:00", texto: "03/11/2026 14:20" });
  assert.ok("erro" in horaDoOcorrido("", agora), "sem hora: a SARA pergunta");
  assert.ok("erro" in horaDoOcorrido("2026-11-03T16:00", agora), "futuro");
  assert.ok("iso" in horaDoOcorrido("2026-11-03T15:08", agora), "até 10 min à frente (relógio do celular)");
  assert.ok("erro" in horaDoOcorrido("2025-09-01T10:00", agora), "mais de um ano");
});

test("foto sem texto: a SARA da Qualidade oferece Registrar ou Descartar", async () => {
  const o = qualidade.sara.opcoesDaFoto ?? [];
  assert.deepEqual(o.map((x) => x.rotulo), ["Registrar não conformidade", "Descartar"]);
  assert.ok(o[0].pergunta && !o[0].rota);
  assert.equal(o[1].rota, "/api/qualidade/fotos/descartar");
  const mig = await readFile(new URL("../../../supabase/migrations/202611030003_qualidade_ocorrido_e_descarte.sql", import.meta.url), "utf8");
  // Descartar só as fotos pendentes da própria pessoa, naquela conversa.
  assert.match(mig, /autor_id = public\.current_profile_id\(\) and nc_id is null and conversa_id = p_conversa/);
  assert.match(mig, /qualidade_exigir\('operar'\)/);
});
