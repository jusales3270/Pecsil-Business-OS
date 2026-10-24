import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../lib/auth/session-access";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../../lib/supabase/session";
import { boasVindas, sarasDoUsuario, validarExterno, validarInterno } from "../../../../../lib/whatsapp/contatos";
import { enviarTexto, numeroLegivel } from "../../../../../lib/whatsapp/evolution";
import { SARA_OPCOES } from "../../../../../lib/whatsapp/saras";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fundação › WhatsApp: as listas de cada número da plataforma (interna e externa). Só o proprietário (o RLS das
 * tabelas também só deixa ele). GET ?canal=: as listas do canal e os usuários com as SARAs que cada um pode usar;
 * GET ?busca=&tipo=: fornecedor ou cliente para o vínculo. POST: salvar, ativar/desativar, remover e boas-vindas.
 * Tudo na auditoria, com só os 4 últimos dígitos do número.
 */
const UUID = /^[0-9a-f-]{36}$/i;

async function dono() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access?.isOwner) return { erro: NextResponse.json({ error: "As listas do WhatsApp são do proprietário." }, { status: 403 }) } as const;
  return { sb: session.supabase as SupabaseClient } as const;
}

async function auditar(sb: SupabaseClient, evento: string, metadata: Record<string, unknown>) {
  try {
    const { data: perfil } = await sb.rpc("current_profile_id");
    const { data: p } = perfil ? await sb.from("profiles").select("id, organization_id, user_id").eq("id", perfil).maybeSingle() : { data: null };
    if (!p) return;
    const { error } = await createSupabaseAdminClient().from("audit_logs").insert({ organization_id: p.organization_id, actor_user_id: p.user_id, actor_profile_id: p.id,
      module_code: "core.whatsapp", event_type: evento, entity_type: "whatsapp_contato", entity_id: typeof metadata.id === "string" && UUID.test(metadata.id) ? metadata.id : null, risk_level: "monitored", metadata });
    if (error) console.error("[whatsapp] auditoria", error.message);
  } catch (e) { console.error("[whatsapp] auditoria", e instanceof Error ? e.message : e); }
}

/** Usuários ativos com as SARAs que a credencial de cada um libera (lidos pelo servidor: o RLS de profiles esconde). */
async function usuarios() {
  const admin = createSupabaseAdminClient();
  const [{ data: perfis }, { data: grants }] = await Promise.all([
    admin.from("profiles").select("id, full_name, email, is_owner, access_expires_at").eq("status", "active").order("full_name"),
    admin.from("user_feature_grants").select("profile_id, feature_code").like("feature_code", "%.sara"),
  ]);
  const por = new Map<string, Set<string>>();
  for (const g of (grants ?? []) as { profile_id: string; feature_code: string }[]) (por.get(g.profile_id) ?? por.set(g.profile_id, new Set()).get(g.profile_id)!).add(g.feature_code);
  const agora = Date.now();
  return ((perfis ?? []) as { id: string; full_name: string | null; email: string | null; is_owner: boolean; access_expires_at: string | null }[])
    .filter((p) => !p.access_expires_at || Date.parse(p.access_expires_at) > agora)
    .map((p) => ({ id: p.id, nome: p.full_name || p.email || "sem nome", saras: sarasDoUsuario(SARA_OPCOES, por.get(p.id) ?? new Set(), p.is_owner).map((s) => s.modulo) }));
}

