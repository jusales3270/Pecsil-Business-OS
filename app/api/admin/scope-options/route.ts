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
  const [modules, units, departments, teams] = await Promise.all([
    // Módulos habilitados para esta organização — é o eixo principal de acesso.
    admin
      .from("organization_modules")
      .select("module_code, enabled, module:modules(code, name, status)")
      .eq("organization_id", auth.orgId)
      .eq("enabled", true),
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
    modules: (modules.data ?? [])
      .map((row) => row.module as { code?: string; name?: string; status?: string } | null)
      .filter((mod): mod is { code: string; name: string; status: string } => Boolean(mod?.code))
      .map((mod) => ({ code: mod.code, name: mod.name, status: mod.status })),
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
