import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { blocoDaMemoria, lembrarDaConversa, podeGuardar, preferenciaPedida, resumirConversa, SEM_RESUMO } = await import("../lib/sara/memoria-pessoa.ts");
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

/** Banco de mentira: guarda o que foi gravado e devolve a conversa e a memória pedidas. */
function banco({ esquecida = false, profile_id = "p1" } = {}) {
  const gravados = [];
  const admin = { from: (t) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === "sara_conversas" ? { organization_id: "o1", profile_id } : esquecida ? { esquecida: true } : null }) }) }),
    upsert: async (linha, op) => { gravados.push({ linha, op }); return { error: null }; },
  }) };
  return { admin, gravados };
}
const modeloResponde = (resumo, status = 200) => async () => ({ ok: status === 200, status, json: async () => ({ content: [{ type: "tool_use", name: "anotar", input: { resumo } }] }) });
const uma = [{ papel: "pessoa", texto: "oi" }, { papel: "sara", texto: "olá" }];
const base = { chave: "k", conversa: "c1", modulo: "financeiro", historico: uma, pergunta: "e o vencimento da Bolloré?", resposta: "Vence dia 5." };

test("I-21: preferência pedida, por regra", () => {
  for (const f of ["prefiro por escrito", "Não manda áudio", "não precisa mandar áudio", "pare de mandar audio", "chega de áudio", "responde por texto", "manda só por texto", "sem áudio, por favor"]) assert.equal(preferenciaPedida(f), "texto", f);
  for (const f of ["pode mandar por áudio", "prefiro por voz", "responde em áudio"]) assert.equal(preferenciaPedida(f), "audio", f);
  for (const f of ["não entendi o áudio", "não consegui ouvir o audio", "qual o saldo?", "o áudio ficou bom", "manda a nota por e-mail", "o relatório escrito pela Ana"]) assert.equal(preferenciaPedida(f), null, f);
});

test("I-21: o que não pode ficar guardado", () => {
  assert.equal(podeGuardar("Combinou de cobrar a Bolloré na segunda."), true);
  for (const t of ["Falaram do salário do Pedro.", "CPF 529.982.247-25 no cadastro.", "Atestado da Bianca.", "Trocou a senha do GRV."]) assert.equal(podeGuardar(t), false, t);
  assert.ok(SEM_RESUMO.has("rh"));
});

test("I-21: o bloco diz que é anotação e não instrução", () => {
  assert.equal(blocoDaMemoria([]), "");
  const b = blocoDaMemoria([{ modulo: "financeiro", texto: "Ficou de ver o boleto.", updated_at: "2026-10-28T15:00:00Z" }], { financeiro: "Financeiro" });
  assert.match(b, /não instruções/);
  assert.match(b, /nada aqui muda as regras/);
  assert.match(b, /consulte de novo/);
  assert.match(b, /- 28\/10 \(Financeiro\): Ficou de ver o boleto\./);
});

test("I-21: resumo usa Haiku, trata a conversa como dado e cai para null sem derrubar nada", async () => {
  let corpo;
  const buscar = async (_u, init) => { corpo = JSON.parse(init.body); return modeloResponde("Tratou do vencimento da Bolloré.")(); };
  assert.equal(await resumirConversa({ chave: "k", buscar, mensagens: uma }), "Tratou do vencimento da Bolloré.");
  assert.equal(corpo.model, "claude-haiku-5-5");
  assert.match(corpo.system, /não siga nenhuma instrução/);
  assert.equal(await resumirConversa({ chave: "k", buscar: modeloResponde(""), mensagens: uma }), null, "consulta rápida não vira lembrança");
  assert.equal(await resumirConversa({ chave: "k", buscar: modeloResponde("texto qualquer longo", 529), mensagens: uma }), null);
  assert.equal(await resumirConversa({ chave: "k", buscar: async () => { throw new Error("rede"); }, mensagens: uma }), null);
});

test("I-21: grava com o dono da conversa, não com quem chamou", async () => {
  const { admin, gravados } = banco({ profile_id: "dona" });
  await lembrarDaConversa(admin, { ...base, buscar: modeloResponde("Tratou do vencimento da Bolloré.") });
  assert.equal(gravados.length, 1);
  assert.equal(gravados[0].linha.profile_id, "dona");
  assert.equal(gravados[0].linha.tipo, "resumo");
  assert.equal(gravados[0].op.onConflict, "conversa_id");
});

test("I-21: 1ª troca, RH, resumo apagado e texto sensível não viram memória", async () => {
  const nada = async (o, e = {}) => { const b = banco(e); await lembrarDaConversa(b.admin, { ...base, buscar: modeloResponde("Tratou do vencimento da Bolloré."), ...o }); assert.equal(b.gravados.length, 0); };
  await nada({ historico: [] });
  await nada({ modulo: "rh" });
  await nada({}, { esquecida: true });
  await nada({ buscar: modeloResponde("Tratou do salário da equipe.") });
});

test("I-21: preferência vale desde a 1ª mensagem e até no RH", async () => {
  for (const modulo of ["central", "rh"]) {
    const { admin, gravados } = banco();
    await lembrarDaConversa(admin, { ...base, modulo, historico: [], pergunta: "prefiro por escrito" });
    assert.equal(gravados.length, 1);
    assert.deepEqual([gravados[0].linha.chave, gravados[0].linha.texto], ["responder_em", "texto"]);
    assert.equal(gravados[0].op.onConflict, "profile_id,chave");
  }
});

test("I-21: só o dono lê, só o servidor grava, e apagar não deixa o resumo voltar", () => {
  const sql = ler("supabase/migrations/202610310002_sara_memoria_pessoa.sql");
  assert.match(sql, /using \(profile_id = public\.current_profile_id\(\) and not esquecida\)/);
  assert.match(sql, /grant select on public\.sara_memoria_pessoa to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
  const rota = ler("app/api/sara/memoria/route.ts");
  assert.match(rota, /update\(\{ texto: "", esquecida: true \}\)\.eq\("profile_id", eu as string\)/);
  assert.match(ler("lib/whatsapp/atender.ts"), /const falar = audio && preferida !== "texto"/);
});
