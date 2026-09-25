import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import type {
  RhAbsence,
  RhBenefitPlan,
  RhBenefitRequest,
  RhDocument,
  RhSnapshot,
  RhSstRecord,
} from "./rh";

type Row = Record<string, unknown>;

// Lê o RH real das tabelas rh_*, no escopo do usuário autenticado. Segue o
// mesmo contrato do Financeiro: lança UNAUTHENTICATED sem sessão, e o RLS do
// banco decide o que cada perfil enxerga — este código não filtra por papel.
export async function getSupabaseRhSnapshot(): Promise<RhSnapshot> {
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

  const ABSENCE_FIELDS = "id,absence_type,start_date,end_date,days,hours,day_part,status,has_conflict,reason,requested_at,employees(full_name),departments(name),units(name)";
  const [
    employeesResult,
    activeEmployeesResult,
    absencesResult,
    openAbsencesResult,
    pendingAbsencesResult,
    vacationResult,
    plansResult,
    enrollmentsResult,
    benefitRequestsResult,
    sstResult,
    sstAlertsResult,
    departmentsResult,
    documentsResult,
  ] = await Promise.all([
    supabase.from("employees").select("id", { count:"exact", head:true })
      .eq("organization_id", organizationId),
    supabase.from("employees").select("id", { count:"exact", head:true })
      .eq("organization_id", organizationId).eq("active", true),
    // Movimentações recentes (inclui o histórico importado)…
    supabase
      .from("rh_absences")
      .select(ABSENCE_FIELDS)
      .eq("organization_id", organizationId)
      .order("start_date", { ascending:false })
      .limit(20),
    // …e, à parte, TODAS as que aguardam decisão: o histórico não pode
    // empurrar uma solicitação pendente para fora da tela.
    supabase
      .from("rh_absences")
      .select(ABSENCE_FIELDS)
      .eq("organization_id", organizationId)
      .in("status", ["pending", "under_review"])
      .order("requested_at", { ascending:false })
      .limit(200),
    supabase.from("rh_absences").select("id", { count:"exact", head:true })
      .eq("organization_id", organizationId).in("status", ["pending", "under_review"]),
    supabase.from("rh_vacation_balances")
      .select("entitled_days,taken_days,scheduled_days,pecuniary_days,expires_at")
      .eq("organization_id", organizationId),
    supabase
      .from("rh_benefit_plans")
      .select("id,name,category,provider,monthly_cost,employee_contribution,eligibility_rule,status")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("name"),
    supabase.from("rh_benefit_enrollments").select("plan_id")
      .eq("organization_id", organizationId).eq("active", true),
    supabase
      .from("rh_benefit_requests")
      .select("id,action,status,reason,effective_date,requested_at,employees(full_name,departments(name)),rh_benefit_plans(name)")
      .eq("organization_id", organizationId)
      .order("requested_at", { ascending:false })
      .limit(20),
    supabase
      .from("rh_sst_records")
      .select("id,category,title,due_date,status,risk,note,clinical_confidential,employees(full_name),departments(name),units(name)")
      .eq("organization_id", organizationId)
      .order("due_date", { ascending:true, nullsFirst:false })
      .limit(20),
    supabase.from("rh_sst_records").select("id", { count:"exact", head:true })
      .eq("organization_id", organizationId).in("status", ["due_soon", "overdue"]),
    supabase.from("employees").select("id,full_name,departments(name),units(name)")
      .eq("organization_id", organizationId).eq("active", true).order("full_name"),
    supabase
      .from("documents")
      .select("id,title,category,version,object_path,review_due_at,signature_status,classification,updated_at,employees(full_name)")
      .eq("organization_id", organizationId)
      .eq("module_code", "rh")
      .eq("active", true)
      .order("updated_at", { ascending:false })
      .limit(50),
  ]);

  const failed = [
    employeesResult, activeEmployeesResult, absencesResult, openAbsencesResult, pendingAbsencesResult,
    vacationResult, plansResult, enrollmentsResult, benefitRequestsResult, sstResult,
    sstAlertsResult, departmentsResult, documentsResult,
  ].find(result => result.error);
  if (failed?.error) throw failed.error;

  const benefitRequests = ((benefitRequestsResult.data ?? []) as unknown as Row[]).map(toBenefitRequest);
  const documents = ((documentsResult.data ?? []) as unknown as Row[]).map(toDocument);

  const openAbsences = ((openAbsencesResult.data ?? []) as unknown as Row[]).map(toAbsence);
  const openIds = new Set(openAbsences.map(absence => absence.id));
  const absences = [
    ...openAbsences,
    ...((absencesResult.data ?? []) as unknown as Row[]).map(toAbsence).filter(absence => !openIds.has(absence.id)),
  ];
  const sstRecords = ((sstResult.data ?? []) as unknown as Row[]).map(toSstRecord);

  // Membros por plano, contados a partir das adesões ativas.
  const enrollments = (enrollmentsResult.data ?? []) as unknown as Row[];
  const membersByPlan = enrollments.reduce<Record<string, number>>((acc, row) => {
    const planId = String(row.plan_id);
    acc[planId] = (acc[planId] ?? 0) + 1;
    return acc;
  }, {});
  const eligible = activeEmployeesResult.count ?? 0;
  const benefitPlans = ((plansResult.data ?? []) as unknown as Row[])
    .map(row => toBenefitPlan(row, membersByPlan[String(row.id)] ?? 0, eligible));

  const balances = (vacationResult.data ?? []) as unknown as Row[];
  const scheduledVacationDays = balances.reduce((sum, row) => sum + number(row.scheduled_days), 0);
  // Período com saldo = direito menos gozado, programado e abono. O concessivo
  // (expires_at) é o prazo da empresa para conceder; passou, paga em dobro.
  const today = new Date().toISOString().slice(0, 10);
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const withBalance = balances.filter(row =>
    row.expires_at &&
    number(row.entitled_days) - number(row.taken_days) - number(row.scheduled_days) - number(row.pecuniary_days) > 0);
  const vacationsOverdue = withBalance.filter(row => String(row.expires_at) < today).length;
  const vacationsDueSoon = withBalance.filter(row => String(row.expires_at) >= today && String(row.expires_at) <= in60).length;
  const benefitMonthlyCost = benefitPlans.reduce((sum, plan) => sum + plan.monthlyCost, 0);

  // Distribuição por departamento, a partir dos colaboradores ativos reais.
  const departmentRows = (departmentsResult.data ?? []) as unknown as Row[];
  const countByDept = departmentRows.reduce<Record<string, number>>((acc, row) => {
    const name = relationName(row.departments) ?? "Sem departamento";
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
  const totalPeople = departmentRows.length || 1;
  const departmentShares = Object.entries(countByDept)
    .map(([name, people]) => ({ name, people, percentage: Math.round((people / totalPeople) * 100) }))
    .sort((a, b) => b.people - a.people)
    .slice(0, 6);

  const employees = departmentRows.map(row => ({
    id: String(row.id),
    name: String(row.full_name),
    department: relationName(row.departments),
    unit: relationName(row.units),
  }));

  return {
    source: "supabase",
    organizationId,
    summary: {
      employees: employeesResult.count ?? 0,
      activeEmployees: activeEmployeesResult.count ?? 0,
      pendingAbsences: pendingAbsencesResult.count ?? 0,
      scheduledVacationDays,
      vacationsDueSoon,
      vacationsOverdue,
      sstAlerts: sstAlertsResult.count ?? 0,
      benefitMonthlyCost,
    },
    absences,
    benefitPlans,
    benefitRequests,
    sstRecords,
    documents,
    departmentShares,
    employees,
    loadedAt: new Date().toISOString(),
  };
}

function toAbsence(row: Row): RhAbsence {
  return {
    id: String(row.id),
    employeeName: relationName(row.employees) ?? "Não informado",
    department: relationName(row.departments),
    unit: relationName(row.units),
    type: row.absence_type as RhAbsence["type"],
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    days: number(row.days),
    hours: row.hours == null ? null : number(row.hours),
    dayPart: row.day_part === "manha" || row.day_part === "tarde" ? row.day_part : null,
    status: row.status as RhAbsence["status"],
    hasConflict: Boolean(row.has_conflict),
    reason: row.reason ? String(row.reason) : null,
    requestedAt: formatDateTime(row.requested_at),
  };
}

function toBenefitPlan(row: Row, members: number, eligible: number): RhBenefitPlan {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as RhBenefitPlan["category"],
    provider: row.provider ? String(row.provider) : null,
    monthlyCost: number(row.monthly_cost),
    members,
    eligible,
    employeeContribution: row.employee_contribution ? String(row.employee_contribution) : null,
    eligibilityRule: row.eligibility_rule ? String(row.eligibility_rule) : null,
    status: row.status as RhBenefitPlan["status"],
  };
}

function toDocument(row: Row): RhDocument {
  const classification = String(row.classification ?? "internal");
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category ?? "—"),
    employeeName: relationName(row.employees),
    version: String(row.version ?? "1.0"),
    objectPath: row.object_path ? String(row.object_path) : "",
    reviewDueAt: row.review_due_at ? String(row.review_due_at) : null,
    signature: (row.signature_status as RhDocument["signature"]) ?? null,
    // Documento sensível = classificação confidencial ou restrita.
    sensitive: classification === "confidential" || classification === "restricted",
    updatedAt: formatDateTime(row.updated_at),
  };
}

