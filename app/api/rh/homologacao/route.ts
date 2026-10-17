import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * RH › Homologação (R-01): os registros de quem homologou o módulo (resultado e ressalvas). Ler:
 * quem vê a Homologação do RH; registrar: quem a opera (o banco confere de novo).
 */
export async function GET() {
  const guard = await requireFeature("rh.homologacao");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.from("module_homologations")
    .select("id, resultado, observacao, profile_id, profile_name, created_at").eq("module_code", "rh").order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Não foi possível carregar a homologação." }, { status: 500 });
  return NextResponse.json({ registros: data ?? [], podeRegistrar: guard.access.can("rh.homologacao", "operar") });
}

export async function POST(request: Request) {
  const guard = await requireFeature("rh.homologacao", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { resultado?: string; observacao?: string } | null;
  const { error } = await guard.supabase.rpc("modulo_homologacao_registrar", { p_modulo: "rh", p_resultado: corpo?.resultado ?? "", p_observacao: corpo?.observacao ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
