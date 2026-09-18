import "server-only";

import { NextResponse } from "next/server";
import { getSupabaseConfigStatus } from "./config";
import { createSupabaseServerClient } from "./server";

/** Cliente de sessão do usuário, ou a resposta de erro pronta (sem configuração / sem sessão). */
export async function requireUserSession() {
  if (!getSupabaseConfigStatus().publicConnectionReady) {
    return { error: NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 }) } as const;
  }
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) } as const;
  }
  return { supabase, user: auth.user } as const;
}
