import "server-only";

import { createSupabaseServerClient } from "../supabase/server";

// Mutações de decisão do RH, executadas com a sessão do usuário. Toda a
// autorização é do banco: as policies de escrita (rh_absences_decide,
// rh_benefit_requests_decide, rh_sst_manage) exigem a permissão certa. Se o
// usuário não puder, o próprio PostgreSQL recusa — este código não checa papel.

export type RhMutation =
  | { entity: "absence"; id: string; decision: "approved" | "rejected" }
  | { entity: "benefit_request"; id: string; decision: "approved" | "rejected" }
  | { entity: "sst"; id: string; action: "mark_compliant" };

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

  if (mutation.entity === "absence") {
    // O CHECK da tabela exige decided_at preenchido quando aprovado/reprovado.
    const { error } = await supabase
      .from("rh_absences")
      .update({ status: mutation.decision, decided_at: now, decided_by_profile_id: profileId })
      .eq("id", mutation.id);
    if (error) throw error;
    return { ok: true };
  }

  if (mutation.entity === "benefit_request") {
    const { error } = await supabase
      .from("rh_benefit_requests")
      .update({ status: mutation.decision, decided_at: now, decided_by_profile_id: profileId })
      .eq("id", mutation.id);
    if (error) throw error;
    return { ok: true };
  }

  // SST: marcar como conforme encerra a pendência e zera o risco.
  const { error } = await supabase
    .from("rh_sst_records")
    .update({ status: "compliant", risk: "regular", completed_at: now })
    .eq("id", mutation.id);
  if (error) throw error;
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
  return { id: String(data.id) };
}
