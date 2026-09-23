import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../../../lib/auth/feature-guard";
import { CLIENTE_FEATURES } from "../../route";

export const dynamic = "force-dynamic";

/**
 * E-mails conhecidos do cliente. Esta lista é o que o CRM usa para reconhecer
 * o remetente — e é o filtro da caixa do diretor de operações: de lá, só entra
 * mensagem de quem está cadastrado aqui.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyFeature(CLIENTE_FEATURES, "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }
  const label = String(body.label ?? "").trim() || null;

  const { data: organizationId, error: orgError } = await guard.supabase.rpc("current_organization_id");
  if (orgError || !organizationId) return NextResponse.json({ error: "Organização não encontrada." }, { status: 400 });

  // Devolve a linha gravada: a tela precisa do id de verdade para poder remover.
  const { data, error } = await guard.supabase
    .from("party_emails")
    .insert({ organization_id: organizationId, email, label, customer_id: id })
    .select("id, email, label")
    .single();
  if (error) {
    if (error.code === "23505" || error.code === "23514") {
      return NextResponse.json({ error: "Este e-mail já está em outro cadastro." }, { status: 409 });
    }
    return dbError(error);
  }
  return NextResponse.json({ email: data });
}

/** Remove um e-mail da lista de remetentes conhecidos. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyFeature(CLIENTE_FEATURES, "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const emailId = new URL(request.url).searchParams.get("emailId");
  if (!emailId) return NextResponse.json({ error: "Informe o e-mail a remover." }, { status: 400 });

  const { data, error } = await guard.supabase
    .from("party_emails")
    .delete()
    .eq("id", emailId)
    .eq("customer_id", id)
    .select("id")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "E-mail não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
