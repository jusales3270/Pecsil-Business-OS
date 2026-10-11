import "server-only";

import { NextResponse } from "next/server";
import { requireAnyFeature, requireFeature } from "../auth/feature-guard";
import { SETORES_COLETA, ehSetorColeta, featureColeta, type SetorColeta } from "./modulos";

/** Sessão + "Coletar arquivos" no setor pedido. Setor fora da lista → 400; sem a permissão → 403. */
export async function exigirColeta(modulo: unknown) {
  const setor = String(modulo ?? "");
  if (!ehSetorColeta(setor)) return { error: NextResponse.json({ error: "Setor da coleta inválido." }, { status: 400 }) } as const;
  const guard = await requireFeature(featureColeta(setor), "operar");
  if (guard.error) return { error: guard.error } as const;
  return { supabase: guard.supabase, access: guard.access, setor: setor as SetorColeta } as const;
}

/** Sessão + "Coletar arquivos" em algum setor (histórico e revogação dos próprios aceites). */
export const exigirAlgumaColeta = () => requireAnyFeature(SETORES_COLETA.map(featureColeta), "operar");
