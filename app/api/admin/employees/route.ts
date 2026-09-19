import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { authorize } from "../../../../lib/auth/admin-users";

export const dynamic = "force-dynamic";

export type AccessCandidate = {
  id: string;
  name: string;
  email: string | null;
  registration: string | null;
  department: string | null;
  position: string | null;
};

type Row = Record<string, unknown>;
const relationName = (value: unknown) => {
  const row = (Array.isArray(value) ? value[0] : value) as Row | null | undefined;
  return row?.name ? String(row.name) : null;
};

/** Colaboradores ativos que ainda não têm acesso à plataforma. Só o proprietário. */
export async function GET() {
  const auth = await authorize();
  if ("error" in auth) return auth.error;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select("id, full_name, corporate_email, employee_number, departments(name), positions(name)")
    .eq("organization_id", auth.orgId)
    .eq("active", true)
    .is("profile_id", null)
    .order("full_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const employees: AccessCandidate[] = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.full_name),
    email: row.corporate_email ? String(row.corporate_email) : null,
    registration: row.employee_number ? String(row.employee_number) : null,
    department: relationName(row.departments),
    position: relationName(row.positions),
  }));
  return NextResponse.json({ employees });
}
