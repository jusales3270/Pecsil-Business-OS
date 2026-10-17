import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Fundação › Parados (A-11): o que está esperando alguém há mais dias que o normal, só das áreas
 * que a pessoa resolve (o banco filtra pela permissão). Só a lista: nada é cobrado nem enviado.
 */
export async function GET() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const { data, error } = await session.supabase.rpc("parados_listar");
  if (error) return NextResponse.json({ error: "Não foi possível carregar a lista." }, { status: 500 });
  return NextResponse.json({ itens: data ?? [] });
}
