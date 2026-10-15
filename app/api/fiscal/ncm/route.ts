import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { autorDaSessao } from "../../../../lib/fiscal/emissao/servidor";

export const dynamic = "force-dynamic";

/** Alíquota do IPI de um NCM (a TIPI). Vazio: sem alíquota (o orçamento avisa em vez de calcular). */
export async function PUT(request: Request) {
  const guard = await requireAnyFeature(["fiscal.config", "fiscal.nfe"]);
  if ("error" in guard) return guard.error;
  if (!(guard.access.can("fiscal.config", "operar") || guard.access.can("fiscal.nfe", "aprovar"))) {
    return NextResponse.json({ error: "Só a Configuração fiscal (operar) ou quem aprova notas altera o IPI por NCM." }, { status: 403 });
  }
  const corpo = (await request.json().catch(() => null)) as { ncm?: unknown; ipi_aliquota?: unknown; descricao?: unknown } | null;
  const ncm = String(corpo?.ncm ?? "").replace(/\D/g, "");
  if (ncm.length !== 8) return NextResponse.json({ error: "O NCM tem 8 dígitos." }, { status: 400 });
  const bruto = String(corpo?.ipi_aliquota ?? "").trim();
  const aliquota = bruto ? Number(bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto) : null;
  if (aliquota !== null && (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 100)) return NextResponse.json({ error: "Alíquota de 0 a 100." }, { status: 400 });
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const descricao = String(corpo?.descricao ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const { error } = await guard.supabase.from("fiscal_ncm").upsert({ organization_id: autor.org, ncm, ipi_aliquota: aliquota, descricao }, { onConflict: "organization_id,ncm" });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
