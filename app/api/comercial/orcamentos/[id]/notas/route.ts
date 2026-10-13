import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Anotação no orçamento (ex.: "fundo com desconto de 890 para 830"). Só se acrescenta. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const texto = String(((await request.json().catch(() => null)) as { texto?: string } | null)?.texto ?? "").trim().slice(0, 2000);
  if (!texto) return NextResponse.json({ error: "Escreva a anotação." }, { status: 400 });
  const [{ data: org }, { data: perfil }] = await Promise.all([guard.supabase.rpc("current_organization_id"), guard.supabase.rpc("current_profile_id")]);
  const { data: autor } = await guard.supabase.from("profiles").select("full_name, email").eq("id", perfil).maybeSingle();
  const { error } = await guard.supabase.from("sales_quote_notes").insert({
    organization_id: org, quote_id: id, texto, autor_profile_id: perfil, autor_nome: autor?.full_name || autor?.email || null,
  });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
