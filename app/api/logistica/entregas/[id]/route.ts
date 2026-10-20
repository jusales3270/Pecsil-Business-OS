import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { fleetbase } from "../../../../../lib/logistica/fleetbase";
import { designarMotorista, enviarAoFleetbase, respostaDeErro } from "../../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/**
 * Ações numa entrega: "reenviar" (tentar de novo mandar à frota), "designar" (o motorista da frota, que recebe
 * no celular), "cancelar" (com o motivo), "link" (link de rastreio para o cliente) e "cancelar_link".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("logistica.entregas", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { acao?: string; motivo?: string; link?: string; motorista?: string };
  try {
    if (body.acao === "reenviar") return NextResponse.json(await enviarAoFleetbase(guard.supabase, id));
    if (body.acao === "designar") {
      await designarMotorista(guard.supabase, id, String(body.motorista ?? ""));
      const { data } = await guard.supabase.from("logistica_entregas").select("*").eq("id", id).single();
      return NextResponse.json(data);
    }
    if (body.acao === "link") {
      // Link de rastreio para o cliente: o código sai UMA vez (no banco fica só o hash).
      const { data, error } = await guard.supabase.rpc("logistica_link_criar", { p_entrega: id, p_dias: 3 });
      if (error) return respostaDeErro(error, "Não foi possível gerar o link.");
      return NextResponse.json(data);
    }
    if (body.acao === "cancelar_link") {
      const { error } = await guard.supabase.rpc("logistica_link_cancelar", { p_id: String((body as { link?: string }).link ?? "") });
      if (error) return respostaDeErro(error, "Não foi possível cancelar o link.");
      return NextResponse.json({ ok: true });
    }
    if (body.acao === "cancelar") {
      const { data, error } = await guard.supabase.rpc("logistica_cancelar_entrega", { p_id: id, p_motivo: String(body.motivo ?? "") });
      if (error) return respostaDeErro(error, "Não foi possível cancelar a entrega.");
      const ordem = (data as { fleetbase_ordem?: string | null }).fleetbase_ordem;
      // A entrega já está cancelada na plataforma; se o Fleetbase não responder, o despacho cancela lá também.
      let aviso: string | null = null;
      if (ordem) await fleetbase.cancelarOrdem(ordem).catch(() => { aviso = "Cancelada aqui; o serviço de entregas não respondeu: cancele a ordem lá também."; });
      return NextResponse.json({ ...(data as object), aviso });
    }
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    return respostaDeErro(error, "Não foi possível concluir a ação.");
  }
}
