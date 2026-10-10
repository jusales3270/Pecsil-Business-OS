import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Quais destes arquivos (sha256) já estão na plataforma? Só sim/não — sem nome nem setor. */
export async function POST(request: Request) {
  const guard = await requireFeature("fundacao.coleta", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { hashes?: string[] };
  const hashes = [...new Set((body.hashes ?? []).filter((h) => /^[0-9a-f]{64}$/i.test(h)).map((h) => h.toLowerCase()))].slice(0, 2000);
  if (!hashes.length) return NextResponse.json({ existentes: [] });
  const { data, error } = await guard.supabase.rpc("company_document_hashes_exist", { p_hashes: hashes });
  if (error) return NextResponse.json({ error: error.code === "42501" ? error.message : "Não foi possível conferir os arquivos." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ existentes: data ?? [] });
}
