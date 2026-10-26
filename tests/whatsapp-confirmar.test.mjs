import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inicioDoDia, LIBERADAS_PELO_PROPRIETARIO, PODE_PELO_WHATSAPP, perguntaDaEnquete, podeVirarEnquete } from "../lib/whatsapp/confirmar-regras.ts";
import { complementoEscrito, lerMensagem } from "../lib/whatsapp/mensagem.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const acao = (x = {}) => ({ id: "a1", organization_id: "o", modulo: "ti", ferramenta: "abrir_chamado_ti", resumo: "Abrir chamado de TI: impressora", risco: "normal", situacao: "pendente",
  expira_em: new Date(Date.now() + 600_000).toISOString(), profile_id: "p1", ...x });
const base = { perfil: "p1", liberada: { ate_por_dia: 3 }, usadasHoje: 0, temAberta: false };

test("confirmar pelo WhatsApp: só ação liberada pela área, normal, pendente, da própria pessoa, dentro do limite e uma enquete por vez", () => {
  assert.deepEqual(podeVirarEnquete(acao(), base), { ok: true });
  assert.deepEqual(podeVirarEnquete(acao(), { ...base, liberada: null }), { ok: false, motivo: "nao_liberada" }, "o padrão é nada liberado");
  assert.deepEqual(podeVirarEnquete(acao({ ferramenta: "pedir_material" }), base), { ok: false, motivo: "nao_liberada" });
  assert.deepEqual(podeVirarEnquete(acao({ risco: "alto" }), base), { ok: false, motivo: "risco_alto" });
  assert.deepEqual(podeVirarEnquete(acao({ situacao: "permitida" }), base), { ok: false, motivo: "nao_pendente" });
  assert.deepEqual(podeVirarEnquete(acao({ expira_em: new Date(Date.now() - 1000).toISOString() }), base), { ok: false, motivo: "nao_pendente" });
  assert.deepEqual(podeVirarEnquete(acao({ profile_id: "p2" }), base), { ok: false, motivo: "outra_pessoa" });
  assert.deepEqual(podeVirarEnquete(acao(), { ...base, usadasHoje: 3 }), { ok: false, motivo: "limite_do_dia" });
  assert.deepEqual(podeVirarEnquete(acao(), { ...base, temAberta: true }), { ok: false, motivo: "ja_tem_enquete" });
});

test("envio pelo WhatsApp (SARA central): enquete sem o quadro das áreas, só para dentro da empresa e até 20 por dia", () => {
  const envio = acao({ modulo: "warroom", ferramenta: "enviar_pelo_whatsapp", resumo: "Enviar pelo WhatsApp para Ana" });
  assert.deepEqual(podeVirarEnquete(envio, { ...base, liberada: null }), { ok: true }, "liberada pelo proprietário, não pela área");
  assert.deepEqual(podeVirarEnquete({ ...envio, risco: "alto" }, { ...base, liberada: null }), { ok: false, motivo: "risco_alto" }, "contato externo segue o Permitir");
  assert.deepEqual(podeVirarEnquete(envio, { ...base, liberada: null, usadasHoje: 19 }), { ok: true });
  assert.deepEqual(podeVirarEnquete(envio, { ...base, liberada: null, usadasHoje: 20 }), { ok: false, motivo: "limite_do_dia" });
  assert.equal(LIBERADAS_PELO_PROPRIETARIO.enviar_pelo_whatsapp.ate_por_dia, 20);
});

test("envio pelo WhatsApp: quem usa a SARA central (não só o proprietário) e, para a própria pessoa, entrega direta", () => {
  const enviar = ler("lib/whatsapp/enviar.ts"), atender = ler("lib/whatsapp/atender.ts");
  assert.doesNotMatch(enviar, /is_owner/, "a trava é a SARA central, não o proprietário");
  assert.match(enviar, /canModule\("warroom"\) && access\.can\("warroom\.sara", "ver"\)/);
  assert.match(atender, /destino\?\.lista === "interna" && destino\.perfil === perfil/, "direto só para a própria pessoa, na lista interna");
  assert.match(atender, /executarAcao\(s\.sb, p, id, true\)/, "a mesma trilha do Permitir");
});

