import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { janelaDaVigia, mensagemDaVigia, PADRAO_VIGIA, textoDaAgenda, validarConfig } = await import("../lib/sara/central/vigia-config.ts");
const { janelaDoBomDia } = await import("../lib/sara/central/bom-dia.ts");
const { validarAvulso } = await import("../lib/whatsapp/avulso.ts");
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("vigia: o padrão é o de hoje, segunda a sexta às 6h30, só no sino", () => {
  assert.deepEqual(PADRAO_VIGIA, { dias: [1, 2, 3, 4, 5], hora: "06:30", whatsapp: false });
  assert.equal(textoDaAgenda(PADRAO_VIGIA), "de segunda a sexta, às 6h30");
});

test("vigia: o texto do painel acompanha a configuração", () => {
  assert.equal(textoDaAgenda({ dias: [1, 2, 3, 4, 5, 6], hora: "07:00" }), "de segunda a sábado, às 7h");
  assert.equal(textoDaAgenda({ dias: [1, 3, 5], hora: "06:45" }), "segunda, quarta e sexta, às 6h45");
  assert.equal(textoDaAgenda({ dias: [0, 1, 2, 3, 4, 5, 6], hora: "08:00" }), "todo dia, às 8h");
  assert.equal(textoDaAgenda({ dias: [2], hora: "09:15" }), "às terças, às 9h15");
  assert.equal(textoDaAgenda({ dias: [], hora: "06:30" }), "desligada (nenhum dia marcado)");
  assert.doesNotMatch(ler("modules/warroom/src/Vigia.tsx"), /segunda a sábado, às 6h30/, "sem texto fixo no painel");
});

test("vigia: a janela vem da configuração; sábado fora, nova hora vale", () => {
  const c = { dias: [1, 2, 3, 4, 5], hora: "08:00", whatsapp: true };
  const j = janelaDaVigia(c);
  assert.deepEqual(j, { dias: [1, 2, 3, 4, 5], hora: "08:00", ate: "11:30" });
  assert.equal(janelaDoBomDia(new Date("2026-11-03T07:50:00-03:00"), j), null, "antes da hora");
  assert.ok(janelaDoBomDia(new Date("2026-11-03T08:10:00-03:00"), j));
  assert.equal(janelaDoBomDia(new Date("2026-11-07T08:10:00-03:00"), j), null, "sábado");
  assert.equal(janelaDaVigia({ ...c, hora: "22:00" }).ate, "23:59");
  assert.match(ler("lib/sara/central/vigia-executar.ts"), /janelaDoBomDia\(agora, janelaDaVigia\(config\)\)/);
});

test("vigia: validação da tela", () => {
  assert.deepEqual(validarConfig({ dias: [5, 1, 1, 9, "3"], hora: "06:30", whatsapp: true }), { dias: [1, 3, 5], hora: "06:30", whatsapp: true });
  assert.match(validarConfig({ dias: [1], hora: "25:00" }).erro, /Hora/);
  assert.match(validarConfig({ hora: "06:30" }).erro, /dias/);
  assert.equal(validarConfig({ dias: [1], hora: "06:30", whatsapp: "sim" }).whatsapp, false);
});

test("vigia: a mensagem do WhatsApp tem só os gargalos dados e o link das Decisões", () => {
  const m = mensagemDaVigia({ nome: "Ana", dia: "2026-11-04", base: "https://home.pecsil.com.br", achados: [
    { area: "Financeiro", titulo: "12 contas vencidas", por_que: "Somam R$ 48.200,00.", impacto: "alto" }, { area: "Compras", titulo: "Pedidos parados", por_que: null, impacto: "medio" }] });
  assert.match(m, /^\*Vigia da SARA\* · 04\/11\/2026\nAna, 2 gargalos pedem a sua atenção/);
  assert.match(m, /• \*Financeiro\* \(impacto alto\): 12 contas vencidas\n  Somam R\$ 48\.200,00\./);
  assert.match(m, /https:\/\/home\.pecsil\.com\.br\/\?decisoes=1/);
  const muitos = mensagemDaVigia({ nome: "", dia: "2026-11-04", base: "x", achados: Array.from({ length: 11 }, (_, i) => ({ area: "A", titulo: `t${i}`, por_que: null, impacto: null })) });
  assert.match(muitos, /…e mais 3\./);
});

test("vigia: transmissão só para pessoas da empresa, só o que as credenciais enxergam, só o que é novo", () => {
  const v = ler("lib/sara/central/vigia-executar.ts");
  assert.match(v, /\.eq\("rodada_id", a\.rodada\)/, "só os gargalos novos desta rodada");
  assert.match(v, /\.eq\("lista", "interna"\)\.eq\("ativo", true\)\.eq\("profiles\.status", "active"\)/);
  assert.match(v, /x\.sinais\.every\(\(k\) => dela\.has\(tipoDaChave\(k\)\)\)/, "a mesma conferência das Decisões");
  assert.match(v, /if \(config\.whatsapp\) rel\.transmitidos/);
  const r = ler("app/api/foundation/whatsapp/route.ts");
  assert.match(r, /\.eq\("lista", "interna"\)\.not\("profile_id", "is", null\)/, "a lista de transmissão recusa externo");
  const sql = ler("supabase/migrations/202611030002_sara_vigia_config.sql");
  assert.match(sql, /default '\{1,2,3,4,5\}'/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
});

test("envio avulso: texto, destinos e horário conferidos", () => {
  const agora = Date.parse("2026-11-03T15:00:00Z");
  const um = "11111111-1111-1111-1111-111111111111";
  assert.deepEqual(validarAvulso({ contatos: [um, um], texto: "  Oi  " }, agora), { contatos: [um], texto: "Oi", quando: "2026-11-03T15:00:00.000Z" });
  assert.match(validarAvulso({ contatos: [um], texto: " " }, agora).erro, /Escreva/);
  assert.match(validarAvulso({ contatos: ["x"], texto: "a" }, agora).erro, /ao menos um/);
  assert.match(validarAvulso({ contatos: Array.from({ length: 31 }, (_, i) => `11111111-1111-1111-1111-${String(i).padStart(12, "0")}`), texto: "a" }, agora).erro, /30 números/);
  assert.match(validarAvulso({ contatos: [um], texto: "a", quando: "2026-11-03T14:00:00Z" }, agora).erro, /já passou/);
  assert.match(validarAvulso({ contatos: [um], texto: "a", quando: "2027-03-03T14:00:00Z" }, agora).erro, /60 dias/);
  assert.equal(validarAvulso({ contatos: [um], texto: "a", quando: "2026-11-04T10:00:00Z" }, agora).quando, "2026-11-04T10:00:00.000Z");
  assert.match(validarAvulso({ contatos: [um], texto: "x".repeat(4001) }, agora).erro, /4\.000/);
});
