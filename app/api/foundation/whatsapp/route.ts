import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../lib/supabase/session";
import { validarCanal } from "../../../../lib/whatsapp/contatos";
import { SARA_OPCOES } from "../../../../lib/whatsapp/saras";
import { apagarInstancia, configuracao, desconectar, enviarTexto, ErroEvolution, nomeDeInstancia, numeroWhatsApp, pedirQr, situacao } from "../../../../lib/whatsapp/evolution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fundação › WhatsApp (PLANO-WHATSAPP): os números da plataforma (canais). Só o proprietário (é infraestrutura,
 * como Banco e Autenticação). GET: os canais com a situação de cada um na Evolution. POST: criar, alterar e
 * remover canal; conectar (QR Code), desconectar e mensagem de teste de um canal. Tudo na auditoria; o QR Code
 * e a chave da Evolution nunca são gravados.
 */
const UUID = /^[0-9a-f-]{36}$/i;

async function dono() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access?.isOwner) return { erro: NextResponse.json({ error: "Os números do WhatsApp são do proprietário." }, { status: 403 }) } as const;
  return { sb: session.supabase as SupabaseClient } as const;
}

async function auditar(sb: SupabaseClient, evento: string, metadata: Record<string, unknown>) {
  try {
    const { data: perfil } = await sb.rpc("current_profile_id");
    const { data: p } = perfil ? await sb.from("profiles").select("id, organization_id, user_id").eq("id", perfil).maybeSingle() : { data: null };
    if (!p) return;
    const { error } = await createSupabaseAdminClient().from("audit_logs").insert({ organization_id: p.organization_id, actor_user_id: p.user_id, actor_profile_id: p.id,
      module_code: "core.whatsapp", event_type: evento, entity_type: "whatsapp_canal", entity_id: typeof metadata.canal === "string" && UUID.test(metadata.canal) ? metadata.canal : null, risk_level: "monitored", metadata });
    if (error) console.error("[whatsapp] auditoria", error.message);
  } catch (e) { console.error("[whatsapp] auditoria", e instanceof Error ? e.message : e); }
}

const falha = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "A Evolution não respondeu." }, { status: e instanceof ErroEvolution && e.status < 500 ? 400 : 503 });
type Linha = { id: string; instancia: string; nome: string; departamento: string | null; descricao: string | null; sara_modulo: string | null; conexao: string; ativo: boolean; created_at: string };
const tabelaFaltando = (msg: string, code?: string) => code === "42P01" || /whatsapp_canais/.test(msg) && /does not exist|não existe/.test(msg);

