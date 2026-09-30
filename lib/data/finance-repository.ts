import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import type {
  FinanceBankAccount,
  FinanceInstallment,
  FinanceSnapshot,
  FinanceTitle,
} from "./finance";

type Row = Record<string, unknown>;

export async function getSupabaseFinanceSnapshot(): Promise<FinanceSnapshot> {
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

  const [titlesResult, banksResult, entriesResult, approvalsResult, centersResult, accountsResult] = await Promise.all([
    supabase
      .from("finance_titles")
      .select("id,direction,counterparty_name,counterparty_group,document_number,document_type,description,notes,issue_date,original_amount,status,chart_account_id,is_forecast,review_reason,source_module,finance_cost_centers(name),finance_chart_accounts(code,name),finance_installments(id,installment_number,due_date,amount,settled_amount,status),finance_title_allocations(amount,finance_chart_accounts(code,name))")
      .eq("organization_id", organizationId)
      .order("issue_date", { ascending:false })
      // O padrão da API corta em 1000 linhas; o contas a receber sozinho passa de 600.
      .range(0, 9999),
    supabase
      .from("finance_bank_accounts")
      .select("id,bank_name,bank_code,branch,account_number,opening_balance,active")
      .eq("organization_id", organizationId)
      .order("bank_name"),
    supabase
      .from("finance_bank_entries")
      .select("amount,direction,reconciliation_status")
      .eq("organization_id", organizationId),
    supabase
      .from("finance_approval_requests")
      .select("id", { count:"exact", head:true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
    supabase
      .from("finance_cost_centers")
      .select("id,code,name")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("finance_chart_accounts")
      .select("id,code,name,account_type,allows_posting")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("code"),
  ]);

  const failed = [titlesResult, banksResult, entriesResult, approvalsResult, centersResult, accountsResult].find(result => result.error);
  if (failed?.error) throw failed.error;

  const titles = ((titlesResult.data ?? []) as unknown as Row[]).map(toTitle);
  const banks = ((banksResult.data ?? []) as unknown as Row[]).map(toBankAccount);
  const entries = (entriesResult.data ?? []) as unknown as Row[];
  const entryBalance = entries.reduce((total, row) => {
    const amount = number(row.amount);
    return total + (row.direction === "credit" ? amount : -amount);
  }, 0);

  return {
    source: "supabase",
    organizationId,
    summary: {
      availableBalance: banks.reduce((sum, bank) => sum + bank.balance, 0) + entryBalance,
      payableOpen: openAmount(titles.filter(title => title.direction === "payable")),
      receivableOpen: openAmount(titles.filter(title => title.direction === "receivable" && !title.isForecast)),
      receivableForecast: openAmount(titles.filter(title => title.direction === "receivable" && title.isForecast)),
      pendingApprovals: approvalsResult.count ?? 0,
      unreconciledEntries: entries.filter(row => row.reconciliation_status === "pending").length,
    },
    titles,
    bankAccounts: banks,
    costCenters: ((centersResult.data ?? []) as Row[]).map(row => ({ id: String(row.id), code: row.code ? String(row.code) : null, name: String(row.name) })),
    chartAccounts: ((accountsResult.data ?? []) as Row[]).map(row => ({
      id: String(row.id), code: String(row.code ?? ""), name: String(row.name), type: String(row.account_type ?? ""), allowsPosting: Boolean(row.allows_posting),
    })),
    loadedAt: new Date().toISOString(),
  };
}

function toTitle(row: Row): FinanceTitle {
  return {
    id: String(row.id),
    direction: row.direction === "receivable" ? "receivable" : "payable",
    counterparty: String(row.counterparty_name ?? "Não informado"),
    documentNumber: row.document_number ? String(row.document_number) : null,
    description: String(row.description ?? ""),
    issueDate: String(row.issue_date),
    originalAmount: number(row.original_amount),
    status: row.status as FinanceTitle["status"],
    costCenter: relationName(row.finance_cost_centers),
    chartAccount: accountLabel(row.finance_chart_accounts),
    chartAccountId: row.chart_account_id ? String(row.chart_account_id) : null,
    installments: relationList(row.finance_installments).map(toInstallment),
    isForecast: Boolean(row.is_forecast),
    group: row.counterparty_group ? String(row.counterparty_group) : null,
    documentType: row.document_type ? String(row.document_type) : null,
    notes: row.notes ? String(row.notes) : null,
    reviewReason: row.review_reason ? String(row.review_reason) : null,
    source: row.source_module ? String(row.source_module) : null,
    allocations: relationList(row.finance_title_allocations).map(allocation => {
      const account = (Array.isArray(allocation.finance_chart_accounts) ? allocation.finance_chart_accounts[0] : allocation.finance_chart_accounts) as Row | null;
      return { code: account?.code ? String(account.code) : null, name: String(account?.name ?? ""), amount: number(allocation.amount) };
    }),
  };
}

function toInstallment(row: Row): FinanceInstallment {
  return {
    id: String(row.id),
    number: number(row.installment_number),
    dueDate: String(row.due_date),
    amount: number(row.amount),
    settledAmount: number(row.settled_amount),
    status: row.status as FinanceInstallment["status"],
  };
}

function toBankAccount(row: Row): FinanceBankAccount {
  return {
    id: String(row.id),
    name: String(row.bank_name),
    bankCode: String(row.bank_code),
    branch: String(row.branch),
    accountNumber: String(row.account_number),
    balance: number(row.opening_balance),
    active: Boolean(row.active),
  };
}

function openAmount(titles: FinanceTitle[]) {
  return titles.filter(title => title.status !== "cancelled").reduce((sum, title) => sum + title.installments.reduce(
    (subtotal, installment) => subtotal + Math.max(0, installment.amount - installment.settledAmount),
    0,
  ), 0);
}

function relationList(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  return [];
}

/** "01.01.001 VENDAS DE MOLDES": o código é como a equipe reconhece a conta. */
function accountLabel(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const account = row as Row;
  return account.code ? `${account.code} ${account.name}` : String(account.name ?? "");
}

function relationName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return "name" in row ? String((row as Row).name) : null;
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

