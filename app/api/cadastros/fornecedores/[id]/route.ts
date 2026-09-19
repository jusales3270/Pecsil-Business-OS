import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Editar nome de exibição, CNPJ ou situação. O apelido antigo continua vinculado. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("fundacao.cadastros", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const changes: { name?: string; tax_id?: string | null; active?: boolean } = {};
  if (typeof body.name === "string") {
    if (!body.name.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
    changes.name = body.name.trim();
  }
  if (body.taxId !== undefined) {
    const digits = String(body.taxId ?? "").replace(/\D/g, "");
    if (digits && digits.length !== 14 && digits.length !== 11) {
      return NextResponse.json({ error: "CNPJ (14 dígitos) ou CPF (11 dígitos) inválido." }, { status: 400 });
    }
    changes.tax_id = digits || null;
  }
  if (typeof body.active === "boolean") changes.active = body.active;
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });

  const { data, error } = await guard.supabase.from("suppliers").update(changes).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Fornecedor não encontrado." }, { status: 404 });
  return NextResponse.json({ id });
}
