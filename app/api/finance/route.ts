import { NextResponse } from "next/server";
import { demoFinanceSnapshot } from "../../../lib/data/finance";
import { getSupabaseFinanceSnapshot } from "../../../lib/data/finance-repository";
import {
  applyFinanceMutation,
  createFinanceTitle,
  type FinanceMutation,
  type FinanceTitleDraft,
} from "../../../lib/data/finance-mutations";
import { getSupabaseConfigStatus } from "../../../lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ ...demoFinanceSnapshot, loadedAt: new Date().toISOString() });
  }

  try {
    return NextResponse.json(await getSupabaseFinanceSnapshot());
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    console.error("Falha ao carregar o Financeiro", error);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ error: "DEMO_MODE" }, { status: 409 });
  }

  let body: FinanceTitleDraft;
  try {
    body = (await request.json()) as FinanceTitleDraft;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  if (!body.counterparty || !body.dueDate || !body.amount || !body.direction) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes." }, { status: 400 });
  }

  try {
    const result = await createFinanceTitle(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    console.error("Falha ao criar título financeiro", error);
    return NextResponse.json({ error: "FINANCE_CREATE_DENIED" }, { status: 403 });
  }
}

export async function PATCH(request: Request) {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ error: "DEMO_MODE" }, { status: 409 });
  }

  let mutation: FinanceMutation;
  try {
    mutation = (await request.json()) as FinanceMutation;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  try {
    return NextResponse.json(await applyFinanceMutation(mutation));
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    // Regra do banco (valor inválido, título já quitado…): a mensagem vai para a tela.
    const detail = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "P0001" && detail) return NextResponse.json({ error: detail }, { status: 400 });
    console.error("Falha na operação financeira", error);
    return NextResponse.json({ error: "FINANCE_MUTATION_DENIED" }, { status: 403 });
  }
}
