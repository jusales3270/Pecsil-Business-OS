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
