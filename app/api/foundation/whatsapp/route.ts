import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../lib/supabase/session";
import { desconectar, enviarTexto, ErroEvolution, INSTANCIA_INTERNA, numeroWhatsApp, pedirQr, situacao } from "../../../../lib/whatsapp/evolution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fundação › WhatsApp (PLANO-WHATSAPP, W1): o canal da plataforma. Só o proprietário (é infraestrutura, como
 * Banco e Autenticação). GET: a situação do chip. POST: conectar (QR Code), desconectar e mensagem de teste.
 * Conectar, desconectar e enviar ficam na auditoria; o QR Code e a chave da Evolution nunca são gravados.
 */
async function dono() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access?.isOwner) return { erro: NextResponse.json({ error: "O canal do WhatsApp é do proprietário." }, { status: 403 }) } as const;
  return { sb: session.supabase as SupabaseClient } as const;
}

async function auditar(sb: SupabaseClient, evento: string, metadata: Record<string, unknown>) {
  try {
    const { data: perfil } = await sb.rpc("current_profile_id");
    const { data: p } = perfil ? await sb.from("profiles").select("id, organization_id, user_id").eq("id", perfil).maybeSingle() : { data: null };
    if (!p) return;
    const { error } = await createSupabaseAdminClient().from("audit_logs").insert({ organization_id: p.organization_id, actor_user_id: p.user_id, actor_profile_id: p.id,
      module_code: "core.whatsapp", event_type: evento, entity_type: "whatsapp_canal", entity_id: null, risk_level: "monitored", metadata: { instancia: INSTANCIA_INTERNA, ...metadata } });
    if (error) console.error("[whatsapp] auditoria", error.message);
  } catch (e) { console.error("[whatsapp] auditoria", e instanceof Error ? e.message : e); }
}

const falha = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "A Evolution não respondeu." }, { status: e instanceof ErroEvolution && e.status < 500 ? 400 : 503 });

export async function GET() {
  const d = await dono();
  if ("erro" in d) return d.erro;
  return NextResponse.json(await situacao(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const corpo = (await request.json().catch(() => null)) as { acao?: string; numero?: string; texto?: string } | null;
  try {
    if (corpo?.acao === "conectar") {
      const r = await pedirQr();
      if (r.conectado) return NextResponse.json({ conectado: true });
      await auditar(d.sb, "whatsapp.qr_pedido", {});
      return NextResponse.json({ conectado: false, qr: r.qr });
    }
    if (corpo?.acao === "desconectar") {
      await desconectar();
      await auditar(d.sb, "whatsapp.desconectado", {});
      return NextResponse.json({ ok: true });
    }
    if (corpo?.acao === "teste") {
      const n = numeroWhatsApp(corpo.numero);
      if ("erro" in n) return NextResponse.json({ error: n.erro }, { status: 400 });
      const texto = String(corpo.texto ?? "").trim().slice(0, 500) || "Teste do canal de WhatsApp do PecSil Business OS.";
      const r = await enviarTexto(n.numero, texto);
      // Só os 4 últimos dígitos na auditoria.
      await auditar(d.sb, "whatsapp.teste_enviado", { para: `…${n.numero.slice(-4)}`, mensagem: r.id });
      return NextResponse.json({ ok: true, id: r.id });
    }
  } catch (e) { return falha(e); }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
