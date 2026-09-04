import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { authorize } from "../../../../lib/auth/admin-users";

export const dynamic = "force-dynamic";

/**
 * Entidades da estrutura organizacional que podem receber um escopo de acesso.
 * Alimenta os seletores do formulário de usuário — sem isso a interface só
 * conseguia oferecer "toda a empresa" e "próprio registro".
 */
const OFFICIAL_INTEGRATED_MODULES = [
  { code: "rh", name: "Recursos Humanos", status: "integrated" },
  { code: "financeiro", name: "Financeiro", status: "integrated" },
  { code: "compras", name: "Compras", status: "integrated" },
  { code: "portaria", name: "Portaria & Acesso", status: "integrated" },
];

export async function GET() {
  const auth = await authorize();
  if ("error" in auth) return auth.error;

  const admin = createSupabaseAdminClient();

  // Sincroniza em background os módulos integrados oficiais para a organização
  try {
    await admin.from("modules").upsert(
      OFFICIAL_INTEGRATED_MODULES.map((m) => ({
        code: m.code,
        name: m.name,
        version: "1.0.0",
        route: `/modules/${m.code}`,
        entry_permission: `${m.code}.view`,
        status: "integrated",
      })),
      { onConflict: "code" },
    );

    await admin.from("organization_modules").upsert(
      OFFICIAL_INTEGRATED_MODULES.map((m) => ({
        organization_id: auth.orgId,
        module_code: m.code,
        enabled: true,
        menu_enabled: true,
      })),
      { onConflict: "organization_id,module_code" },
    );
  } catch (err) {
    console.warn("Aviso ao sincronizar módulos na organização:", err);
  }

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

  const dbModules = (modules.data ?? [])
    .map((row) => row.module as { code?: string; name?: string; status?: string } | null)
    .filter((mod): mod is { code: string; name: string; status: string } => Boolean(mod?.code))
    .map((mod) => ({ code: mod.code, name: mod.name, status: mod.status }));

  // Mescla para garantir que todos os 4 módulos oficiais estejam sempre presentes
  const moduleMap = new Map<string, { code: string; name: string; status: string }>();
  for (const m of OFFICIAL_INTEGRATED_MODULES) {
    moduleMap.set(m.code, m);
  }
  for (const m of dbModules) {
    moduleMap.set(m.code, m);
  }

  return NextResponse.json({
    modules: Array.from(moduleMap.values()),
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
