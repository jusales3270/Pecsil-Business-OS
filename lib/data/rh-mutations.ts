import "server-only";

import { createSupabaseAdminClient } from "../supabase/admin";
import { createSupabaseServerClient } from "../supabase/server";

// Mutações de decisão do RH, executadas com a sessão do usuário. Toda a
// autorização é do banco: as policies de escrita (rh_absences_decide,
// rh_benefit_requests_decide, rh_sst_manage) exigem a permissão certa. Se o
// usuário não puder, o próprio PostgreSQL recusa — este código não checa papel.

export type RhSstEdit = {
  title?: string;
  category?: "exam" | "training" | "ppe" | "incident";
  dueDate?: string | null;
  risk?: "critical" | "attention" | "regular";
  note?: string | null;
};

/** Edição de uma ausência já lançada (quem aprova férias pode corrigir). */
export type RhAbsenceEdit = {
  absenceType: string;
  startDate: string;
  endDate: string;
  /** Em dias; 0 quando a ausência é em horas ou meio período. */
  days: number;
  reason: string | null;
};

/** Edição do cadastro do colaborador (tabela employees). */
export type RhEmployeeEdit = {
  fullName: string;
  employeeNumber: string;
  corporateEmail: string | null;
  admissionDate: string | null;
  /** Demissão: preenchida, o vínculo fica inativo a partir desta data. */
  terminationDate: string | null;
  departmentName: string | null;
  unitName: string | null;
  positionName: string | null;
  /** Dados pessoais (tabela protegida). Ausente = não mexe; CPF só com 11 dígitos. */
  cpf?: string | null;
  phone?: string | null;
};

export type RhMutation =
  | { entity: "absence"; id: string; decision: "approved" | "rejected" }
  | { entity: "absence"; id: string; action: "update"; changes: RhAbsenceEdit }
  | { entity: "absence"; id: string; action: "delete" }
  | { entity: "employee"; id: string; action: "update"; changes: RhEmployeeEdit }
  | { entity: "employee"; id: string; action: "delete"; confirmName: string }
  | { entity: "benefit_request"; id: string; decision: "approved" | "rejected" }
  | { entity: "sst"; id: string; action: "mark_compliant" }
  | { entity: "sst"; id: string; action: "update"; changes: RhSstEdit };

