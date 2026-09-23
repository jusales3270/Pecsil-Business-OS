import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { PASSO } from "../../../../../lib/kanban/fractional-indexing";

export const dynamic = "force-dynamic";

const TIPOS = ["pedido", "cobranca", "duvida", "outro"] as const;

/**
 * Card novo, criado à mão. É o pedido que chega por telefone ou pelo WhatsApp
 * do diretor: entra na primeira etapa aberta do funil e passa a ser
 * acompanhado como qualquer outro.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("comercial.funil", "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));

  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Escreva do que se trata." }, { status: 400 });
  const kind = TIPOS.includes(body.kind) ? body.kind : "pedido";

  let valueCents: number | null = null;
  if (body.value !== undefined && body.value !== null && String(body.value).trim() !== "") {
    const numero = Number(String(body.value).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(numero) || numero < 0) {
      return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
    }
    valueCents = Math.round(numero * 100);
  }

  // Etapa de entrada: a primeira aberta do funil.
  const { data: etapa, error: etapaError } = await guard.supabase
    .from("crm_stages")
    .select("id")
    .eq("kind", "aberto")
    .order("position")
    .limit(1)
    .maybeSingle();
  if (etapaError) return dbError(etapaError);
  if (!etapa) return NextResponse.json({ error: "Funil sem etapas." }, { status: 503 });

  // Card novo entra no fim da coluna.
  const { data: ultimo } = await guard.supabase
    .from("crm_cards")
    .select("position")
    .eq("stage_id", etapa.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: organizationId }, { data: profileId }] = await Promise.all([
    guard.supabase.rpc("current_organization_id"),
    guard.supabase.rpc("current_profile_id"),
  ]);
  if (!organizationId) return NextResponse.json({ error: "Organização não encontrada." }, { status: 400 });

  const { data, error } = await guard.supabase
    .from("crm_cards")
    .insert({
      organization_id: organizationId,
      stage_id: etapa.id,
      title,
      kind,
      customer_id: body.customerId || null,
      value_cents: valueCents,
      due_date: body.dueDate || null,
      position: ultimo ? Number(ultimo.position) + PASSO : PASSO,
      origem: "manual",
      created_by_profile_id: profileId ?? null,
      owner_profile_id: profileId ?? null,
    })
    .select("id")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ id: data.id });
}
