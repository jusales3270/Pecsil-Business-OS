import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

export type FunilEtapa = { id: string; code: string; label: string; kind: "aberto" | "ganho" | "perdido" };

export type FunilCard = {
  id: string;
  stageId: string;
  title: string;
  kind: "pedido" | "cobranca" | "duvida" | "outro";
  customerId: string | null;
  customerName: string | null;
  valueCents: number | null;
  dueDate: string | null;
  position: number;
  status: "aberto" | "ganho" | "perdido";
  lostReason: string | null;
  origem: "manual" | "email";
  updatedAt: string;
};

/** O quadro inteiro: etapas, cards e a lista de clientes para o formulário. */
export async function GET() {
  const guard = await requireFeature("comercial.funil");
  if ("error" in guard) return guard.error;
  const { supabase } = guard;

  const [etapasResult, cardsResult, clientesResult] = await Promise.all([
    supabase.from("crm_stages").select("id, code, label, kind, position").order("position"),
    supabase
      .from("crm_cards")
      .select("id, stage_id, title, kind, customer_id, value_cents, due_date, position, status, lost_reason, origem, updated_at, customers(name)")
      .order("position"),
    supabase.from("customers").select("id, name").eq("active", true).is("merged_into", null).order("name"),
  ]);
  if (etapasResult.error) return dbError(etapasResult.error);
  if (cardsResult.error) return dbError(cardsResult.error);

  const etapas: FunilEtapa[] = (etapasResult.data ?? []).map((linha) => ({
    id: linha.id,
    code: linha.code,
    label: linha.label,
    kind: linha.kind,
  }));

  const cards: FunilCard[] = (cardsResult.data ?? []).map((linha) => {
    const cliente = linha.customers as { name?: string } | { name?: string }[] | null;
    const nome = Array.isArray(cliente) ? cliente[0]?.name : cliente?.name;
    return {
      id: linha.id,
      stageId: linha.stage_id,
      title: linha.title,
      kind: linha.kind,
      customerId: linha.customer_id,
      customerName: nome ?? null,
      valueCents: linha.value_cents === null ? null : Number(linha.value_cents),
      dueDate: linha.due_date,
      position: Number(linha.position),
      status: linha.status,
      lostReason: linha.lost_reason,
      origem: linha.origem,
      updatedAt: linha.updated_at,
    };
  });

  return NextResponse.json({
    etapas,
    cards,
    // Cliente é opcional no card; a lista serve ao formulário. Sem acesso a
    // clientes, o card continua podendo ser criado só com o título.
    clientes: (clientesResult.data ?? []).map((linha) => ({ id: linha.id, name: linha.name })),
    canEdit: guard.access.can("comercial.funil", "operar"),
  });
}