export async function applyRhMutation(mutation: RhMutation): Promise<{ ok: true }> {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHENTICATED");

  // Perfil do decisor, para registrar quem decidiu.
  const profileResult = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .single();
  if (profileResult.error) throw profileResult.error;
  const profileId = profileResult.data.id as string;
  const now = new Date().toISOString();

  if (mutation.entity === "absence" && "action" in mutation && mutation.action === "update") {
    const c = mutation.changes;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(c.endDate) || c.endDate < c.startDate) {
      throw new Error("RH_INVALID");
    }
    const { data, error } = await supabase
      .from("rh_absences")
      .update({ absence_type: c.absenceType, start_date: c.startDate, end_date: c.endDate, days: c.days, reason: c.reason })
      .eq("id", mutation.id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("RH_MUTATION_DENIED");
    return { ok: true };
  }

  if (mutation.entity === "absence" && "action" in mutation && mutation.action === "delete") {
    // rh_absences_delete: rh.ferias em "aprovar". O gatilho de auditoria
    // registra a exclusão; o dado clínico da ausência vai junto (cascata).
    const { data, error } = await supabase.from("rh_absences").delete().eq("id", mutation.id).select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("RH_MUTATION_DENIED");
    return { ok: true };
  }

  if (mutation.entity === "employee") {
    return mutation.action === "update"
      ? updateRhEmployee(supabase, mutation.id, mutation.changes)
      : deleteRhEmployee(supabase, { id: mutation.id, confirmName: mutation.confirmName, profileId, userId: authData.user.id });
  }

  if (mutation.entity === "absence" && "decision" in mutation) {
    // O CHECK da tabela exige decided_at preenchido quando aprovado/reprovado.
    const { data, error } = await supabase
      .from("rh_absences")
      .update({ status: mutation.decision, decided_at: now, decided_by_profile_id: profileId })
      .eq("id", mutation.id)
      .select("id");
    if (error) throw error;
    // Zero linhas = a RLS filtrou (sem permissão), não sucesso.
    if (!data?.length) throw new Error("RH_MUTATION_DENIED");
    return { ok: true };
  }

  if (mutation.entity === "benefit_request") {
    const { data, error } = await supabase
      .from("rh_benefit_requests")
      .update({ status: mutation.decision, decided_at: now, decided_by_profile_id: profileId })
      .eq("id", mutation.id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("RH_MUTATION_DENIED");
    return { ok: true };
  }

  // SST: editar os dados da obrigação (título, categoria, prazo, risco, nota).
  // Quem decide se pode é a policy `rh_sst_manage` — exige rh.sst em operar, e
  // aprovar quando o registro é clinicamente confidencial.
  if (mutation.action === "update") {
    const changes: Record<string, unknown> = {};
    if (mutation.changes.title !== undefined) changes.title = mutation.changes.title;
    if (mutation.changes.category !== undefined) changes.category = mutation.changes.category;
    if (mutation.changes.dueDate !== undefined) changes.due_date = mutation.changes.dueDate;
    if (mutation.changes.risk !== undefined) changes.risk = mutation.changes.risk;
    if (mutation.changes.note !== undefined) changes.note = mutation.changes.note;
    if (!Object.keys(changes).length) return { ok: true };

    const { data, error } = await supabase
      .from("rh_sst_records")
      .update(changes)
      .eq("id", mutation.id)
      .select("id");
    if (error) throw error;
    // A RLS não devolve erro quando simplesmente não encontra a linha: zero
    // linhas alteradas é recusa de permissão, não sucesso silencioso.
    if (!data?.length) throw new Error("RH_MUTATION_DENIED");
    return { ok: true };
  }

  // SST: marcar como conforme encerra a pendência e zera o risco.
  const { data, error } = await supabase
    .from("rh_sst_records")
    .update({ status: "compliant", risk: "regular", completed_at: now })
    .eq("id", mutation.id)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("RH_MUTATION_DENIED");
  return { ok: true };
}

export type RhAbsenceDraft = {
  employeeId: string;
  absenceType: "vacation" | "time_bank" | "medical_certificate" | "leave";
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
};

// Cria uma solicitação de ausência. A RLS (rh_absences_request) permite ao
// gestor criar para a equipe e ao colaborador criar a própria; o banco decide.
// Preenche organization_id e o vínculo de departamento/unidade a partir do
// colaborador escolhido, para o registro nascer no escopo correto.
export async function createRhAbsence(draft: RhAbsenceDraft): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHENTICATED");

  const profileResult = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("user_id", authData.user.id)
    .single();
  if (profileResult.error) throw profileResult.error;
  const profileId = profileResult.data.id as string;
  const organizationId = profileResult.data.organization_id as string;

  // Denormaliza o escopo do colaborador para o registro (usado pelas policies
  // de leitura por unidade/departamento).
  const employeeResult = await supabase
    .from("employees")
    .select("unit_id, department_id")
    .eq("id", draft.employeeId)
    .single();
  if (employeeResult.error) throw employeeResult.error;

  const { data, error } = await supabase
    .from("rh_absences")
    .insert({
      organization_id: organizationId,
      employee_id: draft.employeeId,
      unit_id: employeeResult.data.unit_id,
      department_id: employeeResult.data.department_id,
      absence_type: draft.absenceType,
      start_date: draft.startDate,
      end_date: draft.endDate,
      days: draft.days,
      status: "pending",
      reason: draft.reason,
      requested_by_profile_id: profileId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: String(data.id) };
}

export type RhSstDraft = {
  employeeId: string;
  category: "exam" | "training" | "ppe" | "incident";
  title: string;
  dueDate: string | null;
  risk: "critical" | "attention" | "regular";
  note: string | null;
};

// Cria um registro de SST. A RLS (rh_sst_manage) exige rh.approve — tratar SST
// é ação de responsável, não de autosserviço. O banco recusa quem não puder.
export async function createRhSstRecord(draft: RhSstDraft): Promise<{ id: string }> {
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

  const employeeResult = await supabase
    .from("employees")
    .select("unit_id, department_id")
    .eq("id", draft.employeeId)
    .single();
  if (employeeResult.error) throw employeeResult.error;

  // Status inicial derivado do prazo: sem data → programado; com data futura
  // próxima o RH tratará; a criação nasce como "scheduled" e o vencimento é
  // avaliado na leitura. Mantemos simples: agendado ao criar.
  const { data, error } = await supabase
    .from("rh_sst_records")
    .insert({
      organization_id: organizationId,
      employee_id: draft.employeeId,
      unit_id: employeeResult.data.unit_id,
      department_id: employeeResult.data.department_id,
      category: draft.category,
      title: draft.title,
      due_date: draft.dueDate,
      status: "scheduled",
      risk: draft.risk,
      note: draft.note,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: String(data.id) };
}

export type RhBenefitRequestDraft = {
  employeeId: string;
  planId: string;
  action: "enroll" | "change" | "cancel" | "add_dependent";
  effectiveDate: string | null;
  reason: string | null;
};

// Cria uma solicitação de benefício. A RLS (rh_benefit_requests_create) permite
// ao gestor criar para a equipe e ao colaborador criar a própria; o banco decide.
export async function createRhBenefitRequest(draft: RhBenefitRequestDraft): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHENTICATED");

  const profileResult = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("user_id", authData.user.id)
    .single();
  if (profileResult.error) throw profileResult.error;
  const profileId = profileResult.data.id as string;
  const organizationId = profileResult.data.organization_id as string;

  const { data, error } = await supabase
    .from("rh_benefit_requests")
    .insert({
      organization_id: organizationId,
      plan_id: draft.planId,
      employee_id: draft.employeeId,
      action: draft.action,
      status: "pending",
      reason: draft.reason,
      effective_date: draft.effectiveDate,
      requested_by_profile_id: profileId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: String(data.id) };
}

export type RhDocumentDraft = {
  title: string;
  category: string;
  employeeId: string | null;
  objectPath: string;
  sensitive: boolean;
  signature: "signed" | "pending" | "not_required" | null;
  reviewDueAt: string | null;
};

// Grava os metadados de um documento de RH em public.documents. O arquivo em si
// já foi enviado ao Storage pelo navegador (RLS do bucket rh-documents); aqui só
// registramos a referência. A RLS documents_manage exige core.documents edit.
export async function createRhDocument(draft: RhDocumentDraft): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHENTICATED");

  const profileResult = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("user_id", authData.user.id)
    .single();
  if (profileResult.error) throw profileResult.error;
  const profileId = profileResult.data.id as string;
  const organizationId = profileResult.data.organization_id as string;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      organization_id: organizationId,
      module_code: "rh",
      storage_bucket: "rh-documents",
      object_path: draft.objectPath,
      title: draft.title,
      category: draft.category,
      version: "1.0",
      classification: draft.sensitive ? "confidential" : "internal",
      employee_id: draft.employeeId,
      signature_status: draft.signature,
      owner_profile_id: profileId,
      review_due_at: draft.reviewDueAt,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: String(data.id) };
}

