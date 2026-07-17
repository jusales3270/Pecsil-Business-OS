import { NextResponse } from "next/server";
import { demoFoundationSnapshot } from "../../../lib/data/foundation";
import { getSupabaseFoundationSnapshot } from "../../../lib/data/foundation-repository";
import { getSupabaseConfigStatus } from "../../../lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getSupabaseConfigStatus();
  if (!config.publicConnectionReady) {
    return NextResponse.json({
      ...demoFoundationSnapshot,
      loadedAt: new Date().toISOString(),
    });
  }

  try {
    return NextResponse.json(await getSupabaseFoundationSnapshot());
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error:"UNAUTHENTICATED" }, { status:401 });
    }
    console.error("Falha ao carregar a Fundação", error);
    return NextResponse.json({ error:"FOUNDATION_UNAVAILABLE" }, { status:503 });
  }
}
