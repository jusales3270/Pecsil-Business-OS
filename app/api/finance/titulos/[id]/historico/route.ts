import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../../lib/auth/feature-guard";
import { nomesDePerfis } from "../../../../../../lib/finance/nomes";

export const dynamic = "force-dynamic";

/**
 * Histórico do título: as baixas (inclusive as estornadas, que nunca somem) e a aprovação por
 * alçada (cada nível: quem decidiu e quando, e o que ainda falta). Lê com a sessão de quem pede.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyFeature(["financeiro.pagar", "financeiro.receber"]);
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const { data: titulo } = await guard.supabase
    .from("finance_titles")
    .select("id, direction, status, original_amount, approved_at, approved_by_profile_id, finance_installments(id)")
    .eq("id", id)
    .maybeSingle();
  if (!titulo) return NextResponse.json({ error: "Título não encontrado." }, { status: 404 });
  const parcelas = (titulo.finance_installments ?? []).map((i: { id: string }) => i.id);

  const [{ data: baixas }, { data: pedidos }, { data: regras }] = await Promise.all([
    parcelas.length
      ? guard.supabase.from("finance_settlements")
          .select("id, settlement_date, amount, discount, interest, notes, created_at, created_by_profile_id, reversed_at, reversed_by_profile_id, reversal_reason, finance_reconciliations(id)")
          .in("installment_id", parcelas).order("created_at")
      : Promise.resolve({ data: [] as never[] }),
    guard.supabase.from("finance_approval_requests").select("approval_level, status, decided_by_profile_id, decided_at, reason, rule_id").eq("title_id", id).order("decided_at"),
    guard.supabase.from("finance_approval_rules")
      .select("id, name, direction, min_amount, max_amount, approval_level, approver_profile_id, approver_role_id, active")
      .eq("active", true),
  ]);

  // Níveis que valem para este título (mesma conta do banco: direção e faixa de valor).
  const valor = Number(titulo.original_amount);
  const aplicaveis = (regras ?? []).filter((r) => (!r.direction || r.direction === titulo.direction) && valor >= Number(r.min_amount) && (r.max_amount == null || valor <= Number(r.max_amount)));

  const pessoas = new Set<string>();
  for (const b of baixas ?? []) { if (b.created_by_profile_id) pessoas.add(b.created_by_profile_id); if (b.reversed_by_profile_id) pessoas.add(b.reversed_by_profile_id); }
  for (const p of pedidos ?? []) if (p.decided_by_profile_id) pessoas.add(p.decided_by_profile_id);
  for (const r of aplicaveis) if (r.approver_profile_id) pessoas.add(r.approver_profile_id);
  if (titulo.approved_by_profile_id) pessoas.add(titulo.approved_by_profile_id);
  const papeis = [...new Set(aplicaveis.map((r) => r.approver_role_id).filter(Boolean))] as string[];
  const [perfis, { data: roles }] = await Promise.all([
    nomesDePerfis(guard.supabase, [...pessoas]),
    papeis.length ? guard.supabase.from("roles").select("id, name").in("id", papeis) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const nome = (pid: string | null) => (pid ? perfis.get(pid) ?? "—" : null);

  const niveis = [...new Set(aplicaveis.map((r) => r.approval_level))].sort((a, b) => a - b).map((nivel) => {
    const daRegra = aplicaveis.filter((r) => r.approval_level === nivel);
    const aprovado = (pedidos ?? []).find((p) => p.approval_level === nivel && p.status === "approved");
    const quem = daRegra.map((r) => (r.approver_profile_id ? nome(r.approver_profile_id) : r.approver_role_id ? (roles ?? []).find((x) => x.id === r.approver_role_id)?.name : "quem aprova contas")).filter(Boolean);
    return { nivel, regra: daRegra.map((r) => r.name).join(" · "), quem: [...new Set(quem)].join(" ou "), aprovadoPor: nome(aprovado?.decided_by_profile_id ?? null), aprovadoEm: aprovado?.decided_at ?? null };
  });
  const recusas = (pedidos ?? []).filter((p) => p.status === "rejected").map((p) => ({ nivel: p.approval_level, por: nome(p.decided_by_profile_id), em: p.decided_at, motivo: p.reason }));

  return NextResponse.json({
    aprovacao: { niveis, recusas, aprovadoPor: nome(titulo.approved_by_profile_id), aprovadoEm: titulo.approved_at },
    baixas: (baixas ?? []).map((b) => ({
      id: b.id, data: b.settlement_date, valor: Number(b.amount), juros: Number(b.interest ?? 0), observacao: b.notes,
      por: nome(b.created_by_profile_id), estornadaEm: b.reversed_at, estornadaPor: nome(b.reversed_by_profile_id), motivoEstorno: b.reversal_reason,
      conciliada: Array.isArray(b.finance_reconciliations) && b.finance_reconciliations.length > 0,
    })),
  });
}
