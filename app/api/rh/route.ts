import { NextResponse } from "next/server";
import { demoRhSnapshot } from "../../../lib/data/rh";
import { getSupabaseRhSnapshot } from "../../../lib/data/rh-repository";
import { applyRhMutation, createRhAbsence, type RhAbsenceDraft, type RhMutation } from "../../../lib/data/rh-mutations";
import { getSupabaseConfigStatus } from "../../../lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ ...demoRhSnapshot, loadedAt:new Date().toISOString() });
  }

  try {
    return NextResponse.json(await getSupabaseRhSnapshot());
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error:"UNAUTHENTICATED" }, { status:401 });
    }
    console.error("Falha ao carregar o RH", error);
    return NextResponse.json({ error:"RH_UNAVAILABLE" }, { status:503 });
  }
}

// Decisões do RH (aprovar/reprovar/marcar conforme). Sem conexão configurada,
// devolve 409 para o cliente saber que está em modo demonstrativo — a UI então
// mantém a alteração apenas local.
export async function PATCH(request: Request) {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ error:"DEMO_MODE" }, { status:409 });
  }

  let mutation: RhMutation;
  try {
    mutation = (await request.json()) as RhMutation;
  } catch {
    return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
  }

  try {
    return NextResponse.json(await applyRhMutation(mutation));
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error:"UNAUTHENTICATED" }, { status:401 });
    }
    // Recusa da RLS aparece como erro do PostgREST — sem permissão de decisão.
    console.error("Falha na decisão do RH", error);
    return NextResponse.json({ error:"RH_MUTATION_DENIED" }, { status:403 });
  }
}

// Criação de solicitação de ausência. Mesmo contrato: 409 em modo demonstrativo.
export async function POST(request: Request) {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ error:"DEMO_MODE" }, { status:409 });
  }

  let draft: RhAbsenceDraft;
  try {
    draft = (await request.json()) as RhAbsenceDraft;
  } catch {
    return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
  }
  if (!draft.employeeId || !draft.startDate || !draft.endDate || !draft.days) {
    return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
  }

  try {
    return NextResponse.json(await createRhAbsence(draft), { status:201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error:"UNAUTHENTICATED" }, { status:401 });
    }
    console.error("Falha ao criar ausência", error);
    return NextResponse.json({ error:"RH_CREATE_DENIED" }, { status:403 });
  }
}
