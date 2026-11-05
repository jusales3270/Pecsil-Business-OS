import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import "./ts-resolver.mjs";

const orgA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", orgB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const local = "11111111-1111-4111-8111-111111111111", foreign = "22222222-2222-4222-8222-222222222222", external = "33333333-3333-4333-8333-333333333333";
const state = globalThis.__pecsilVigiaTenantTest = {};
const stub = (code) => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
registerHooks({ resolve(s, c, next) {
  if (s === "server-only") return stub("export default {};");
  if (c.parentURL?.endsWith("/app/api/foundation/whatsapp/route.ts")) {
    if (s === "next/server") return stub("export const NextResponse={json:(data,options={})=>new Response(JSON.stringify(data),{status:options.status??200,headers:{'content-type':'application/json'}})};");
    if (s.endsWith("/auth/session-access")) return stub("export const readSessionAccess=async()=>({isOwner:true});");
    if (s.endsWith("/supabase/session")) return stub("export const requireUserSession=async()=>({supabase:globalThis.__pecsilVigiaTenantTest.session});");
    if (s.endsWith("/supabase/admin")) return stub("export const createSupabaseAdminClient=()=>globalThis.__pecsilVigiaTenantTest.admin;");
    if (s.endsWith("/whatsapp/confirmar")) return stub("export const registrarEnqueteDeTeste=async()=>{};");
  }
  return next(s, c);
} });
const { POST } = await import("../app/api/foundation/whatsapp/route.ts");

function setup() {
  state.writes = [];
  const contact = (id, org, lista = "interna") => ({ id, organization_id: org, lista, canal_id: `canal-${org}`, nome: "Contato", numero: "5511999999999", profile_id: lista === "interna" ? `perfil-${org}` : null, ativo: true,
    profiles: lista === "interna" ? { organization_id: org, status: "active", access_expires_at: null, full_name: "Pessoa" } : null,
    whatsapp_canais: { organization_id: org, ativo: true, conexao: "whatsapp_web" } });
  const tables = { whatsapp_contatos: [contact(local, orgA), contact(foreign, orgB), contact(external, orgA, "externa")], profiles: [{ id: "owner", organization_id: orgA, user_id: "user", full_name: "Owner" }] };
  const client = { rpc: async (n) => ({ data: n === "current_organization_id" ? orgA : "owner", error: null }), from(table) {
    let rows = tables[table] ?? [], operation;
    const field = (row, key) => key.split(".").reduce((o,k) => o?.[k], row);
    const q = {
      select() { return q; }, eq(k,v) { rows=rows.filter((r)=>field(r,k)===v);return q; },
      in(k,v) { rows=rows.filter((r)=>v.includes(field(r,k)));return q; },
      not(k, op, v) { if(op==="is") rows=rows.filter((r)=>field(r,k)!==v);return q; },
      or() { return q; }, order() { return q; }, limit() { return q; },
      upsert(v) { operation={table,kind:"upsert",values:v};return q; }, insert(v) { operation={table,kind:"insert",values:v};return q; }, delete() { operation={table,kind:"delete"};return q; },
      then(resolve,reject) { if(operation) state.writes.push(operation);return Promise.resolve({data:rows,error:null}).then(resolve,reject); },
      async maybeSingle() { return {data:rows[0]??null,error:null}; }, async single() { return {data:rows[0]??null,error:null}; },
    };
    return q;
  } };
  state.session=client;state.admin=client;
}
const call = (body) => POST(new Request("https://test.invalid/whatsapp",{method:"POST",body:JSON.stringify(body),headers:{"content-type":"application/json"}}));

test("owner cannot add another company's contact to Vigia broadcast membership", async () => {
  setup();
  const response=await call({acao:"salvar_vigia",config:{dias:[1],hora:"06:30",whatsapp:true},transmissao:[foreign]});
  assert.equal(response.status,400);
  assert.equal(state.writes.length,0,"deny before changing configuration or memberships");
});
test("owner cannot queue an ad hoc WhatsApp message to another company's contact", async () => {
  setup();
  const response=await call({acao:"enviar_avulso",contatos:[foreign],texto:"Hello"});
  assert.equal(response.status,400);
  assert.equal(state.writes.length,0);
});
test("local internal broadcast membership keeps its organization attribution", async () => {
  setup();
  const response=await call({acao:"salvar_vigia",config:{dias:[1],hora:"06:30",whatsapp:true},transmissao:[local]});
  assert.equal(response.status,200);
  assert.deepEqual(state.writes.find((w)=>w.table==="sara_vigia_transmissao"&&w.kind==="upsert").values,[{contato_id:local,organization_id:orgA}]);
});
test("ad hoc sends preserve local internal and external contact support", async () => {
  setup();
  const response=await call({acao:"enviar_avulso",contatos:[local,external],texto:"Hello"});
  assert.equal(response.status,200);
  const rows=state.writes.find((w)=>w.table==="whatsapp_agendados").values;
  assert.deepEqual(rows.map((r)=>r.contato_id),[local,external]);
  assert.ok(rows.every((r)=>r.organization_id===orgA));
});
test("missing organization context blocks administrative contact operations", async () => {
  setup();
  state.session={...state.session,rpc:async()=>({data:null,error:{message:"unavailable"}})};
  const response=await call({acao:"enviar_avulso",contatos:[local],texto:"Hello"});
  assert.equal(response.status,503);
  assert.equal(state.writes.length,0);
});

test("Vigia schedule reads use the explicit organization or the authenticated session", async () => {
  const { lerConfigVigia } = await import("../lib/sara/central/vigia-config.ts");
  const configs = { [orgA]: { dias: [1], hora: "06:30", whatsapp: false }, [orgB]: { dias: [2], hora: "10:00", whatsapp: true } };
  const sb = { rpc: async () => ({ data: orgA, error: null }), from() {
    let empresa;
    const q = { select() { return q; }, eq(k,v) { if(k==="organization_id")empresa=v;return q; }, limit() {return q;}, async maybeSingle() {return { data: configs[empresa] ?? null, error: null };} };
    return q;
  } };
  assert.deepEqual(await lerConfigVigia(sb),configs[orgA]);
  assert.deepEqual(await lerConfigVigia(sb,orgB),configs[orgB]);
});
