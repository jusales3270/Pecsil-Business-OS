import { NextResponse } from "next/server";
import { mesmoToken } from "../../../../lib/logistica/regras.mjs";
import { conferirAbertas } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/**
 * Aviso (webhook) do Fleetbase quando uma ordem muda. Não tem sessão: entra só com o token próprio
 * (`?t=FLEETBASE_AVISO_TOKEN`), e o conteúdo NUNCA é usado como verdade: ele só dispara a conferência, que lê a
 * ordem no Fleetbase pela nossa chave (docs/PLANO-LOGISTICA.md §1).
 */
export async function POST(request: Request) {
  const token = process.env.FLEETBASE_AVISO_TOKEN;
  if (!token || !mesmoToken(new URL(request.url).searchParams.get("t"), token)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 401 });
  }
  const texto = (await request.text().catch(() => "")).slice(0, 200_000);
  const ordens = [...new Set(texto.match(/order_[a-z0-9]{6,40}/g) ?? [])].slice(0, 20);
  await conferirAbertas(true, ordens.length ? ordens : undefined);
  return NextResponse.json({ ok: true, conferidas: ordens.length });
}
