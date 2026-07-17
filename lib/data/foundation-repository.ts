import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import type {
  FoundationSnapshot,
  OrganizationData,
  Person,
  PersonStatus,
} from "./foundation";

type Row = Record<string, unknown>;

export async function getSupabaseFoundationSnapshot(): Promise<FoundationSnapshot> {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHENTICATED");

  const profileResult = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .single();
  if (profileResult.error) throw profileResult.error;
  const organizationId = profileResult.data.organization_id as string;

  const [
    organizationResult,
    employeesResult,
    employeeCountResult,
    activeEmployeeCountResult,
    userCountResult,
    roleCountResult,
    unitsResult,
    departmentsResult,
    teamsResult,
    positionsResult,
  ] = await Promise.all([
    supabase.from("organizations").select("id,display_name").eq("id", organizationId).single(),
    supabase.from("employees").select("id,full_name,corporate_email,active,employee_number,profiles!employees_profile_id_fkey(email,status),positions(name),departments(name),units(name)").eq("organization_id", organizationId).limit(100),
    supabase.from("employees").select("id", { count:"exact", head:true }).eq("organization_id", organizationId),
    supabase.from("employees").select("id", { count:"exact", head:true }).eq("organization_id", organizationId).eq("active", true),
    supabase.from("profiles").select("id", { count:"exact", head:true }).eq("organization_id", organizationId),
    supabase.from("roles").select("id", { count:"exact", head:true }).eq("organization_id", organizationId),
    supabase.from("units").select("id,name,city,state").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("departments").select("id,name,units(name)").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("teams").select("id,name,departments(name)").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("positions").select("id,name,level").eq("organization_id", organizationId).eq("active", true).order("name"),
  ]);

  const results = [organizationResult, employeesResult, unitsResult, departmentsResult, teamsResult, positionsResult];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const employees = (employeesResult.data ?? []) as unknown as Row[];
  const units = (unitsResult.data ?? []) as unknown as Row[];
  const departments = (departmentsResult.data ?? []) as unknown as Row[];
  const teams = (teamsResult.data ?? []) as unknown as Row[];
  const positions = (positionsResult.data ?? []) as unknown as Row[];

  return {
    source: "supabase",
    organization: {
      id: organizationId,
      name: String(organizationResult.data.display_name ?? "Pecsil"),
    },
    summary: {
      employees: employeeCountResult.count ?? employees.length,
      activeEmployees: activeEmployeeCountResult.count ?? employees.filter(row => row.active).length,
      users: userCountResult.count ?? 0,
      roles: roleCountResult.count ?? 0,
      units: units.length,
      departments: departments.length,
      teams: teams.length,
      positions: positions.length,
    },
    people: employees.map(toPerson),
    organizationData: toOrganizationData(units, departments, teams, positions),
    loadedAt: new Date().toISOString(),
  };
}

function toPerson(row: Row): Person {
  const name = String(row.full_name ?? "Colaborador");
  const profile = relation(row.profiles);
  return {
    initials: initials(name),
    name,
    email: String(row.corporate_email ?? profile.email ?? "E-mail não informado"),
    role: relationName(row.positions, "Cargo não informado"),
    department: relationName(row.departments, "Sem departamento"),
    unit: relationName(row.units, "Sem unidade"),
    profile: "Perfil vinculado",
    status: accountStatus(profile.status, Boolean(row.active)),
  };
}

function toOrganizationData(units: Row[], departments: Row[], teams: Row[], positions: Row[]): OrganizationData {
  return {
    Unidades: units.map(row => ({
      name:String(row.name), meta:"Unidade ativa", detail:[row.city,row.state].filter(Boolean).join(" · ") || "Localização não informada", count:"Cadastro real", icon:"building",
    })),
    Departamentos: departments.map(row => ({
      name:String(row.name), meta:relationName(row.units,"Pecsil"), detail:"Estrutura vinculada", count:"Cadastro real", icon:departmentIcon(String(row.name)),
    })),
    Equipes: teams.map(row => ({
      name:String(row.name), meta:relationName(row.departments,"Departamento"), detail:"Equipe ativa", count:"Cadastro real", icon:"team",
    })),
    Cargos: positions.map(row => ({
      name:String(row.name), meta:String(row.level ?? "Catálogo corporativo"), detail:"Cargo ativo", count:"Cadastro real", icon:"briefcase",
    })),
  };
}

function relation(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return value && typeof value === "object" ? value as Row : {};
}

function relationName(value: unknown, fallback: string) {
  return String(relation(value).name ?? fallback);
}

function initials(name: string) {
  return name.split(/\s+/).slice(0,2).map(part => part[0]?.toUpperCase()).join("") || "--";
}

function accountStatus(value: unknown, active: boolean): PersonStatus {
  if (!active || value === "blocked" || value === "disabled") return "Bloqueado";
  if (value === "invited") return "Pendente";
  return "Ativo";
}

function departmentIcon(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("produ")) return "factory";
  if (normalized.includes("qualidade")) return "check";
  if (normalized.includes("recurso") || normalized.includes("rh")) return "users";
  return "org";
}
