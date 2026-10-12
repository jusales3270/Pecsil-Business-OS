import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { transmissorConfigurado } from "../../../../lib/fiscal/transmissor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTROS = new Set(["todas", "fora_do_painel", "sem_xml", "canceladas"]);

/**
 * Fiscal › Notas recebidas: o que a SEFAZ tem emitido contra o nosso CNPJ, com a conferência
 * "o governo tem e nós não" (já está no Painel do ICMS? já foi recebida no Almoxarifado?).
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["fiscal.icms", "fiscal.nfe"]);
  if ("error" in guard) return guard.error;
  const filtro = new URL(request.url).searchParams.get("filtro") ?? "todas";
  const [{ data: notas, error }, { data: config }] = await Promise.all([
    guard.supabase.rpc("fiscal_dfe_listar", { p_filtro: FILTROS.has(filtro) ? filtro : "todas", p_limite: 300 }),
    guard.supabase.from("fiscal_config")
      .select("dfe_ativo, ciencia_automatica, dfe_ultima_consulta, dfe_proxima_consulta, dfe_ultimo_status, cert_validade, ambiente")
      .maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    notas: notas ?? [],
    busca: config ?? null,
    podeOperar: guard.access.can("fiscal.icms", "operar"),
    podeConfigurar: guard.access.can("fiscal.config", "operar"),
    transmissor: transmissorConfigurado(),
  });
}
