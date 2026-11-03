import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** As não conformidades (mais novas primeiro), com as regras da área e os setores da empresa. */
export async function GET() {
  const guard = await requireFeature("qualidade.nao_conformidades", "ver");
  if ("error" in guard) return guard.error;
  const sb = guard.supabase;
  const [ncs, regras, setores] = await Promise.all([
    sb.from("qualidade_nao_conformidades").select("id, numero, tipo, setor, local, maquina, os_codigo, gravidade, situacao, descricao, autor_nome, ocorrido_em, created_at, qualidade_nc_fotos(id)").order("created_at", { ascending: false }).limit(500),
    sb.from("qualidade_regras").select("tipos, usar_gravidade, gravidades, revisado_por_nome, revisado_em").maybeSingle(),
    sb.from("departments").select("name").eq("active", true).order("name"),
  ]);
  if (ncs.error || regras.error || setores.error) {
    console.error("Qualidade: falha ao ler", ncs.error ?? regras.error ?? setores.error);
    return NextResponse.json({ error: "Não foi possível carregar as não conformidades." }, { status: 503 });
  }
  return NextResponse.json({
    ncs: ncs.data ?? [],
    regras: regras.data,
    setores: (setores.data ?? []).map((s) => s.name),
    podeOperar: guard.access.can("qualidade.nao_conformidades", "operar"),
    podeRegras: guard.access.can("qualidade.nao_conformidades", "aprovar"),
  });
}
