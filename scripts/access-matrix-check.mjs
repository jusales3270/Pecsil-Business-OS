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
  { name: "só Dados clínicos (ver)", grants: { "rh.clinico": "ver" } },
  { name: "só SST (ver)", grants: { "rh.sst": "ver" } },
  { name: "só OS da Produção (ver)", grants: { "producao.os": "ver" } },
  { name: "só Terceiros do RH (ver)", grants: { "rh.terceiros": "ver" } },
  { name: "só Sugestões da IA (ver)", grants: { "fundacao.sugestoes": "ver" } },
  { name: "só Coletar arquivos (operar)", grants: { "fundacao.coleta": "operar" } },
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
    absences: await total(admin, "rh_absences"),
    clinical: await total(admin, "rh_absence_clinical"),
    ppe: await total(admin, "rh_ppe_deliveries"),
    orders: await total(admin, "production_orders"),
    orderValues: await total(admin, "production_order_financials"),
    terceiros: await total(admin, "terceiros"),
  };
  console.log("Referência (service role):", reference);
  // Sem dado clínico no banco, "não vê nada" passaria por vazio: verde falso.
  check("referência", "há dado clínico para testar o isolamento", reference.clinical > 0, reference.clinical);
  check("referência", "há entrega de EPI para testar o acesso", reference.ppe > 0, reference.ppe);
  check("referência", "há OS espelhada, com valores, para testar o acesso", reference.orders > 0 && reference.orderValues > 0, `${reference.orders}/${reference.orderValues}`);
  check("referência", "há apontamentos de terceiros para testar o acesso", reference.terceiros > 0, reference.terceiros);

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
    // Dado clínico: só com rh.clinico, e escrever exige operar.
    const veClinico = "rh.clinico" in scenario.grants;
    const clinicos = await total(client, "rh_absence_clinical");
    check(n, veClinico ? "vê o dado clínico" : "não vê o dado clínico",
      clinicos === (veClinico ? reference.clinical : 0), clinicos);
    if ("rh.ferias" in scenario.grants) {
      check(n, "vê as ausências (sem o clínico)", (await total(client, "rh_absences")) === reference.absences, await total(client, "rh_absences"));
    }
    if (veClinico) {
      const { data: umClinico } = await admin.from("rh_absence_clinical").select("id, note").limit(1).single();
      await client.from("rh_absence_clinical").update({ note: "ALTERADO PELA MATRIZ" }).eq("id", umClinico.id);
      const { data: clinicoDepois } = await admin.from("rh_absence_clinical").select("note").eq("id", umClinico.id).single();
      check(n, "não altera dado clínico com Ver", clinicoDepois.note === umClinico.note, clinicoDepois.note === umClinico.note ? "mantido" : "ALTERADO");
    }

    // Ficha de EPI: lê com rh.sst; gravar exige operar.
    const veEpi = "rh.sst" in scenario.grants;
    const entregas = await total(client, "rh_ppe_deliveries");
    check(n, veEpi ? "vê as entregas de EPI" : "não vê entregas de EPI", entregas === (veEpi ? reference.ppe : 0), entregas);
    if (veEpi) {
      const { data: umaEntrega } = await admin.from("rh_ppe_deliveries").select("id, quantity").limit(1).single();
      await client.from("rh_ppe_deliveries").update({ quantity: umaEntrega.quantity + 99 }).eq("id", umaEntrega.id);
      const { data: depoisEpi } = await admin.from("rh_ppe_deliveries").select("quantity").eq("id", umaEntrega.id).single();
      check(n, "não altera entrega de EPI com Ver", depoisEpi.quantity === umaEntrega.quantity, depoisEpi.quantity === umaEntrega.quantity ? "mantida" : "ALTERADA");
    }

    // Espelho das OS: a OS para Produção, Financeiro e Comercial; o preço só
    // para Financeiro e Comercial; ninguém grava pela sessão.
    const veOs = ["producao.os", "financeiro.receber", "comercial.cobranca", "comercial.funil"].some((f) => f in scenario.grants);
    const veValores = ["financeiro.receber", "comercial.cobranca", "comercial.funil"].some((f) => f in scenario.grants);
    const osVistas = await total(client, "production_orders");
    check(n, veOs ? "vê as OS espelhadas" : "não vê OS espelhadas", osVistas === (veOs ? reference.orders : 0), osVistas);
    const valoresVistos = await total(client, "production_order_financials");
    check(n, veValores ? "vê os valores das OS" : "não vê os valores das OS", valoresVistos === (veValores ? reference.orderValues : 0), valoresVistos);
    if (veOs) {
      const { data: umaOs } = await admin.from("production_orders").select("id, status").limit(1).maybeSingle();
      if (umaOs) {
        await client.from("production_orders").update({ status: "ALTERADO_PELA_MATRIZ" }).eq("id", umaOs.id);
        const { data: osDepois } = await admin.from("production_orders").select("status").eq("id", umaOs.id).single();
        check(n, "não altera o espelho das OS", osDepois.status === umaOs.status, osDepois.status === umaOs.status ? "mantida" : "ALTERADA");
      } else {
        // Espelho ainda vazio (sincronização desligada): prova pela inserção.
        const { error: insertError } = await client.from("production_orders").insert({ external_id: "MATRIZ-TESTE", code: "MATRIZ", status: "ABERTA" });
        const { count } = await admin.from("production_orders").select("id", { count: "exact", head: true }).eq("external_id", "MATRIZ-TESTE");
        if (count) await admin.from("production_orders").delete().eq("external_id", "MATRIZ-TESTE");
        check(n, "não grava no espelho das OS", Boolean(insertError) && !count, insertError?.code ?? "GRAVOU");
      }
    }

    // Terceiros: a Portaria aponta; o RH (rh.terceiros) só lê.
    const veTerceiros = "rh.terceiros" in scenario.grants || "portaria.terceiros" in scenario.grants;
    const terceirosVistos = await total(client, "terceiros");
    check(n, veTerceiros ? "vê os apontamentos de terceiros" : "não vê apontamentos de terceiros", terceirosVistos === (veTerceiros ? reference.terceiros : 0), terceirosVistos);
    if ("rh.terceiros" in scenario.grants) {
      const { data: umTerceiro } = await admin.from("terceiros").select("id, nome").limit(1).single();
      await client.from("terceiros").update({ nome: "ALTERADO PELA MATRIZ" }).eq("id", umTerceiro.id);
      await client.from("terceiros").delete().eq("id", umTerceiro.id);
      const { data: terceiroDepois } = await admin.from("terceiros").select("nome").eq("id", umTerceiro.id).maybeSingle();
      check(n, "não altera nem apaga apontamento da Portaria", terceiroDepois?.nome === umTerceiro.nome, terceiroDepois ? (terceiroDepois.nome === umTerceiro.nome ? "mantido" : "ALTERADO") : "APAGADO");
      const novo = await client.from("terceiros").insert({ organization_id: org.id, nome: "Matriz", data: "2099-01-01", hora_entrada: "2099-01-01T07:00:00.000Z" });
      check(n, "não cria apontamento", Boolean(novo.error), novo.error?.code);
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

    // Modelo de decisão (Clef): configuração só do proprietário; auditoria só por função.
    check(n, "não lê a configuração dos usos da IA", (await total(client, "ai_uses")) === 0, await total(client, "ai_uses"));
    const { data: usoTeste } = await admin.from("ai_uses").select("id, enabled").eq("code", "fundacao.teste").limit(1).single();
    if (usoTeste) {
      await client.from("ai_uses").update({ enabled: !usoTeste.enabled }).eq("id", usoTeste.id);
      const { data: usoDepois } = await admin.from("ai_uses").select("enabled").eq("id", usoTeste.id).single();
      check(n, "não liga nem desliga uso da IA", usoDepois.enabled === usoTeste.enabled, usoDepois.enabled);
    }
    const julgamentos = await total(client, "ai_judgments");
    const veSugestoes = "fundacao.sugestoes" in scenario.grants;
    check(n, veSugestoes ? "lê sugestões da IA (só as do que pode ver)" : "não lê sugestões da IA",
      veSugestoes ? typeof julgamentos === "number" : julgamentos === 0, julgamentos);
    const falsa = await client.from("ai_judgments").insert({ organization_id: org.id, use_code: "fundacao.teste", feature_code: "fundacao.sugestoes", outcome: "aceita" });
    check(n, "não grava sugestão direto", Boolean(falsa.error), falsa.error?.code);
    const painel = await client.rpc("ai_use_stats", { p_days: 30 });
    check(n, "não abre o painel de uso da IA", Boolean(painel.error), painel.error?.code);

    // Documentos dos setores: escrita só pela função (com permissão); bucket sem acesso pelo cliente.
    const docFalso = await client.from("company_documents").insert({ organization_id: org.id, module_code: "fiscal", feature_code: "fiscal.icms", title: "x", original_name: "x", size_bytes: 1, sha256: "0".repeat(64), storage_path: `${org.id}/fiscal/x/x` });
    check(n, "não grava documento direto na tabela", Boolean(docFalso.error), docFalso.error?.code);
    const podeFiscal = (scenario.grants["fiscal.icms"] ?? "") === "operar";
    const regFiscal = await client.rpc("company_document_register", {
      p_module: "fiscal", p_feature: "fiscal.icms", p_title: "matriz", p_category: null, p_original_name: "matriz.txt", p_mime: "text/plain",
      p_size: 1, p_sha256: "f".repeat(64), p_storage_path: `${org.id}/fiscal/matriz/matriz.txt`, p_source: "envio",
    });
    if (!podeFiscal) check(n, "não registra documento no Fiscal sem permissão", regFiscal.error?.code === "42501", regFiscal.error?.code);
    // Coleta: aceites só do próprio; sem a funcionalidade, as funções são recusadas.
    const coleta = scenario.grants["fundacao.coleta"] === "operar";
    check(n, "não lê aceites de coleta de outras pessoas", (await total(client, "file_collection_consents")) === 0, await total(client, "file_collection_consents"));
    const hashes = await client.rpc("company_document_hashes_exist", { p_hashes: ["0".repeat(64)] });
    check(n, coleta ? "conferir repetidos responde só sim/não" : "sem Coletar arquivos não confere repetidos",
      coleta ? !hashes.error && Array.isArray(hashes.data) : hashes.error?.code === "42501", hashes.error?.code ?? JSON.stringify(hashes.data));
    if (!coleta) {
      const aceite = await client.rpc("file_collection_accept", { p_device_id: "00000000-0000-0000-0000-000000000000", p_device_name: "matriz", p_folder_name: "x" });
      check(n, "sem Coletar arquivos não registra aceite", aceite.error?.code === "42501", aceite.error?.code);
    }
    const aceiteDireto = await client.from("file_collection_consents").insert({ organization_id: org.id, profile_id: owner.id, device_id: "00000000-0000-0000-0000-000000000000", device_name: "x", folder_name: "x" });
    check(n, "não grava aceite direto na tabela", Boolean(aceiteDireto.error), aceiteDireto.error?.code);
    const bucket = await client.storage.from("empresa-documentos").list(org.id);
    check(n, "não lista o armazenamento de documentos pelo cliente", Boolean(bucket.error) || (bucket.data ?? []).length === 0, bucket.error?.message ?? (bucket.data ?? []).length);

    await client.auth.signOut();
  }

  // --- Colaborador: lê a própria ausência, não o clínico dela ----------------
  {
    const n = "colaborador sem permissão";
    const { data: comClinico } = await admin
      .from("rh_absence_clinical")
      .select("rh_absences!inner(employee_id, employees!inner(profile_id))")
      .is("rh_absences.employees.profile_id", null)
      .limit(1)
      .maybeSingle();
    const employeeId = comClinico?.rh_absences?.employee_id;
    check(n, "há colaborador sem login com dado clínico para o teste", Boolean(employeeId), employeeId ? "sim" : "NÃO");
    if (employeeId) {
      const email = `matriz.${randomBytes(4).toString("hex")}@pecsil-teste.local`;
      const password = randomBytes(18).toString("base64url") + "!9a";
      const { data: authUser, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (authError) throw authError;
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .insert({ user_id: authUser.user.id, organization_id: org.id, email, full_name: "Matriz colaborador", status: "active" })
        .select("id")
        .single();
      created.push({ userId: authUser.user.id, profileId: profile?.id, employeeId });
      if (profileError) throw profileError;
      // Vínculo temporário: desfeito no finally.
      await admin.from("employees").update({ profile_id: profile.id }).eq("id", employeeId);

      const client = createClient(URL_BASE, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
      const { error: loginError } = await client.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
      const proprias = await total(admin, "rh_absences", (q) => q.eq("employee_id", employeeId));
      const vistas = await total(client, "rh_absences");
      check(n, "vê só as próprias ausências", vistas === proprias && proprias > 0, `${vistas} de ${proprias}`);
      check(n, "não vê o clínico das próprias ausências", (await total(client, "rh_absence_clinical")) === 0, await total(client, "rh_absence_clinical"));
      const minhasEntregas = await total(admin, "rh_ppe_deliveries", (q) => q.eq("employee_id", employeeId));
      const entregasVistas = await total(client, "rh_ppe_deliveries");
      check(n, "vê só a própria ficha de EPI", entregasVistas === minhasEntregas, `${entregasVistas} de ${minhasEntregas}`);
      await client.auth.signOut();
    }
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

  // --- Férias: excluir ausência só com rh.ferias em "aprovar" -----------------
  {
    const n = "excluir ausência";
    const { data: alvo } = await admin.from("employees").select("id").eq("organization_id", org.id).limit(1).single();
    const nova = async () => (await admin.from("rh_absences").insert({ organization_id: org.id, employee_id: alvo.id, absence_type: "vacation", start_date: "2030-01-07", end_date: "2030-01-08", days: 2, status: "registered", reason: "matriz" }).select("id").single()).data.id;
    for (const nivel of ["operar", "aprovar"]) {
      const email = `matriz.${randomBytes(4).toString("hex")}@pecsil-teste.local`;
      const password = randomBytes(18).toString("base64url") + "!9a";
      const { data: authUser } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      const { data: profile } = await admin.from("profiles").insert({ user_id: authUser.user.id, organization_id: org.id, email, full_name: `Matriz férias ${nivel}`, status: "active" }).select("id").single();
      created.push({ userId: authUser.user.id, profileId: profile.id });
      await admin.from("user_feature_grants").insert({ organization_id: org.id, profile_id: profile.id, feature_code: "rh.ferias", level: nivel, granted_by: owner.id });
      const client = createClient(URL_BASE, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
      await client.auth.signInWithPassword({ email, password });
      const id = await nova();
      const { data: apagadas } = await client.from("rh_absences").delete().eq("id", id).select("id");
      const existe = Boolean((await admin.from("rh_absences").select("id").eq("id", id).maybeSingle()).data);
      if (existe) await admin.from("rh_absences").delete().eq("id", id);
      await admin.from("audit_logs").delete().eq("entity_id", id);
      check(n, nivel === "aprovar" ? "com aprovar: exclui" : "com operar: não exclui", nivel === "aprovar" ? !existe && apagadas?.length === 1 : existe, existe ? "mantida" : "excluída");
      await client.auth.signOut();
    }
  }

  // --- Administrativo: cargo obrigatório e protegido --------------------------
  {
    const n = "administrativo";
    const email = `matriz.${randomBytes(4).toString("hex")}@pecsil-teste.local`;
    const password = randomBytes(18).toString("base64url") + "!9a";
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw authError;
    const base = { user_id: authUser.user.id, organization_id: org.id, email, full_name: "Matriz administrativo", status: "active", account_type: "administrativo" };
    const { error: semCargo } = await admin.from("profiles").insert(base);
    check(n, "não nasce sem cargo", Boolean(semCargo), semCargo?.code ?? "gravou");
    const { error: cargoInvalido } = await admin.from("profiles").insert({ ...base, job_title: "presidente" });
    check(n, "não aceita cargo fora da lista", Boolean(cargoInvalido), cargoInvalido?.code ?? "gravou");
    const { data: profile, error: profileError } = await admin.from("profiles").insert({ ...base, job_title: "assistente" }).select("id").single();
    created.push({ userId: authUser.user.id, profileId: profile?.id });
    if (profileError) throw profileError;
    await admin.from("user_feature_grants").insert({
      organization_id: org.id, profile_id: profile.id, feature_code: "portaria.visitas", level: "ver", granted_by: owner.id,
    });
    const client = createClient(URL_BASE, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
    const { error: loginError } = await client.auth.signInWithPassword({ email, password });
    if (loginError) throw loginError;

    check(n, "vê o que foi liberado (visitas)", (await total(client, "visitas")) === reference.visitas, await total(client, "visitas"));
    check(n, "não vê o que não foi liberado (frota)", (await total(client, "frota")) === 0, await total(client, "frota"));

    await client.from("profiles").update({ job_title: "diretor", account_type: "colaborador" }).eq("id", profile.id);
    const { data: after } = await admin.from("profiles").select("job_title, account_type").eq("id", profile.id).single();
    check(n, "não muda o próprio cargo nem o tipo", after.job_title === "assistente" && after.account_type === "administrativo", `${after.account_type} · ${after.job_title}`);
    await client.auth.signOut();
  }
} finally {
  for (const { userId, profileId, employeeId } of created) {
    if (employeeId) await admin.from("employees").update({ profile_id: null }).eq("id", employeeId);
    if (profileId) await admin.from("module_events").delete().eq("entity_id", profileId);
    if (profileId) await admin.from("profiles").delete().eq("id", profileId);
    await admin.auth.admin.deleteUser(userId);
  }
  console.log(`Usuários temporários removidos: ${created.length}`);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações ok`);
process.exit(failed.length ? 1 : 0);
