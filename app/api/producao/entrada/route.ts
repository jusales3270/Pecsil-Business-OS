import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { lerNumeroBr } from "../../../../lib/numero-br";

export const dynamic = "force-dynamic";

/**
 * Produção › Entrada de produção (Rafael; decisão O3: manual). Itens dos orçamentos ganhos com o
 * que já foi produzido e faturado; lançar libera o faturamento, estornar corrige engano.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("producao.entrada", "ver");
  if ("error" in guard) return guard.error;
  // ?treino=1: os orçamentos de treino (o faturamento deles é o do treino do Fiscal).
  const treino = new URL(request.url).searchParams.get("treino") === "1";
  const { data: linhas, error } = await guard.supabase.rpc("fiscal_a_faturar", { p_ambiente: treino ? "treino" : "producao" });
  if (error) return dbError(error);
  // Também os itens já todo produzidos e não faturados aparecem (falta > 0); os totalmente faturados saem.
  const itens = (linhas ?? []) as { item_id: string }[];
  const ids = itens.map((i) => i.item_id);
  const { data: entradas } = ids.length
    ? await guard.supabase.from("production_entries").select("id, quote_item_id, quantidade, data, observacao, created_by_name, created_at").in("quote_item_id", ids).order("created_at", { ascending: false })
    : { data: [] };
  return NextResponse.json({ itens, entradas: entradas ?? [], podeOperar: guard.access.can("producao.entrada", "operar") });
}

export async function POST(request: Request) {
  const guard = await requireFeature("producao.entrada", "operar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => null)) as { item?: string; quantidade?: unknown; observacao?: string } | null;
  const quantidade = lerNumeroBr(b?.quantidade);
  if (!b?.item || !(quantidade > 0)) return NextResponse.json({ error: "Informe o item e a quantidade produzida." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("producao_entrada_registrar", { p_item: b.item, p_quantidade: quantidade, p_observacao: b.observacao ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ id: data });
}

/** Estorno (?id=): só o que ainda não foi faturado de verdade. */
export async function DELETE(request: Request) {
  const guard = await requireFeature("producao.entrada", "operar");
  if ("error" in guard) return guard.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Informe a entrada." }, { status: 400 });
  const { error } = await guard.supabase.rpc("producao_entrada_estornar", { p_entrada: id });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true });
}
