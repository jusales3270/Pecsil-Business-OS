import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { authorize, replaceGrants, writeAudit } from "../../../../lib/auth/admin-users";
import { endOfDayBrasilia, isAccessExpired, normalizeGrants, type AccessGrants, type AccountType } from "../../../../modules/access-catalog";

export const dynamic = "force-dynamic";

export type AdminUser = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  isOwner: boolean;
  accountType: AccountType;
  companyName: string | null;
  accessExpiresAt: string | null;
  expired: boolean;
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
    admin.from("profiles").select("id, full_name, email, status, is_owner, account_type, company_name, access_expires_at").eq("organization_id", auth.orgId).order("full_name"),
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
      accountType: profile.account_type === "terceiro" ? "terceiro" : "colaborador",
      companyName: profile.company_name ?? null,
      accessExpiresAt: profile.access_expires_at ?? null,
      expired: isAccessExpired(profile.access_expires_at),
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

type CreateBody = {
  kind?: AccountType;
  employeeId?: string;
  fullName?: string;
  companyName?: string;
  accessExpiresAt?: string | null;
  email?: string;
  password?: string;
  grants?: unknown;
};

/**
 * Cria um acesso: de um COLABORADOR (vinculado à ficha do RH) ou de um
 * TERCEIRO (prestador de fora do quadro, com a empresa e validade opcional).
 * Em qualquer falha, desfaz o que já criou.
 */
export async function POST(request: Request) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { orgId, profileId: actorProfileId, userId: actorUserId } = auth;

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const kind: AccountType = body.kind === "terceiro" ? "terceiro" : "colaborador";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const grants = normalizeGrants(body.grants);

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

  // Quem é: colaborador (nome vem da ficha) ou terceiro (dados informados).
  let fullName: string;
  let employeeId: string | null = null;
  let companyName: string | null = null;
  let accessExpiresAt: string | null = null;

  if (kind === "colaborador") {
    if (!body.employeeId) return NextResponse.json({ error: "Escolha o colaborador." }, { status: 400 });
    const { data: employee } = await admin
      .from("employees")
      .select("id, full_name, profile_id")
      .eq("organization_id", orgId)
      .eq("id", body.employeeId)
      .maybeSingle();
    if (!employee) return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
    if (employee.profile_id) {
      return NextResponse.json({ error: "Este colaborador já tem acesso à plataforma." }, { status: 409 });
    }
    fullName = String(employee.full_name);
    employeeId = String(employee.id);
  } else {
    fullName = body.fullName?.trim() ?? "";
    companyName = body.companyName?.trim() ?? "";
    if (!fullName) return NextResponse.json({ error: "Informe o nome do terceiro." }, { status: 400 });
    if (!companyName) return NextResponse.json({ error: "Informe a empresa prestadora." }, { status: 400 });
    if (body.accessExpiresAt) {
      accessExpiresAt = endOfDayBrasilia(body.accessExpiresAt);
      if (!accessExpiresAt) return NextResponse.json({ error: "Data de validade inválida." }, { status: 400 });
      if (isAccessExpired(accessExpiresAt)) {
        return NextResponse.json({ error: "A validade precisa ser uma data futura." }, { status: 400 });
      }
    }
  }

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
    .insert({
      user_id: newUserId,
      organization_id: orgId,
      email,
      full_name: fullName,
      status: "active",
      account_type: kind,
      company_name: companyName,
      access_expires_at: accessExpiresAt,
    })
    .select("id")
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: profileError?.message ?? "Falha ao criar o perfil." }, { status: 500 });
  }

  const rollback = async () => {
    if (employeeId) {
      await admin.from("employees").update({ profile_id: null }).eq("id", employeeId).eq("profile_id", profile.id);
    }
    await admin.from("profiles").delete().eq("id", profile.id);
    await admin.auth.admin.deleteUser(newUserId);
  };

  if (employeeId) {
    const { error: linkError } = await admin
      .from("employees")
      .update({ profile_id: profile.id })
      .eq("id", employeeId)
      .is("profile_id", null);
    if (linkError) {
      await rollback();
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }
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
    metadata: { email, fullName, accountType: kind, employeeId, companyName, accessExpiresAt, grants },
  });

  return NextResponse.json({ id: profile.id, email, fullName }, { status: 201 });
}
