import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { procurarEndereco } from "../../../../lib/logistica/geocodificar";
import { enderecoDaEmpresa, respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/**
 * O endereço da própria empresa (cadastro do Fiscal), para o botão "Usar o endereço da empresa" da origem.
 * Só o endereço, lido no servidor para quem configura a Logística.
 */
export async function GET() {
  const guard = await requireFeature("logistica.entregas", "operar");
  if ("error" in guard) return guard.error;
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  return NextResponse.json({ empresa: org ? await enderecoDaEmpresa(String(org)) : null });
}

/**
 * Origem das entregas (o pátio de onde o caminhão sai). Com `procurar`, devolve sugestões do endereço digitado
 * (várias fontes, tolera erro de digitação; vai só o endereço); a pessoa escolhe e ajusta o ponto no mapa. Para
 * gravar, manda nome, endereço e a coordenada confirmada.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("logistica.entregas", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { procurar?: string; perto?: { lat?: number; lng?: number } | null; nome?: string; endereco?: string; lat?: number; lng?: number };
  if (body.procurar) {
    const q = String(body.procurar).trim().slice(0, 200);
    if (q.length < 5) return NextResponse.json({ error: "Digite o endereço completo." }, { status: 400 });
    const perto = Number.isFinite(Number(body.perto?.lat)) && Number.isFinite(Number(body.perto?.lng)) ? { lat: Number(body.perto?.lat), lng: Number(body.perto?.lng) } : null;
    const achados = await procurarEndereco(q, perto);
    return NextResponse.json({ achados });
  }
  const { data, error } = await guard.supabase.rpc("logistica_salvar_origem", { p: { nome: body.nome, endereco: body.endereco, lat: body.lat, lng: body.lng } });
  if (error) return respostaDeErro(error, "Não foi possível salvar a origem.");
  return NextResponse.json(data);
}
