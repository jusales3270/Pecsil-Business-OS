import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Dado clínico de uma ausência (diagnóstico, CID, observação de saúde).
 * Rota própria para que o conteúdo só saia do servidor para quem tem
 * `rh.clinico`; a lista de ausências nunca o carrega. A RLS de
 * `rh_absence_clinical` repete a mesma exigência no banco.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("rh.clinico");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;

  const { data, error } = await guard.supabase
    .from("rh_absence_clinical")
    .select("cid_codes, diagnosis, note, updated_at")
    .eq("absence_id", id)
    .maybeSingle();
  if (error) return dbError(error);
  const response = NextResponse.json(
    data
      ? { cidCodes: data.cid_codes ?? [], diagnosis: data.diagnosis, note: data.note, updatedAt: data.updated_at }
      : null,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
