import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { pessoasAprovadoras } from "../../../../lib/finance/nomes";

export const dynamic = "force-dynamic";

/**
 * Alçadas de aprovação do Financeiro (regras da organização). Ler: quem trabalha com contas ou com
 * a Homologação. Gravar: Homologação do Financeiro (operar); o banco confere de novo.
 */
export async function GET() {
  const guard = await requireAnyFeature(["financeiro.pagar", "financeiro.receber", "financeiro.homologacao"]);
  if ("error" in guard) return guard.error;
  const [{ data: regras, error }, pessoas, { data: papeis }] = await Promise.all([
    guard.supabase.from("finance_approval_rules")
      .select("id, name, direction, min_amount, max_amount, approval_level, approver_profile_id, approver_role_id, active")
      .order("direction").order("approval_level").order("min_amount"),
    pessoasAprovadoras(guard.supabase),
    guard.supabase.from("roles").select("id, name").order("name"),
  ]);
  if (error) return NextResponse.json({ error: "Não foi possível carregar as alçadas." }, { status: 500 });
  return NextResponse.json({
    regras: (regras ?? []).map((r) => ({ ...r, min_amount: Number(r.min_amount), max_amount: r.max_amount == null ? null : Number(r.max_amount) })),
    pessoas,
    papeis: papeis ?? [],
    podeEditar: guard.access.can("financeiro.homologacao", "operar"),
  });
}

export async function POST(request: Request) {
  const guard = await requireAnyFeature(["financeiro.homologacao", "financeiro.pagar", "financeiro.receber"]);
  if ("error" in guard) return guard.error;
  if (!guard.access.can("financeiro.homologacao", "operar")) return NextResponse.json({ error: "Alçadas são da Homologação do Financeiro." }, { status: 403 });
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo) return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });
  const p: Record<string, unknown> = {};
  for (const k of ["id", "name", "direction", "min_amount", "max_amount", "approval_level", "approver_profile_id", "approver_role_id", "active"]) if (k in corpo) p[k] = corpo[k] === null ? "" : corpo[k];
  const { data, error } = await guard.supabase.rpc("finance_alcada_salvar", { p });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ id: data });
}
