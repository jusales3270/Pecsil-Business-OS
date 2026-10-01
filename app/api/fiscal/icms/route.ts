import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { ICMS_COLUNAS, icmsColunas, type IcmsEntradaBody } from "../../../../lib/fiscal/icms-campos";

export const dynamic = "force-dynamic";

const MES = /^\d{4}-\d{2}$/;

/** Notas de entrada e livro de apuração do mês (AAAA-MM). */
export async function GET(request: Request) {
  const guard = await requireFeature("fiscal.icms");
  if ("error" in guard) return guard.error;
  const mes = new URL(request.url).searchParams.get("mes") ?? new Date().toISOString().slice(0, 7);
  if (!MES.test(mes)) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  const competencia = `${mes}-01`;
  const [entradas, livro, meses] = await Promise.all([
    guard.supabase.from("fiscal_icms_entries").select(ICMS_COLUNAS).eq("competencia", competencia).order("recebida", { ascending: true, nullsFirst: false }).order("created_at"),
    guard.supabase.from("fiscal_icms_ledger").select("id, ordem, descricao, credito, debito, saldo").eq("competencia", competencia).order("ordem").order("created_at"),
    guard.supabase.from("fiscal_icms_entries").select("competencia").order("competencia", { ascending: false }).limit(2000),
  ]);
  if (entradas.error || livro.error) {
    console.error("Falha ao ler o Painel do ICMS", entradas.error ?? livro.error);
    return NextResponse.json({ error: "FISCAL_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    mes,
    canEdit: guard.access.can("fiscal.icms", "operar"),
    meses: [...new Set((meses.data ?? []).map((row) => String(row.competencia).slice(0, 7)))],
    entradas: entradas.data ?? [],
    livro: livro.data ?? [],
  });
}

/** Nova nota no painel (administrativo, terceiros, ou o que não passou pelo Almoxarifado). */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as IcmsEntradaBody;
  if (!body.fornecedor?.trim()) return NextResponse.json({ error: "Informe o fornecedor." }, { status: 400 });
  if (!body.competencia) return NextResponse.json({ error: "Informe o mês." }, { status: 400 });
  const resultado = icmsColunas(body);
  if ("erro" in resultado) return NextResponse.json({ error: resultado.erro }, { status: 400 });
  const { data, error } = await guard.supabase.from("fiscal_icms_entries").insert({ ...resultado.colunas, origem: "manual" }).select(ICMS_COLUNAS).single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Esta nota já está no painel (mesma chave de acesso)." }, { status: 409 });
    return dbError(error);
  }
  return NextResponse.json(data, { status: 201 });
}
