import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Fecha a coleta com as contagens (varridos, ignorados, repetidos, pessoais, do RH, grandes, propostos). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fundacao.coleta", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as Record<string, number>;
  const contagens = Object.fromEntries(["scanned", "ignored", "duplicates", "personal", "rh", "too_big", "proposed"].map((k) => [k, Math.max(0, Math.floor(Number(body[k]) || 0))]));
  const { error } = await guard.supabase.rpc("file_collection_run_finish", { p_run: id, p_counts: contagens });
  if (error) return NextResponse.json({ error: error.code === "P0001" ? error.message : "Não foi possível fechar a coleta." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
