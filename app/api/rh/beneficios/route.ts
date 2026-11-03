import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import type { FichaBeneficios } from "../../../../lib/rh/beneficio";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const um = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Row | null | undefined;
const texto = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const valor = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Ficha do colaborador › Benefícios: tudo o que a plataforma tem dele — adesões (em vigor e encerradas, com o
 * valor, o fornecedor e os dependentes) e todas as movimentações (pedida por quem, decidida por quem). Lido na
 * hora em que a aba abre, pela sessão (RLS): quem não tem RH › Benefícios não vê.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("rh.beneficios");
  if ("error" in guard) return guard.error;
  const colaborador = new URL(request.url).searchParams.get("colaborador") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(colaborador)) return NextResponse.json({ error: "Informe o colaborador." }, { status: 400 });

  const [adesoes, movimentacoes] = await Promise.all([
    guard.supabase.from("rh_benefit_enrollments")
      .select("id,active,enrolled_at,ended_at,monthly_value,rh_benefit_plans(name,provider,employee_contribution,eligibility_rule),rh_benefit_dependents(full_name,relationship,birth_date,active)")
      .eq("employee_id", colaborador).order("active", { ascending: false }).order("enrolled_at", { ascending: false }),
    guard.supabase.from("rh_benefit_requests")
      .select("id,action,status,reason,effective_date,monthly_value,requested_at,decided_at,rh_benefit_plans(name),pedida:profiles!rh_benefit_requests_requested_by_profile_id_fkey(full_name),decidida:profiles!rh_benefit_requests_decided_by_profile_id_fkey(full_name)")
      .eq("employee_id", colaborador).order("requested_at", { ascending: false }).limit(500),
  ]);
  if (adesoes.error || movimentacoes.error) {
    console.error("Benefícios da ficha", adesoes.error ?? movimentacoes.error);
    return NextResponse.json({ error: "Não foi possível ler os benefícios agora." }, { status: 500 });
  }

  const resposta: FichaBeneficios = {
    adesoes: ((adesoes.data ?? []) as Row[]).map((r) => {
      const plano = um(r.rh_benefit_plans);
      return {
        id: String(r.id), plano: texto(plano?.name) ?? "—", fornecedor: texto(plano?.provider), contribuicao: texto(plano?.employee_contribution),
        regra: texto(plano?.eligibility_rule), inicio: String(r.enrolled_at), fim: texto(r.ended_at), ativa: Boolean(r.active), valor: valor(r.monthly_value),
        dependentes: ((Array.isArray(r.rh_benefit_dependents) ? r.rh_benefit_dependents : []) as Row[]).filter((d) => d.active !== false)
          .map((d) => ({ nome: String(d.full_name), parentesco: texto(d.relationship), nascimento: texto(d.birth_date) })),
      };
    }),
    movimentacoes: ((movimentacoes.data ?? []) as Row[]).map((r) => ({
      id: String(r.id), plano: texto(um(r.rh_benefit_plans)?.name) ?? "—",
      acao: r.action as FichaBeneficios["movimentacoes"][number]["acao"], situacao: r.status as FichaBeneficios["movimentacoes"][number]["situacao"],
      vigencia: texto(r.effective_date), valor: valor(r.monthly_value), justificativa: texto(r.reason),
      pedidaEm: String(r.requested_at), pedidaPor: texto(um(r.pedida)?.full_name), decididaEm: texto(r.decided_at), decididaPor: texto(um(r.decidida)?.full_name),
    })),
  };
  return NextResponse.json(resposta, { headers: { "cache-control": "private, no-store" } });
}
