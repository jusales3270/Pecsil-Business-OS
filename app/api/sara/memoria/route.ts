import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * O que a SARA lembra de mim (menu da conta). GET: a minha memória (o banco só entrega a da própria pessoa).
 * DELETE com `?id=` apaga uma lembrança e sem id apaga todas: o texto é zerado e a linha fica marcada, para a próxima
 * resposta da mesma conversa não refazer o que a pessoa mandou apagar.
 */
export async function GET() {
  const s = await requireUserSession();
  if ("error" in s && s.error) return s.error;
  const { data, error } = await s.supabase.from("sara_memoria_pessoa").select("id, tipo, modulo, chave, texto, updated_at").order("updated_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Não foi possível carregar a memória." }, { status: 500 });
  return NextResponse.json({ memoria: data ?? [] });
}

export async function DELETE(request: Request) {
  const s = await requireUserSession();
  if ("error" in s && s.error) return s.error;
  const id = new URL(request.url).searchParams.get("id");
  if (id && !UUID.test(id)) return NextResponse.json({ error: "Lembrança não encontrada." }, { status: 404 });
  const { data: eu } = await s.supabase.rpc("current_profile_id");
  if (!eu) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  let q = createSupabaseAdminClient().from("sara_memoria_pessoa").update({ texto: "", esquecida: true }).eq("profile_id", eu as string);
  if (id) q = q.eq("id", id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: "Não foi possível apagar." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
