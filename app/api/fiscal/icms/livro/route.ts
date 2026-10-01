import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Nova linha do livro de apuração do mês. */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { mes?: string; descricao?: string; credito?: number; debito?: number };
  if (!body.mes || !/^\d{4}-\d{2}$/.test(body.mes)) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  if (!body.descricao?.trim()) return NextResponse.json({ error: "Informe a descrição." }, { status: 400 });
  const credito = Math.round(Number(body.credito ?? 0) * 100) / 100;
  const debito = Math.round(Number(body.debito ?? 0) * 100) / 100;
  if (!Number.isFinite(credito) || !Number.isFinite(debito) || credito < 0 || debito < 0) return NextResponse.json({ error: "Valores inválidos." }, { status: 400 });
  const competencia = `${body.mes}-01`;
  const { data: ultima } = await guard.supabase.from("fiscal_icms_ledger").select("ordem").eq("competencia", competencia).order("ordem", { ascending: false }).limit(1).maybeSingle();
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  const { data, error } = await guard.supabase.from("fiscal_icms_ledger")
    .insert({ organization_id: org, competencia, ordem: Number(ultima?.ordem ?? 0) + 1, descricao: body.descricao.trim(), credito, debito })
    .select("id, ordem, descricao, credito, debito, saldo").single();
  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
