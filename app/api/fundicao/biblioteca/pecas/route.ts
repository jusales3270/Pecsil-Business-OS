import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { termoDeBusca } from "../../../../../lib/fundicao/biblioteca-regras";
import { buscarPecas } from "../../../../../lib/fundicao/biblioteca-servidor";

export const dynamic = "force-dynamic";

/** Busca da peça no cadastro para ligar o desenho antigo (só código, descrição e cliente). */
export async function GET(request: Request) {
  const guard = await requireFeature("fundicao.biblioteca", "operar");
  if ("error" in guard) return guard.error;
  const termo = termoDeBusca(new URL(request.url).searchParams.get("q"));
  if (!termo) return NextResponse.json({ pecas: [] });
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  if (!org) return NextResponse.json({ error: "Sessão sem organização." }, { status: 403 });
  try {
    return NextResponse.json({ pecas: await buscarPecas(String(org), termo) });
  } catch (e) {
    console.error("Falha ao buscar peças para a Biblioteca", e);
    return NextResponse.json({ error: "Busca indisponível agora." }, { status: 503 });
  }
}