function toBenefitRequest(row: Row): RhBenefitRequest {
  const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
  const department = employee && typeof employee === "object" ? relationName((employee as Row).departments) : null;
  return {
    id: String(row.id),
    employeeName: relationName(row.employees) ?? "Não informado",
    department,
    planName: relationName(row.rh_benefit_plans) ?? "—",
    action: row.action as RhBenefitRequest["action"],
    status: row.status as RhBenefitRequest["status"],
    reason: row.reason ? String(row.reason) : null,
    effectiveDate: row.effective_date ? String(row.effective_date) : null,
    requestedAt: formatDateTime(row.requested_at),
  };
}

function toSstRecord(row: Row): RhSstRecord {
  return {
    id: String(row.id),
    employeeName: relationName(row.employees) ?? "Não informado",
    department: relationName(row.departments),
    unit: relationName(row.units),
    category: row.category as RhSstRecord["category"],
    title: String(row.title),
    dueDate: row.due_date ? String(row.due_date) : null,
    status: row.status as RhSstRecord["status"],
    risk: row.risk as RhSstRecord["risk"],
    note: row.note ? String(row.note) : null,
    sensitive: Boolean(row.clinical_confidential),
  };
}

function formatDateTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle:"medium", timeStyle:"short" }).format(date);
}

function relationName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return "name" in row
    ? String((row as Row).name)
    : "full_name" in row
      ? String((row as Row).full_name)
      : null;
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
