import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/**
 * Origem das entregas (o pátio de onde o caminhão sai). Com `procurar`, só devolve a coordenada do endereço
 * digitado (Nominatim, só o endereço); para gravar, manda nome, endereço e a coordenada confirmada.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("logistica.entregas", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { procurar?: string; nome?: string; endereco?: string; lat?: number; lng?: number };
  if (body.procurar) {
    const q = String(body.procurar).trim().slice(0, 200);
    if (q.length < 5) return NextResponse.json({ error: "Digite o endereço completo." }, { status: 400 });
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: "jsonv2", limit: "3", countrycodes: "br" })}`, {
        headers: { "user-agent": "BusinessOS-Logistica/1.0 (entregas com frota propria)", "accept-language": "pt-BR" }, signal: AbortSignal.timeout(10_000), cache: "no-store",
      });
      const lista = (r.ok ? await r.json() : []) as { lat: string; lon: string; display_name: string }[];
      return NextResponse.json({ achados: lista.map((x) => ({ lat: Number(x.lat), lng: Number(x.lon), nome: x.display_name })) });
    } catch {
      return NextResponse.json({ error: "A busca de endereço não respondeu. Tente de novo ou informe a coordenada." }, { status: 503 });
    }
  }
  const { data, error } = await guard.supabase.rpc("logistica_salvar_origem", { p: { nome: body.nome, endereco: body.endereco, lat: body.lat, lng: body.lng } });
  if (error) return respostaDeErro(error, "Não foi possível salvar a origem.");
  return NextResponse.json(data);
}
