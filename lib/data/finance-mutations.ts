import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import type { FinanceDirection, FinanceTitleStatus } from "./finance";

export type FinanceTitleDraft = {
  direction: FinanceDirection;
  counterparty: string;
  documentNumber?: string | null;
  description?: string;
  issueDate?: string;
  dueDate: string;
  amount: number;
  category?: string;
  costCenterName?: string;
  status?: FinanceTitleStatus;
};

export type FinanceMutation =
  | { type: "approve"; titleId: string }
  | { type: "settle"; titleId: string; installmentId?: string; settledAmount?: number }
  | { type: "cancel"; titleId: string };

export async function createFinanceTitle(draft: FinanceTitleDraft) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHENTICATED");

  const profileResult = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("user_id", authData.user.id)
    .single();
  if (profileResult.error || !profileResult.data) throw new Error("NO_PROFILE");
  const { id: profileId, organization_id: organizationId } = profileResult.data;

  // Resolve or create cost center if specified
  let costCenterId: string | null = null;
  if (draft.costCenterName?.trim()) {
    const name = draft.costCenterName.trim();
    const { data: existingCc } = await supabase
      .from("finance_cost_centers")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", name)
      .maybeSingle();

    if (existingCc) {
      costCenterId = existingCc.id;
    } else {
      const code = name.slice(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const { data: newCc } = await supabase
        .from("finance_cost_centers")
        .insert({
          organization_id: organizationId,
          name,
          code: code || `CC${Date.now().toString().slice(-4)}`,
          active: true,
        })
        .select("id")
        .maybeSingle();
      if (newCc) costCenterId = newCc.id;
    }
  }

  // Resolve or create chart account if category specified
  let chartAccountId: string | null = null;
  if (draft.category?.trim()) {
    const category = draft.category.trim();
    const { data: existingCa } = await supabase
      .from("finance_chart_accounts")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", category.replace(/^\d{2,3}(\.\d{2,3}){0,2}\s+/, ""))
      .limit(1)
      .maybeSingle();

    // A conta sai do plano de contas; lançamento não cria conta (quem cria é o Plano de contas).
    if (existingCa) chartAccountId = existingCa.id;
  }

  const issueDate = draft.issueDate || new Date().toISOString().slice(0, 10);
  const initialStatus: FinanceTitleStatus = draft.direction === "payable" ? "pending_approval" : "approved";

  const { data: title, error: titleError } = await supabase
    .from("finance_titles")
    .insert({
      organization_id: organizationId,
      direction: draft.direction,
      counterparty_name: draft.counterparty,
      document_number: draft.documentNumber || null,
      description: draft.description || draft.category || "Lançamento financeiro",
      issue_date: issueDate,
      original_amount: draft.amount,
      currency: "BRL",
      cost_center_id: costCenterId,
      chart_account_id: chartAccountId,
      status: initialStatus,
      created_by_profile_id: profileId,
    })
    .select("id")
    .single();

  if (titleError || !title) throw new Error(titleError?.message ?? "Falha ao criar título");

  // Create primary installment
  const { error: installmentError } = await supabase
    .from("finance_installments")
    .insert({
      organization_id: organizationId,
      title_id: title.id,
      installment_number: 1,
      due_date: draft.dueDate,
      amount: draft.amount,
      settled_amount: 0,
      status: "pending",
    });

  if (installmentError) {
    console.error("Erro ao criar parcela do título:", installmentError.message);
  }

  return { id: title.id, success: true };
}

export async function applyFinanceMutation(mutation: FinanceMutation) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHENTICATED");

  if (mutation.type === "approve") {
    const { data: changed, error } = await supabase
      .from("finance_titles")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", mutation.titleId)
      .select("id");
    if (error) throw error;
    denyIfUntouched(changed);
    return { success: true };
  }

  if (mutation.type === "settle") {
    // Settle title and installment
    const { data: changed, error: titleError } = await supabase
      .from("finance_titles")
      .update({ status: "settled" })
      .eq("id", mutation.titleId)
      .select("id");
    if (titleError) throw titleError;
    denyIfUntouched(changed);

    // A parcela quitada guarda o valor recebido: é dele que sai o "em aberto".
    const { data: open, error: readError } = await supabase
      .from("finance_installments")
      .select("id, amount")
      .eq("title_id", mutation.titleId)
      .neq("status", "cancelled");
    if (readError) throw readError;
    for (const installment of open ?? []) {
      const { error: instError } = await supabase
        .from("finance_installments")
        .update({ status: "settled", settled_amount: installment.amount })
        .eq("id", installment.id);
      if (instError) throw instError;
    }

    return { success: true };
  }

  if (mutation.type === "cancel") {
    const { data: changed, error } = await supabase
      .from("finance_titles")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", mutation.titleId)
      .select("id");
    if (error) throw error;
    denyIfUntouched(changed);
    const { error: instError } = await supabase
      .from("finance_installments")
      .update({ status: "cancelled" })
      .eq("title_id", mutation.titleId)
      .neq("status", "settled");
    if (instError) throw instError;
    return { success: true };
  }

  throw new Error("MUTATION_TYPE_UNSUPPORTED");
}

/**
 * Sem permissão, o banco não devolve erro: só não altera linha nenhuma. Tratar
 * isso como sucesso faria a tela dizer "feito" sem nada ter mudado.
 */
function denyIfUntouched(rows: unknown[] | null) {
  if (!rows?.length) throw new Error("FORBIDDEN_OR_NOT_FOUND");
}
