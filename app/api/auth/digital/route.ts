import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Aparelhos com a digital ativa. Sem parâmetro: os da própria pessoa. Com ?perfil=<id>: os de outra
 * pessoa — o banco (RLS) só mostra para o proprietário.
 */
export async function GET(request: Request) {
  const sessao = await requireUserSession();
  if ("error" in sessao && sessao.error) return sessao.error;
  const perfil = new URL(request.url).searchParams.get("perfil");
  let q = sessao.supabase.from("access_passkeys").select("id, aparelho, created_at, last_used_at").is("revoked_at", null).order("created_at", { ascending: false });
  q = perfil && /^[0-9a-f-]{36}$/i.test(perfil) ? q.eq("profile_id", perfil) : q.eq("user_id", sessao.user.id);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "Não foi possível ler os aparelhos." }, { status: 400 });
  return NextResponse.json({ aparelhos: data ?? [] });
}
