import { NextResponse } from "next/server";
import { demoFinanceSnapshot } from "../../../lib/data/finance";
import { getSupabaseFinanceSnapshot } from "../../../lib/data/finance-repository";
import { getSupabaseConfigStatus } from "../../../lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({ ...demoFinanceSnapshot, loadedAt:new Date().toISOString() });
  }

  try {
    return NextResponse.json(await getSupabaseFinanceSnapshot());
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error:"UNAUTHENTICATED" }, { status:401 });
    }
    console.error("Falha ao carregar o Financeiro", error);
    return NextResponse.json({ error:"FINANCE_UNAVAILABLE" }, { status:503 });
  }
}