export type RhEmployeeDraft = {
  fullName: string;
  employeeNumber: string;
  corporateEmail: string | null;
  admissionDate: string | null;
  departmentName: string | null;
  unitName: string | null;
  positionName: string | null;
  cpf?: string | null;
  phone?: string | null;
};

// Cadastra um colaborador na Fundação (tabela employees). A RLS
// (employees_manage) exige core.people edit. Resolve unidade/departamento/cargo
// por nome dentro da organização — o form usa nomes; ids ausentes ficam nulos.
export async function createRhEmployee(draft: RhEmployeeDraft): Promise<{ id: string }> {
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

  const lookupId = async (table: string, name: string | null): Promise<string | null> => {
    if (!name) return null;
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    return data ? String(data.id) : null;
  };

  const [departmentId, unitId, positionId] = await Promise.all([
    lookupId("departments", draft.departmentName),
    lookupId("units", draft.unitName),
    lookupId("positions", draft.positionName),
  ]);

  const { data, error } = await supabase
    .from("employees")
    .insert({
      organization_id: organizationId,
      employee_number: draft.employeeNumber,
      full_name: draft.fullName,
      corporate_email: draft.corporateEmail,
      admission_date: draft.admissionDate,
      department_id: departmentId,
      unit_id: unitId,
      position_id: positionId,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  try {
    await savePersonalData(supabase, organizationId, String(data.id), { cpf: draft.cpf, phone: draft.phone });
  } catch (personalError) {
    // Não deixa o cadastro pela metade (colaborador sem o CPF que foi digitado).
    await supabase.from("employees").delete().eq("id", String(data.id));
    throw personalError;
  }
  return { id: String(data.id) };
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const hojeSaoPaulo = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

async function lookupByName(supabase: ServerClient, organizationId: string, table: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data } = await supabase.from(table).select("id").eq("organization_id", organizationId).eq("name", name).limit(1).maybeSingle();
  return data ? String(data.id) : null;
}

// Edita o cadastro. A RLS (employees_manage: rh.colaboradores em "operar")
// decide. Com demissão até hoje, o vínculo fica inativo; sem demissão (ou
// com data futura, ex.: aviso prévio), segue ativo.
async function updateRhEmployee(supabase: ServerClient, id: string, c: RhEmployeeEdit): Promise<{ ok: true }> {
  const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const admission = date(c.admissionDate);
  const termination = date(c.terminationDate);
  if (!c.fullName.trim() || !c.employeeNumber.trim()) throw new Error("RH_INVALID");
  if (admission && termination && termination < admission) throw new Error("RH_INVALID");

  const { data: current, error: readError } = await supabase.from("employees").select("organization_id").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (!current) throw new Error("RH_MUTATION_DENIED");
  const organizationId = String(current.organization_id);
  const [departmentId, unitId, positionId] = await Promise.all([
    lookupByName(supabase, organizationId, "departments", c.departmentName),
    lookupByName(supabase, organizationId, "units", c.unitName),
    lookupByName(supabase, organizationId, "positions", c.positionName),
  ]);

  const changes: Record<string, unknown> = {
    full_name: c.fullName.trim(),
    employee_number: c.employeeNumber.trim(),
    corporate_email: c.corporateEmail?.trim() || null,
    admission_date: admission,
    termination_date: termination,
    active: !termination || termination > hojeSaoPaulo(),
  };
  // Nome que não existe no cadastro da estrutura não apaga o vínculo atual.
  if (departmentId) changes.department_id = departmentId;
  if (unitId) changes.unit_id = unitId;
  if (positionId) changes.position_id = positionId;

  const { data, error } = await supabase.from("employees").update(changes).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("RH_MUTATION_DENIED");
  await savePersonalData(supabase, organizationId, id, { cpf: c.cpf, phone: c.phone });
  return { ok: true };
}

/** CPF só com os 11 dígitos; qualquer outra coisa é recusada. */
function normalizeCpf(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.length !== 11) throw new Error("RH_INVALID");
  return digits;
}

// Grava CPF e telefone na tabela de dados pessoais (RLS: rh.colaboradores em
// "operar"). Só os campos informados; um campo ausente não apaga o que existe.
async function savePersonalData(
  supabase: ServerClient,
  organizationId: string,
  employeeId: string,
  input: { cpf?: string | null; phone?: string | null },
) {
  const cpf = normalizeCpf(input.cpf);
  const phone = input.phone === undefined ? undefined : input.phone?.trim() || null;
  const changes: Record<string, unknown> = {};
  if (cpf !== undefined) changes.cpf = cpf;
  if (phone !== undefined) changes.phone = phone;
  if (!Object.keys(changes).length) return;
  const { error } = await supabase
    .from("rh_employee_personal_data")
    .upsert({ employee_id: employeeId, organization_id: organizationId, ...changes }, { onConflict: "employee_id" });
  if (error) {
    // CPF já usado por outro colaborador (unique organization_id+cpf).
    if ((error as { code?: string }).code === "23505") throw new Error("RH_CPF_DUPLICADO");
    throw error;
  }
}

/** O que é apagado junto com o cadastro (tabelas ligadas em cascata). */
export const EMPLOYEE_HISTORY_TABLES = {
  rh_absences: "férias e ausências",
  rh_vacation_balances: "períodos de férias",
  rh_sst_records: "registros de SST",
  rh_ppe_deliveries: "entregas de EPI",
  rh_benefit_enrollments: "benefícios",
  rh_benefit_requests: "solicitações de benefício",
  rh_journey_records: "registros de jornada",
} as const;

/**
 * Quanto histórico o colaborador tem. Só depois de a sessão do usuário
 * enxergar o colaborador (RLS); a contagem usa a service role para não
 * subestimar tabelas que o usuário não lê (ex.: EPI).
 */
export async function getRhEmployeeHistory(id: string): Promise<{ name: string; hasAccount: boolean; counts: Record<string, number> }> {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("UNAUTHENTICATED");
  const { data: employee, error } = await supabase.from("employees").select("id, organization_id, full_name, profile_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!employee) throw new Error("RH_MUTATION_DENIED");
  const admin = createSupabaseAdminClient();
  const counts: Record<string, number> = {};
  await Promise.all(Object.keys(EMPLOYEE_HISTORY_TABLES).map(async (table) => {
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("employee_id", id).eq("organization_id", employee.organization_id);
    counts[table] = count ?? 0;
  }));
  return { name: String(employee.full_name), hasAccount: Boolean(employee.profile_id), counts };
}

// Exclui o cadastro. Exige digitar o nome. Quem tem conta de acesso não é
// excluído aqui (a conta ficaria órfã): primeiro exclua o usuário em Pessoas
// e Acessos. O histórico ligado vai junto — por isso a tela mostra antes o
// que será apagado e recomenda registrar a demissão para ex-colaboradores.
async function deleteRhEmployee(
  supabase: ServerClient,
  { id, confirmName, profileId, userId }: { id: string; confirmName: string; profileId: string; userId: string },
): Promise<{ ok: true }> {
  const history = await getRhEmployeeHistory(id);
  const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (norm(confirmName) !== norm(history.name)) throw new Error("RH_CONFIRMATION");
  if (history.hasAccount) throw new Error("RH_EMPLOYEE_HAS_ACCOUNT");

  const { data: employee } = await supabase.from("employees").select("organization_id, employee_number, admission_date, termination_date").eq("id", id).maybeSingle();
  const { data, error } = await supabase.from("employees").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("RH_MUTATION_DENIED");

  const admin = createSupabaseAdminClient();
  const { error: auditError } = await admin.from("audit_logs").insert({
    organization_id: employee?.organization_id ?? null,
    actor_user_id: userId,
    actor_profile_id: profileId,
    module_code: "rh",
    event_type: "employees.delete",
    entity_type: "employees",
    entity_id: id,
    risk_level: "high",
    metadata: { fullName: history.name, employeeNumber: employee?.employee_number ?? null, admissionDate: employee?.admission_date ?? null, terminationDate: employee?.termination_date ?? null, removed: history.counts },
  });
  if (auditError) console.error("Falha ao registrar a exclusão do colaborador na auditoria:", auditError.message);
  return { ok: true };
}
