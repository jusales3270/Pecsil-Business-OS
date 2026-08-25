import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { authorize } from "../../../../lib/auth/admin-users";

export const dynamic = "force-dynamic";

/**
 * Entidades da estrutura organizacional que podem receber um escopo de acesso.
 * Alimenta os seletores do formulário de usuário — sem isso a interface só
 * conseguia oferecer "toda a empresa" e "próprio registro".
 */
export async function GET() {
  const auth = await authorize();
  if ("error" in auth) return auth.error;

  const admin = createSupabaseAdminClient();
  const [units, departments, teams] = await Promise.all([
    admin
      .from("units")
      .select("id, name")
      .eq("organization_id", auth.orgId)
      .eq("active", true)
      .order("name"),
    admin
      .from("departments")
      .select("id, name, unit_id")
      .eq("organization_id", auth.orgId)
      .eq("active", true)
      .order("name"),
    admin
      .from("teams")
      .select("id, name, department_id")
      .eq("organization_id", auth.orgId)
      .eq("active", true)
      .order("name"),
  ]);

  return NextResponse.json({
    units: (units.data ?? []).map((unit) => ({ id: unit.id, name: unit.name })),
    departments: (departments.data ?? []).map((department) => ({
      id: department.id,
      name: department.name,
      unitId: department.unit_id,
    })),
    teams: (teams.data ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      departmentId: team.department_id,
    })),
  });
}
