import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../../../lib/auth/feature-guard";
import { etapasDaMedicao, medidorConfigurado } from "../../../../../../lib/comercial/medidor-3d";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

/**
 * Peças do desenho 3D (ROADMAP C-19): as medições dos STEP anexados ao orçamento, com as ligas e a regra
 * do sobremetal para a tela calcular o peso acabado e o bruto (lib/comercial/peso-3d.ts).
 */
export async function GET(_request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireAnyFeature(["comercial.orcamentos", "producao.entrada", "fiscal.nfe"], "ver");
  if ("error" in guard) return guard.error;
  const [{ data: medicoes, error }, { data: ligas }, { data: regras }] = await Promise.all([
    guard.supabase.from("comercial_medicoes_3d")
      .select("id, attachment_id, nome_arquivo, situacao, erro, versao_motor, tempo_ms, corpos, imagens, ajustes, liga_id, created_by_name, created_at, medido_em")
      .eq("quote_id", id).order("created_at"),
    guard.supabase.from("comercial_ligas").select("id, nome, densidade_g_cm3, padrao").eq("ativo", true).order("nome"),
    guard.supabase.from("comercial_sobremetal").select("id, tipo_peca, liga_id, mm_diametro, mm_comprimento"),
  ]);
  if (error) return dbError(error);
  return NextResponse.json({
    // Em andamento: as etapas que o medidor já avisou (a tela mostra ao vivo).
    medicoes: (medicoes ?? []).map((m) => ({ ...m, imagens: Object.keys(m.imagens ?? {}), etapas: m.situacao === "pendente" || m.situacao === "medindo" ? etapasDaMedicao(m.id) : [] })),
    ligas: (ligas ?? []).map((l) => ({ ...l, densidade_g_cm3: Number(l.densidade_g_cm3) })),
    regras: (regras ?? []).map((r) => ({ ...r, mm_diametro: Number(r.mm_diametro), mm_comprimento: Number(r.mm_comprimento) })),
    podeOperar: guard.access.can("comercial.orcamentos", "operar"),
    medidorLigado: medidorConfigurado(),
  });
}
