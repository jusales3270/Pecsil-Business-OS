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
      .ilike("name", category)
      .maybeSingle();

    if (existingCa) {
      chartAccountId = existingCa.id;
    } else {
      const code = `${draft.direction === "receivable" ? "1" : "2"}.${Date.now().toString().slice(-4)}`;
      const { data: newCa } = await supabase
        .from("finance_chart_accounts")
        .insert({
          organization_id: organizationId,
          name: category,
          code,
          account_type: draft.direction === "receivable" ? "revenue" : "expense",
          active: true,
        })
        .select("id")
        .maybeSingle();
      if (newCa) chartAccountId = newCa.id;
    }
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
    const { error } = await supabase
      .from("finance_titles")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", mutation.titleId);
    if (error) throw error;
    return { success: true };
  }

  if (mutation.type === "settle") {
    // Settle title and installment
    const { error: titleError } = await supabase
      .from("finance_titles")
      .update({ status: "settled" })
      .eq("id", mutation.titleId);
    if (titleError) throw titleError;

    const { error: instError } = await supabase
      .from("finance_installments")
      .update({ status: "settled" })
      .eq("title_id", mutation.titleId);
    if (instError) throw instError;

    return { success: true };
  }

  if (mutation.type === "cancel") {
    const { error } = await supabase
      .from("finance_titles")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", mutation.titleId);
    if (error) throw error;
    return { success: true };
  }

  throw new Error("MUTATION_TYPE_UNSUPPORTED");
}
