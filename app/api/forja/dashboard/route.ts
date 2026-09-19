import { NextResponse } from "next/server";
import { emptyForjaDashboardData } from "@/modules/producao/src/data/emptyForjaData";
import { ForjaError, getForjaSession } from "@/lib/forja/client";
import { requireUserSession } from "@/lib/supabase/session";
import { readSessionAccess } from "@/lib/auth/session-access";
import { pruneDashboard } from "@/lib/forja/forja-session";

export const dynamic = "force-dynamic";

/** Rótulo mostrado na tela; o endereço interno do Forja não sai do servidor. */
const ENDPOINT_LABEL = "Forja · rede interna";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Painel de produção vindo do Forja.
 *
 * Só para quem tem alguma funcionalidade da Produção, e recortado por elas:
 * o painel traz clientes, OS e prazos. A leitura no Forja usa a conta de integração (lib/forja/client.ts).
 */
export async function GET() {
  const session = await requireUserSession();
  if ("error" in session) return session.error;

  let access;
  try {
    access = await readSessionAccess(session.supabase);
  } catch {
    return NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
  if (!access.canModule("producao")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: NO_STORE });
  }

  try {
    const { data: full, fetchedAt } = await getForjaSession().getDashboard();
    // Cada usuário recebe só o que as funcionalidades dele mostram.
    const data = access.isOwner ? full : pruneDashboard(full, (feature) => access.can(feature), emptyForjaDashboardData);
    return NextResponse.json(
      { success: true, source: "live", endpoint: ENDPOINT_LABEL, fetchedAt: new Date(fetchedAt).toISOString(), data },
      { headers: NO_STORE },
    );
  } catch (error) {
    const failure = error instanceof ForjaError
      ? error
      : new ForjaError("BAD_RESPONSE", "Falha inesperada ao ler o Forja.");
    if (!(error instanceof ForjaError)) console.error("[forja] Falha inesperada:", error);
    else console.warn(`[forja] ${failure.code}: ${failure.message}`);

    return NextResponse.json(
      {
        success: false,
        source: "sem-conexao",
        endpoint: ENDPOINT_LABEL,
        motivo: failure.code,
        warning: failure.message,
        data: emptyForjaDashboardData,
      },
      { headers: NO_STORE },
    );
  }
}
