import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { montarCalendario, type DadosCalendario } from "../../../../lib/contabil/calendario";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › Calendário fiscal (N-06): as declarações e as guias da empresa no período, com a data já ajustada pelo
 * feriado e a regra que ajustou. Obrigações, prazos e feriados vêm dos parâmetros legais (fiscal_calendario_dados,
 * que confere a permissão); o cálculo é da plataforma.
 */
const LEITURA = ["fiscal.icms", "fiscal.config", "fiscal.parametros", "fiscal.nfe", "fiscal.escritorio", "fiscal.portal", "fiscal.contabilidade"] as const;
const dataOk = (v: string | null) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const mais = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export async function GET(request: Request) {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const q = new URL(request.url).searchParams;
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const de = dataOk(q.get("de")) ? q.get("de")! : mais(hoje, -15);
  const ate = dataOk(q.get("ate")) ? q.get("ate")! : mais(hoje, 120);
  if (de > ate || mais(de, 800) < ate) return NextResponse.json({ error: "Período inválido (até dois anos)." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("fiscal_calendario_dados");
  if (error) return dbError(error);
  return NextResponse.json({ hoje, de, ate, ...montarCalendario(data as DadosCalendario, { de, ate, hoje }) }, { headers: { "Cache-Control": "no-store" } });
}