export async function GET() {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const { data, error } = await d.sb.from("whatsapp_canais").select("id, instancia, nome, departamento, descricao, sara_modulo, conexao, ativo, created_at").order("created_at");
  if (error) return NextResponse.json({ error: tabelaFaltando(error.message, error.code) ? "As tabelas dos números ainda não foram criadas no banco (migração 202610240002)." : error.message }, { status: 500 });
  const rotulo = new Map(SARA_OPCOES.map((s) => [s.modulo, s.rotulo]));
  const canais = await Promise.all(((data ?? []) as Linha[]).map(async (c) => ({ ...c, sara: c.sara_modulo ? { modulo: c.sara_modulo, rotulo: rotulo.get(c.sara_modulo) ?? c.sara_modulo } : null,
    situacao: c.conexao === "whatsapp_web" ? await situacao(c.instancia) : { estado: "api_oficial", numero: null, nome: null } })));
  return NextResponse.json({ canais, saras: SARA_OPCOES.map((s) => ({ modulo: s.modulo, rotulo: s.rotulo })), configurada: Boolean(configuracao()) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const e = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const acao = String(e.acao ?? "");
  const id = String(e.canal ?? "");

  if (acao === "salvar_canal") {
    const v = validarCanal(e, SARA_OPCOES);
    if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
    if (UUID.test(id)) {
      const { error } = await d.sb.from("whatsapp_canais").update(v).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await auditar(d.sb, "whatsapp.canal_alterado", { canal: id, nome: v.nome, sara: v.sara_modulo });
      return NextResponse.json({ ok: true, id });
    }
    // Número novo: a instância nasce aqui com nome fixo; a Evolution cria na hora do QR Code.
    const { data: todos } = await d.sb.from("whatsapp_canais").select("instancia");
    const instancia = nomeDeInstancia(v.nome, ((todos ?? []) as { instancia: string }[]).map((x) => x.instancia));
    const [{ data: org }, { data: eu }] = await Promise.all([d.sb.from("organizations").select("id").limit(1).single(), d.sb.rpc("current_profile_id")]);
    const conexao = e.conexao === "api_oficial" ? "api_oficial" : "whatsapp_web";
    const { data, error } = await d.sb.from("whatsapp_canais").insert({ ...v, instancia, conexao, organization_id: org?.id, criado_por: eu }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await auditar(d.sb, "whatsapp.canal_criado", { canal: data.id, instancia, nome: v.nome, sara: v.sara_modulo, conexao });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (!UUID.test(id)) return NextResponse.json({ error: "Número da plataforma não encontrado." }, { status: 404 });
  const { data: canal } = await d.sb.from("whatsapp_canais").select("id, instancia, nome, conexao, ativo").eq("id", id).maybeSingle();
  if (!canal) return NextResponse.json({ error: "Número da plataforma não encontrado." }, { status: 404 });
  if (canal.conexao !== "whatsapp_web" && ["conectar", "desconectar", "teste"].includes(acao)) return NextResponse.json({ error: "A conexão pela API oficial ainda não está pronta (etapa W5)." }, { status: 400 });

  try {
    if (acao === "conectar") {
      const r = await pedirQr(canal.instancia);
      if (r.conectado) return NextResponse.json({ conectado: true });
      await auditar(d.sb, "whatsapp.qr_pedido", { canal: id, instancia: canal.instancia });
      return NextResponse.json({ conectado: false, qr: r.qr });
    }
    if (acao === "desconectar") {
      await desconectar(canal.instancia);
      await auditar(d.sb, "whatsapp.desconectado", { canal: id, instancia: canal.instancia });
      return NextResponse.json({ ok: true });
    }
    if (acao === "teste") {
      const n = numeroWhatsApp(e.numero);
      if ("erro" in n) return NextResponse.json({ error: n.erro }, { status: 400 });
      const texto = String(e.texto ?? "").trim().slice(0, 500) || `Teste do WhatsApp "${canal.nome}" do Pecsil Business OS.`;
      const r = await enviarTexto(canal.instancia, n.numero, texto);
      // Só os 4 últimos dígitos na auditoria.
      await auditar(d.sb, "whatsapp.teste_enviado", { canal: id, para: `…${n.numero.slice(-4)}`, mensagem: r.id });
      return NextResponse.json({ ok: true, id: r.id });
    }
    if (acao === "ativar" || acao === "desativar") {
      const { error } = await d.sb.from("whatsapp_canais").update({ ativo: acao === "ativar" }).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await auditar(d.sb, `whatsapp.canal_${acao === "ativar" ? "ativado" : "desativado"}`, { canal: id, nome: canal.nome });
      return NextResponse.json({ ok: true });
    }
    if (acao === "remover") {
      // Tira o aparelho conectado e apaga a instância na Evolution; as listas do canal saem junto (cascade).
      if (canal.conexao === "whatsapp_web" && configuracao()) await apagarInstancia(canal.instancia);
      const { error } = await d.sb.from("whatsapp_canais").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await auditar(d.sb, "whatsapp.canal_removido", { canal: id, instancia: canal.instancia, nome: canal.nome });
      return NextResponse.json({ ok: true });
    }
  } catch (err) { return falha(err); }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
