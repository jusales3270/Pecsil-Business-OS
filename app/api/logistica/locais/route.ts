import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/** Corrige à mão o ponto do cliente no mapa (quando o endereço do cadastro não é achado ou cai no lugar errado). */
export async function POST(request: Request) {
  const guard = await requireFeature("logistica.entregas", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { customer_id?: string; lat?: number; lng?: number; endereco?: string };
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!body.customer_id || !Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "Informe o cliente e a coordenada." }, { status: 400 });
  const { error } = await guard.supabase.rpc("logistica_salvar_local", {
    p_customer: body.customer_id, p_endereco: String(body.endereco ?? ""), p_lat: lat, p_lng: lng, p_fonte: "manual", p_fleetbase: null,
  });
  if (error) return respostaDeErro(error, "Não foi possível salvar o ponto.");
  return NextResponse.json({ ok: true });
}
