import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("fundacao.cadastros", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const changes: { name?: string; active?: boolean; department_id?: string | null } = {};
  if (typeof body.name === "string") {
    if (!body.name.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
    changes.name = body.name.trim();
  }
  if (typeof body.active === "boolean") changes.active = body.active;
  if (body.departmentId !== undefined) changes.department_id = body.departmentId || null;
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });
  const { data, error } = await guard.supabase.from("finance_cost_centers").update(changes).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Centro de custo não encontrado." }, { status: 404 });
  return NextResponse.json({ id });
}
