import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Começa uma coleta a partir de um aceite válido (não revogado) da própria pessoa. */
export async function POST(request: Request) {
  const guard = await requireFeature("fundacao.coleta", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { aceiteId?: string };
  const { data, error } = await guard.supabase.rpc("file_collection_run_start", { p_consent: body.aceiteId ?? null });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível começar a coleta." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ id: data }, { status: 201 });
}
