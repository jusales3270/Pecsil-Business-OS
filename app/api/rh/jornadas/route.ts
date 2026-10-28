import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { jornadaLabel } from "../../../../lib/data/foundation-repository";

export const dynamic = "force-dynamic";

/** Jornadas de trabalho (horários do Secullum) para o cadastro do colaborador, pelo número do horário. */
export async function GET() {
  const guard = await requireFeature("rh.colaboradores");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.from("rh_jornadas").select("id, numero, nome").eq("ativo", true).order("numero");
  if (error) return dbError(error);
  return NextResponse.json({ jornadas: (data ?? []).map((j) => ({ id: String(j.id), numero: Number(j.numero), rotulo: jornadaLabel(j) })) }, { headers: { "Cache-Control": "no-store" } });
}
