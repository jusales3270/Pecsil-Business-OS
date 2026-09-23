#!/usr/bin/env node
/**
 * Matriz de acesso real (RLS): cria usuários temporários, cada um com uma
 * combinação de funcionalidades, loga com a sessão deles e confere o que o
 * banco deixa ler e gravar. Ao final remove os usuários, mesmo em falha.
 *
 *   SUPABASE_URL=http://host:8000 node scripts/access-matrix-check.mjs
 *
 * Lê SUPABASE_SERVICE_ROLE_KEY e NEXT_PUBLIC_SUPABASE_ANON_KEY do .env.local.
 * Nada é gravado em tabelas de negócio: as tentativas de escrita que DEVEM
 * passar não são feitas; só as que devem ser negadas.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const t = line.trim();
    const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i < 0) continue;
    const key = t.slice(0, i).trim();
    env[key] ??= t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const URL_BASE = env.SUPABASE_URL || env.SUPABASE_INTERNAL_URL;
if (!URL_BASE || !env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error("Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_BASE, env.SUPABASE_SERVICE_ROLE_KEY, opts);

const CASES = [
  { name: "só Férias (ver)", grants: { "rh.ferias": "ver" } },
  { name: "só Contas a pagar (aprovar)", grants: { "financeiro.pagar": "aprovar" } },
  { name: "só Visitas (operar)", grants: { "portaria.visitas": "operar" } },
  { name: "só Cotações (ver)", grants: { "compras.cotacoes": "ver" } },
  { name: "só Eventos (ver)", grants: { "fundacao.eventos": "ver" } },
  { name: "só Funil (ver)", grants: { "comercial.funil": "ver" } },
];

const { data: org } = await admin.from("organizations").select("id").limit(1).single();
const { data: owner } = await admin.from("profiles").select("id").eq("is_owner", true).eq("status", "active").limit(1).single();

async function total(client, table, filter) {
  let query = client.from(table).select("*", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  return error ? `erro: ${error.message}` : count;
}

const created = [];
const results = [];
function check(caseName, label, ok, detail) {
  results.push({ caseName, label, ok, detail });
  console.log(`${ok ? "✔" : "✖"} [${caseName}] ${label}${detail !== undefined ? ` → ${detail}` : ""}`);
}

try {
  const reference = {
    employees: await total(admin, "employees"),
    personal: await total(admin, "rh_employee_personal_data"),
    cotacoes: await total(admin, "cotacoes"),
    compras: await total(admin, "compras"),
    visitas: await total(admin, "visitas"),
    frota: await total(admin, "frota"),
    grants: await total(admin, "user_feature_grants"),
    titlesPayable: await total(admin, "finance_titles", (q) => q.eq("direction", "payable")),
    titlesReceivable: await total(admin, "finance_titles", (q) => q.eq("direction", "receivable")),
    stages: await total(admin, "crm_stages"),
    cards: await total(admin, "crm_cards"),
  };
  console.log("Referência (service role):", reference);

  for (const scenario of CASES) {
    const email = `matriz.${randomBytes(4).toString("hex")}@pecsil-teste.local`;
    const password = randomBytes(18).toString("base64url") + "!9a";
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw authError;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .insert({ user_id: authUser.user.id, organization_id: org.id, email, full_name: `Matriz ${scenario.name}`, status: "active" })
      .select("id")
      .single();
    created.push({ userId: authUser.user.id, profileId: profile?.id });
    if (profileError) throw profileError;
    const { error: grantError } = await admin.from("user_feature_grants").insert(
      Object.entries(scenario.grants).map(([feature_code, level]) => ({
        organization_id: org.id, profile_id: profile.id, feature_code, level, granted_by: owner.id,
      })),
    );
    if (grantError) throw grantError;

    const client = createClient(URL_BASE, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
    const { error: loginError } = await client.auth.signInWithPassword({ email, password });
    if (loginError) throw loginError;
    const n = scenario.name;

    // Comum a todos: só vê as próprias permissões e não se concede nada.
    check(n, "lê só as próprias permissões", (await total(client, "user_feature_grants")) === Object.keys(scenario.grants).length, await total(client, "user_feature_grants"));
    const selfGrant = await client.from("user_feature_grants").insert({ organization_id: org.id, profile_id: profile.id, feature_code: "rh.sst", level: "aprovar" });
    check(n, "não concede permissão a si mesmo", Boolean(selfGrant.error), selfGrant.error?.code);
    const { data: isOwner } = await client.rpc("is_owner");
    check(n, "não é proprietário", isOwner === false, isOwner);

    const hasRh = Object.keys(scenario.grants).some((code) => code.startsWith("rh."));
    check(n, hasRh ? "vê colaboradores (tem RH)" : "não vê colaboradores (sem RH)",
      hasRh ? (await total(client, "employees")) === reference.employees : (await total(client, "employees")) === 0,
      await total(client, "employees"));
    check(n, "não lê dados pessoais (CPF/PIS)", (await total(client, "rh_employee_personal_data")) === 0, await total(client, "rh_employee_personal_data"));

    const hasCompras = Object.keys(scenario.grants).some((code) => code.startsWith("compras."));
    check(n, hasCompras ? "vê cotações" : "não vê cotações",
      (await total(client, "cotacoes")) === (hasCompras ? reference.cotacoes : 0), await total(client, "cotacoes"));

    const payable = await total(client, "finance_titles", (q) => q.eq("direction", "payable"));
    const receivable = await total(client, "finance_titles", (q) => q.eq("direction", "receivable"));
    const pagar = "financeiro.pagar" in scenario.grants;
    check(n, pagar ? "vê títulos a pagar" : "não vê títulos a pagar", payable === (pagar ? reference.titlesPayable : 0), payable);
    check(n, "não vê títulos a receber", receivable === 0, receivable);

    const visitas = "portaria.visitas" in scenario.grants;
    check(n, visitas ? "vê visitas" : "não vê visitas", (await total(client, "visitas")) === (visitas ? reference.visitas : 0), await total(client, "visitas"));
    check(n, "não vê frota", (await total(client, "frota")) === 0, await total(client, "frota"));

    if (visitas) {
      // Excluir exige Gerenciar: com Operar o DELETE não remove nada.
      const { data: one } = await admin.from("visitas").select("id").limit(1).maybeSingle();
      if (one) {
        await client.from("visitas").delete().eq("id", one.id);
        const still = await admin.from("visitas").select("id").eq("id", one.id).maybeSingle();
        check(n, "não exclui visita (Operar < Gerenciar)", Boolean(still.data), still.data ? "mantida" : "EXCLUÍDA");
      }
    }
    if ("rh.ferias" in scenario.grants) {
      const holiday = await client.from("rh_holidays").insert({ organization_id: org.id, holiday_date: "2099-01-01", name: "Teste matriz", scope: "nacional", day_off: true, source: "matriz" });
      check(n, "não edita feriados", Boolean(holiday.error), holiday.error?.code);
    }
    if (hasCompras) {
      const quote = await client.from("cotacoes").insert({ organization_id: org.id, fornecedor: "Teste matriz", divisao: "USINAGEM", status: "PENDENTE", user_id: "1" });
      check(n, "não cria cotação com Ver", Boolean(quote.error), quote.error?.code);
    }
    // Funil do CRM: quem só VÊ não cria nem move card.
    const veFunil = "comercial.funil" in scenario.grants;
    const etapas = await total(client, "crm_stages");
    check(n, veFunil ? "vê as etapas do funil" : "não vê as etapas do funil",
      veFunil ? etapas === reference.stages : etapas === 0, etapas);
    check(n, veFunil ? "vê os cards do funil" : "não vê os cards do funil",
      (await total(client, "crm_cards")) === (veFunil ? reference.cards : 0), await total(client, "crm_cards"));
    if (veFunil) {
      const { data: primeiraEtapa } = await admin.from("crm_stages").select("id").eq("organization_id", org.id).order("position").limit(1).single();
      const novoCard = await client.from("crm_cards").insert({
        organization_id: org.id, stage_id: primeiraEtapa.id, title: "Card da matriz", position: 1,
      });
      check(n, "não cria card com Ver", Boolean(novoCard.error), novoCard.error?.code);
      if (reference.cards > 0) {
        const { data: algum } = await admin.from("crm_cards").select("id, stage_id").limit(1).single();
        await client.from("crm_cards").update({ stage_id: primeiraEtapa.id }).eq("id", algum.id);
        const { data: depois } = await admin.from("crm_cards").select("stage_id").eq("id", algum.id).single();
        check(n, "não move card com Ver", depois.stage_id === algum.stage_id, depois.stage_id === algum.stage_id ? "parado" : "MOVEU");
      }
    }

    // Trilha de eventos e cadastros mestres.
    const events = await total(client, "module_events");
    const seesEvents = "fundacao.eventos" in scenario.grants;
    check(n, seesEvents ? "lê a trilha de eventos" : "não lê a trilha de eventos",
      seesEvents ? typeof events === "number" && events > 0 : events === 0, events);
    const fakeEvent = await client.from("module_events").insert({
      organization_id: org.id, module_code: "rh", event_type: "rh.colaborador.desligado", entity_type: "colaborador", summary: "falso",
    });
    check(n, "não insere evento direto", Boolean(fakeEvent.error), fakeEvent.error?.code);
    check(n, "lê fornecedores (cadastro comum)", (await total(client, "suppliers")) > 0, await total(client, "suppliers"));
    const { data: anySupplier } = await admin.from("suppliers").select("id, name").limit(1).single();
    await client.from("suppliers").update({ name: "ALTERADO PELA MATRIZ" }).eq("id", anySupplier.id);
    const { data: supplierAfter } = await admin.from("suppliers").select("name").eq("id", anySupplier.id).single();
    check(n, "não edita fornecedor sem Cadastros", supplierAfter.name === anySupplier.name, supplierAfter.name);
    const merge = await client.rpc("merge_suppliers", { keep_id: anySupplier.id, drop_id: anySupplier.id });
    check(n, "não unifica fornecedores sem Cadastros", Boolean(merge.error), merge.error?.code);

    await client.auth.signOut();
  }

  // --- Terceiro: validade vale no banco -------------------------------------
  {
    const n = "terceiro com validade";
    const email = `matriz.${randomBytes(4).toString("hex")}@pecsil-teste.local`;
    const password = randomBytes(18).toString("base64url") + "!9a";
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw authError;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .insert({
        user_id: authUser.user.id, organization_id: org.id, email, full_name: "Matriz terceiro", status: "active",
        account_type: "terceiro", company_name: "Prestadora Teste", access_expires_at: future,
      })
      .select("id")
      .single();
    created.push({ userId: authUser.user.id, profileId: profile?.id });
    if (profileError) throw profileError;
    await admin.from("user_feature_grants").insert({
      organization_id: org.id, profile_id: profile.id, feature_code: "portaria.visitas", level: "ver", granted_by: owner.id,
    });
    const client = createClient(URL_BASE, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
    const { error: loginError } = await client.auth.signInWithPassword({ email, password });
    if (loginError) throw loginError;

    check(n, "dentro da validade vê visitas", (await total(client, "visitas")) === reference.visitas, await total(client, "visitas"));
    check(n, "não vê frota", (await total(client, "frota")) === 0, await total(client, "frota"));

    await client.from("profiles").update({ access_expires_at: null, account_type: "colaborador" }).eq("id", profile.id);
    const { data: after } = await admin.from("profiles").select("access_expires_at, account_type").eq("id", profile.id).single();
    check(n, "não estende a própria validade nem vira colaborador",
      after.access_expires_at !== null && after.account_type === "terceiro", `${after.account_type} · ${after.access_expires_at}`);

    await admin.from("profiles").update({ access_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", profile.id);
    check(n, "vencido: não vê mais visitas", (await total(client, "visitas")) === 0, await total(client, "visitas"));
    const { data: currentProfile } = await client.rpc("current_profile_id");
    check(n, "vencido: sem perfil corrente", currentProfile === null, currentProfile);
    check(n, "vencido: lê zero permissões", (await total(client, "user_feature_grants")) === 0, await total(client, "user_feature_grants"));

    await admin.from("profiles").update({ access_expires_at: future }).eq("id", profile.id);
    check(n, "renovado: volta a ver visitas", (await total(client, "visitas")) === reference.visitas, await total(client, "visitas"));
    await client.auth.signOut();
  }
} finally {
  for (const { userId, profileId } of created) {
    if (profileId) await admin.from("module_events").delete().eq("entity_id", profileId);
    if (profileId) await admin.from("profiles").delete().eq("id", profileId);
    await admin.auth.admin.deleteUser(userId);
  }
  console.log(`Usuários temporários removidos: ${created.length}`);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações ok`);
process.exit(failed.length ? 1 : 0);