test("confirmar pelo WhatsApp: a lista do código é a mesma do banco, e dinheiro, material, convite e envio para fora nunca entram", () => {
  const sql = ler("supabase/migrations/202610250001_whatsapp_confirmar.sql");
  const doBanco = Object.fromEntries([...sql.matchAll(/\('([a-z_]+)', '([a-z]+)'\)/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(doBanco, Object.fromEntries(Object.entries(PODE_PELO_WHATSAPP).map(([n, x]) => [n, x.modulo])));
  for (const nunca of ["pedir_material", "pedir_material_fundicao", "convidar_fornecedor", "encaminhar_para_cotar", "pendencia_para_o_escritorio", "enviar_pelo_whatsapp"]) assert.ok(!PODE_PELO_WHATSAPP[nunca], nunca);
  assert.match(sql, /has_feature\(dono \|\| '\.sara', 'aprovar'\)/, "decide quem aprova a SARA da área dona da ação");
  assert.match(sql, /revoke insert, update, delete on public\.whatsapp_enquetes from authenticated/);
});

test("enquete: pergunta curta, voto com a enquete de origem e o aviso de que só o primeiro voto conta", () => {
  assert.equal(perguntaDaEnquete("Abrir chamado de TI: impressora sem papel."), "Confirma? Abrir chamado de TI: impressora sem papel.");
  assert.ok(perguntaDaEnquete("x".repeat(400)).length <= 240);
  const v = lerMensagem({ event: "messages.upsert", instance: "pecsil-interno", data: { key: { remoteJid: "5515912345678@s.whatsapp.net", fromMe: false, id: "VOTO1" },
    message: { pollUpdateMessage: { pollCreationMessageKey: { id: "POLL1", remoteJid: "5515912345678@s.whatsapp.net" }, vote: { selectedOptions: ["Sim"] } } } } });
  assert.deepEqual(v.escolha, { forma: "enquete", id: null, texto: "Sim", enquete: { waId: "POLL1", jid: "5515912345678@s.whatsapp.net" } });
  assert.match(complementoEscrito({ acoesPendentes: 1, visuais: 0, linkSara: "L", enquete: true }), /^Confirme na enquete abaixo \(vale 15 minutos; só o primeiro voto conta\)\. Se preferir, pelo Permitir na plataforma: L$/);
  assert.equal(inicioDoDia(new Date("2026-10-25T02:30:00Z")), "2026-10-24T03:00:00.000Z", "23h30 de Brasília ainda é o dia 24");
});

test("voto: primeiro vale (update só de 'aberta'), enquete apagada, silêncio no repetido e antes de 'lida' e 'digitando'", () => {
  const c = ler("lib/whatsapp/confirmar.ts");
  assert.match(c, /\.eq\("situacao", "aberta"\)\.gt\("expira_em", agora\)/);
  assert.match(c, /if \(x\.situacao !== "aberta"\) return ignorar\("voto_repetido"\)/);
  assert.match(c, /if \(!e\.texto\) return ignorar\("voto_retirado"\)/);
  assert.match(c, /await apagar\(\);\n  if \(!ganhou\.acao_id\)/);
  assert.match(c, /sara_acao_decidir/); assert.match(c, /sara_acao_concluir/);
  const a = ler("lib/whatsapp/atender.ts");
  assert.ok(a.indexOf('m.escolha?.forma === "enquete"') < a.indexOf("await d.marcarLida("), "voto tratado antes de marcar como lida");
  assert.ok(a.indexOf('m.escolha?.forma === "enquete"') > a.indexOf('return ignorar("fora_da_lista")'), "fora da lista continua em silêncio");
  assert.match(ler("app/api/foundation/whatsapp/route.ts"), /registrarEnqueteDeTeste/);
});

test("pelo WhatsApp a SARA não fala de cartão: a plataforma diz como confirmar (enquete ou link)", () => {
  const r = ler("lib/sara/responder.ts");
  assert.equal(r.match(/sem falar de cartão nem de Permitir: a plataforma manda logo depois como confirmar/g)?.length, 2, "na regra de texto e na de áudio");
});
