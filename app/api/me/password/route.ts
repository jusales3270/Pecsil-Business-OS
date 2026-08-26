import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requirePublicSupabaseConfig } from "../../../../lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Troca da própria senha, exigindo a senha atual.
 *
 * A verificação da senha atual NÃO pode usar o cliente de sessão: um
 * `signInWithPassword` nele reescreveria os cookies no meio da requisição.
 * Por isso a conferência é feita num cliente isolado, sem persistir sessão.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "A nova senha deve ter ao menos 8 caracteres." },
      { status: 400 },
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "A nova senha é igual à atual." }, { status: 400 });
  }

  // --- Confere a senha atual num cliente isolado -----------------------------
  const { url, publishableKey } = requirePublicSupabaseConfig();
  const probe = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: wrongPassword } = await probe.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (wrongPassword) {
    return NextResponse.json({ error: "Senha atual incorreta." }, { status: 400 });
  }

  // --- Troca a senha ---------------------------------------------------------
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auditoria da própria troca (nunca registra a senha).
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile) {
    await admin.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_user_id: user.id,
      actor_profile_id: profile.id,
      module_code: "core.access",
      event_type: "core.access.self.password_change",
      entity_type: "profile",
      entity_id: profile.id,
      risk_level: "monitored",
      metadata: { email: profile.email },
    });
  }

  return NextResponse.json({ ok: true });
}
