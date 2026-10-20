import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { fleetbaseConfigurado } from "../../../../lib/logistica/fleetbase";
import { conferirAbertas, designarMotorista, enviarAoFleetbase, respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/** Entregas (as mais recentes primeiro), a origem configurada e se o serviço de entregas está ligado. */
export async function GET() {
  const guard = await requireFeature("logistica.entregas", "ver");
  if ("error" in guard) return guard.error;
  await conferirAbertas();
  const [entregas, origem, links] = await Promise.all([
    guard.supabase.from("logistica_entregas").select("*").order("numero", { ascending: false }).limit(300),
    guard.supabase.from("logistica_config").select("origem_nome, origem_endereco, origem_lat, origem_lng, updated_at, updated_by_nome").maybeSingle(),
    guard.supabase.from("logistica_links").select("id, entrega_id, expira_em, aberturas, ultima_abertura, criado_por_nome, created_at")
      .eq("situacao", "aberto").gt("expira_em", new Date().toISOString()),
  ]);
  if (entregas.error) return respostaDeErro(entregas.error, "Não foi possível ler as entregas.");
  return NextResponse.json({
    entregas: entregas.data ?? [], origem: origem.data ?? null, links: links.data ?? [],
    servico: fleetbaseConfigurado(), podeOperar: guard.access.can("logistica.entregas", "operar"),
  });
}

/** Nova entrega: grava na plataforma e manda ao Fleetbase (se falhar, fica gravada com o erro para tentar de novo). */
export async function POST(request: Request) {
  const guard = await requireFeature("logistica.entregas", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const p = {
    customer_id: String(body.customer_id ?? ""), origem_tipo: String(body.origem_tipo ?? "avulsa"),
    origem_id: body.origem_id ? String(body.origem_id) : null, descricao: String(body.descricao ?? ""),
  };
  const { data, error } = await guard.supabase.rpc("logistica_criar_entrega", { p });
  if (error) return respostaDeErro(error, "Não foi possível criar a entrega.");
  try {
    const enviada = await enviarAoFleetbase(guard.supabase, (data as { id: string }).id);
    // Motorista escolhido já na criação: designa e despacha (se falhar, a entrega fica com a frota, sem motorista).
    let aviso: string | null = null;
    if (body.motorista_id && enviada.situacao === "enviada") {
      try { await designarMotorista(guard.supabase, enviada.id, String(body.motorista_id)); }
      catch (err) { aviso = `Entrega com a frota, mas o motorista não foi designado: ${err instanceof Error ? err.message : "tente de novo"}`; }
    }
    const { data: atual } = await guard.supabase.from("logistica_entregas").select("*").eq("id", enviada.id).single();
    return NextResponse.json({ ...(atual ?? enviada), aviso }, { status: 201 });
  } catch (error) {
    return respostaDeErro(error, "A entrega foi criada, mas não foi possível mandá-la à frota.");
  }
}
