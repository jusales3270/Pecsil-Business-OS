import { NextResponse } from "next/server";
import { demoRhSnapshot } from "../../../lib/data/rh";
import { getSupabaseRhSnapshot } from "../../../lib/data/rh-repository";
import {
  applyRhMutation,
  createRhAbsence,
  createRhBenefitRequest,
  createRhDocument,
  createRhEmployee,
  createRhSstRecord,
  type RhAbsenceDraft,
  type RhBenefitRequestDraft,
  type RhDocumentDraft,
  type RhEmployeeDraft,
  type RhMutation,
  type RhSstDraft,
} from "../../../lib/data/rh-mutations";
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
    if (error instanceof Error && error.message === "RH_MUTATION_DENIED") {
      return NextResponse.json({ error:"RH_MUTATION_DENIED" }, { status:403 });
    }
    // Recusa da RLS aparece como erro do PostgREST — sem permissão de decisão.
    console.error("Falha na decisão do RH", error);
    return NextResponse.json({ error:"RH_MUTATION_DENIED" }, { status:403 });
  }
}

// Criação de registros do RH. Despacha por `entity` no corpo (ausência é o
// padrão quando ausente, por compatibilidade). Mesmo contrato: 409 em modo
// demonstrativo, 403 quando a RLS recusa.
type RhCreateBody =
  | ({ entity?: "absence" } & RhAbsenceDraft)
  | ({ entity: "sst" } & RhSstDraft)
  | ({ entity: "benefit_request" } & RhBenefitRequestDraft)
  | ({ entity: "employee" } & RhEmployeeDraft)
  | ({ entity: "document" } & RhDocumentDraft);

export async function POST(request: Request) {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ error:"DEMO_MODE" }, { status:409 });
  }

  let body: RhCreateBody;
  try {
    body = (await request.json()) as RhCreateBody;
  } catch {
    return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
  }

  try {
    if (body.entity === "sst") {
      if (!body.employeeId || !body.title || !body.category) {
        return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
      }
      return NextResponse.json(await createRhSstRecord(body), { status:201 });
    }
    if (body.entity === "benefit_request") {
      if (!body.employeeId || !body.planId || !body.action) {
        return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
      }
      return NextResponse.json(await createRhBenefitRequest(body), { status:201 });
    }
    if (body.entity === "employee") {
      if (!body.fullName || !body.employeeNumber) {
        return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
      }
      return NextResponse.json(await createRhEmployee(body), { status:201 });
    }
    if (body.entity === "document") {
      if (!body.title || !body.objectPath) {
        return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
      }
      return NextResponse.json(await createRhDocument(body), { status:201 });
    }
    // padrão: ausência
    if (!body.employeeId || !body.startDate || !body.endDate || !body.days) {
      return NextResponse.json({ error:"INVALID_BODY" }, { status:400 });
    }
    return NextResponse.json(await createRhAbsence(body), { status:201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error:"UNAUTHENTICATED" }, { status:401 });
    }
    console.error("Falha ao criar registro de RH", error);
    return NextResponse.json({ error:"RH_CREATE_DENIED" }, { status:403 });
  }
}
