import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { authorize, replaceGrants, writeAudit } from "../../../../lib/auth/admin-users";
import { normalizeGrants, type AccessGrants } from "../../../../modules/access-catalog";

export const dynamic = "force-dynamic";

export type AdminUser = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  isOwner: boolean;
  employee: { id: string; name: string; registration: string | null; department: string | null } | null;
  grants: AccessGrants;
};

type Row = Record<string, unknown>;
const one = (value: unknown): Row | null => (Array.isArray(value) ? (value[0] as Row) ?? null : (value as Row) ?? null);

/**
 * Usuários da organização com o colaborador vinculado e as permissões por
 * funcionalidade. Só o proprietário (authorize).
 */
export async function GET() {
  const auth = await authorize();
  if ("error" in auth) return auth.error;

  const admin = createSupabaseAdminClient();
  const [profilesResult, grantsResult, employeesResult] = await Promise.all([
    admin.from("profiles").select("id, full_name, email, status, is_owner").eq("organization_id", auth.orgId).order("full_name"),
    admin.from("user_feature_grants").select("profile_id, feature_code, level").eq("organization_id", auth.orgId),
    admin
      .from("employees")
      .select("id, full_name, employee_number, profile_id, departments(name)")
      .eq("organization_id", auth.orgId)
      .not("profile_id", "is", null),
  ]);
  const failed = [profilesResult, grantsResult, employeesResult].find((result) => result.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const grantsByProfile = new Map<string, AccessGrants>();
  for (const row of grantsResult.data ?? []) {
    const grants = grantsByProfile.get(row.profile_id) ?? {};
    grants[row.feature_code] = row.level;
    grantsByProfile.set(row.profile_id, grants);
  }
  const employeeByProfile = new Map((employeesResult.data ?? []).map((row) => [row.profile_id as string, row as Row]));

  const users: AdminUser[] = (profilesResult.data ?? []).map((profile) => {
    const employee = employeeByProfile.get(profile.id);
    return {
      id: profile.id,
      fullName: profile.full_name,
      email: profile.email,
      status: profile.status,
      isOwner: profile.is_owner === true,
      employee: employee
        ? {
            id: String(employee.id),
            name: String(employee.full_name),
            registration: employee.employee_number ? String(employee.employee_number) : null,
            department: one(employee.departments)?.name ? String(one(employee.departments)?.name) : null,
          }
        : null,
      grants: grantsByProfile.get(profile.id) ?? {},
    };
  });

  return NextResponse.json({ users });
}

/**
 * Cria o acesso de um colaborador: usuário no Auth, perfil, vínculo com a ficha
 * do RH e as permissões marcadas. Em qualquer falha, desfaz o que já criou.
 */
export async function POST(request: Request) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { orgId, profileId: actorProfileId, userId: actorUserId } = auth;

  let body: { employeeId?: string; email?: string; password?: string; grants?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const grants = normalizeGrants(body.grants);

  if (!body.employeeId) return NextResponse.json({ error: "Escolha o colaborador." }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "A senha deve ter ao menos 8 caracteres." }, { status: 400 });
  }
  if (Object.keys(grants).length === 0) {
    return NextResponse.json({ error: "Marque ao menos uma funcionalidade." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: employee } = await admin
    .from("employees")
    .select("id, full_name, profile_id, active")
    .eq("organization_id", orgId)
    .eq("id", body.employeeId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  if (employee.profile_id) {
    return NextResponse.json({ error: "Este colaborador já tem acesso à plataforma." }, { status: 409 });
  }
  const fullName = String(employee.full_name);

  const { data: createdUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authError || !createdUser?.user) {
    const already = authError?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      { error: already ? "Já existe um usuário com esse e-mail." : authError?.message ?? "Falha ao criar o usuário." },
      { status: already ? 409 : 500 },
    );
  }
  const newUserId = createdUser.user.id;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .insert({ user_id: newUserId, organization_id: orgId, email, full_name: fullName, status: "active" })
    .select("id")
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: profileError?.message ?? "Falha ao criar o perfil." }, { status: 500 });
  }

  const rollback = async () => {
    await admin.from("employees").update({ profile_id: null }).eq("id", employee.id).eq("profile_id", profile.id);
    await admin.from("profiles").delete().eq("id", profile.id);
    await admin.auth.admin.deleteUser(newUserId);
  };

  const { error: linkError } = await admin
    .from("employees")
    .update({ profile_id: profile.id })
    .eq("id", employee.id)
    .is("profile_id", null);
  if (linkError) {
    await rollback();
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  const saved = await replaceGrants(admin, { orgId, profileId: profile.id, grantedBy: actorProfileId }, grants);
  if ("error" in saved) {
    await rollback();
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  await writeAudit(admin, {
    orgId,
    actorProfileId,
    actorUserId,
    eventType: "core.access.user.create",
    entityType: "profile",
    entityId: profile.id,
    riskLevel: "sensitive",
    metadata: { email, fullName, employeeId: employee.id, grants },
  });

  return NextResponse.json({ id: profile.id, email, fullName }, { status: 201 });
}