export async function GET(request: Request) {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const q = new URL(request.url).searchParams;
  const busca = q.get("busca")?.replace(/[%_,()]/g, " ").trim().slice(0, 60);
  // Busca no cadastro (vínculo do contato externo): até 8 fornecedores ou clientes pelo nome ou CNPJ.
  if (busca && busca.length >= 2) {
    const digitos = /^[\d.\-/\s]+$/.test(busca) ? busca.replace(/\D/g, "") : "";
    if (q.get("tipo") === "cliente") {
      const { data } = await d.sb.from("customers").select("id, name, tax_id").eq("active", true).is("merged_into", null)
        .or(`name.ilike.%${busca}%${digitos.length >= 4 ? `,tax_id.ilike.%${digitos}%` : ""}`).order("name").limit(8);
      return NextResponse.json({ achados: (data ?? []).map((c) => ({ id: c.id, nome: c.name, documento: c.tax_id })) });
    }
    const { data } = await d.sb.from("suppliers").select("id, name, trade_name, tax_id").eq("active", true).is("merged_into", null)
      .or(`name.ilike.%${busca}%,trade_name.ilike.%${busca}%${digitos.length >= 4 ? `,tax_id.ilike.%${digitos}%` : ""}`).order("name").limit(8);
    return NextResponse.json({ achados: (data ?? []).map((s) => ({ id: s.id, nome: s.trade_name?.trim() || s.name, documento: s.tax_id })) });
  }
  const canal = q.get("canal") ?? "";
  if (!UUID.test(canal)) return NextResponse.json({ error: "Escolha o número da plataforma." }, { status: 400 });
  const [{ data: contatos, error }, lista] = await Promise.all([
    d.sb.from("whatsapp_contatos").select("id, lista, numero, profile_id, nome, categoria, ativo, observacao, created_at, suppliers(name, trade_name), customers(name)").eq("canal_id", canal).order("created_at"),
    usuarios(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const nomes = new Map(lista.map((u) => [u.id, u]));
  type Linha = { id: string; lista: string; numero: string; profile_id: string | null; nome: string | null; categoria: string | null; ativo: boolean; observacao: string | null;
    suppliers: { name: string; trade_name: string | null } | null; customers: { name: string } | null };
  const linhas = ((contatos ?? []) as unknown as Linha[]).map((c) => {
    const u = c.profile_id ? nomes.get(c.profile_id) : null;
    return { id: c.id, lista: c.lista, numero: c.numero, numeroLegivel: numeroLegivel(c.numero), ativo: c.ativo, observacao: c.observacao,
      usuario: c.profile_id ? { id: c.profile_id, nome: u?.nome ?? "usuário inativo", ativo: Boolean(u) } : null,
      nome: c.nome, categoria: c.categoria, vinculo: c.suppliers ? (c.suppliers.trade_name?.trim() || c.suppliers.name) : c.customers?.name ?? null };
  });
  return NextResponse.json({ interna: linhas.filter((x) => x.lista === "interna"), externa: linhas.filter((x) => x.lista === "externa"), usuarios: lista }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const e = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const acao = String(e.acao ?? "");
  const id = String(e.id ?? "");
  const repetido = (msg: string) => (/whatsapp_contatos_numero_unico/.test(msg) ? "Este número já está numa das listas deste WhatsApp." : msg);

  if (acao === "salvar") {
    const canalId = String(e.canal ?? "");
    const { data: canal } = UUID.test(canalId) ? await d.sb.from("whatsapp_canais").select("id, organization_id, sara_modulo").eq("id", canalId).maybeSingle() : { data: null };
    if (!canal) return NextResponse.json({ error: "Escolha o número da plataforma." }, { status: 400 });
    const lista = e.lista === "externa" ? "externa" : "interna";
    let dados: Record<string, unknown>;
    if (lista === "interna") {
      const u = (await usuarios()).find((x) => x.id === e.profile_id);
      if (!u) return NextResponse.json({ error: "Usuário não encontrado ou inativo." }, { status: 400 });
      if (!canal.sara_modulo) return NextResponse.json({ error: "Escolha antes a SARA responsável por este número." }, { status: 400 });
      const v = validarInterno(e, u.saras.includes(canal.sara_modulo));
      if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
      dados = v;
    } else {
      const v = validarExterno(e);
      if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
      dados = v;
    }
    const { data: eu } = await d.sb.rpc("current_profile_id");
    const q = UUID.test(id)
      ? d.sb.from("whatsapp_contatos").update(dados).eq("id", id).eq("canal_id", canal.id).select("id").single()
      : d.sb.from("whatsapp_contatos").insert({ ...dados, canal_id: canal.id, organization_id: canal.organization_id, criado_por: eu }).select("id").single();
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: repetido(error.message) }, { status: 400 });
    await auditar(d.sb, UUID.test(id) ? "whatsapp.contato_alterado" : "whatsapp.contato_incluido", { id: data.id, canal: canal.id, lista, numero: `…${String(dados.numero).slice(-4)}` });
    return NextResponse.json({ ok: true, id: data.id });
  }
  if (!UUID.test(id)) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
  const { data: c } = await d.sb.from("whatsapp_contatos").select("id, lista, numero, profile_id, ativo, canal_id, whatsapp_canais(instancia, nome, sara_modulo, conexao)").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
  const canal = c.whatsapp_canais as unknown as { instancia: string; nome: string; sara_modulo: string | null; conexao: string } | null;

  if (acao === "ativar" || acao === "desativar") {
    const { error } = await d.sb.from("whatsapp_contatos").update({ ativo: acao === "ativar" }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await auditar(d.sb, `whatsapp.contato_${acao === "ativar" ? "ativado" : "desativado"}`, { id, canal: c.canal_id, lista: c.lista, numero: `…${c.numero.slice(-4)}` });
    return NextResponse.json({ ok: true });
  }
  if (acao === "remover") {
    const { error } = await d.sb.from("whatsapp_contatos").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await auditar(d.sb, "whatsapp.contato_removido", { id, canal: c.canal_id, lista: c.lista, numero: `…${c.numero.slice(-4)}` });
    return NextResponse.json({ ok: true });
  }
  if (acao === "boas_vindas") {
    if (c.lista !== "interna" || !c.ativo || !canal || canal.conexao !== "whatsapp_web") return NextResponse.json({ error: "Boas-vindas só para número ativo da lista interna, num WhatsApp conectado pelo QR." }, { status: 400 });
    const u = (await usuarios()).find((x) => x.id === c.profile_id);
    const sara = SARA_OPCOES.find((s) => s.modulo === canal.sara_modulo)?.rotulo ?? null;
    try {
      await enviarTexto(canal.instancia, c.numero, boasVindas(u?.nome.split(/\s+/)[0] ?? null, canal.nome, sara));
    } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "A Evolution não respondeu." }, { status: 503 }); }
    await auditar(d.sb, "whatsapp.boas_vindas", { id, canal: c.canal_id, numero: `…${c.numero.slice(-4)}` });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
