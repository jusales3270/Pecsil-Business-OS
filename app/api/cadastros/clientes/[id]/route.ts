import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { CLIENTE_FEATURES, digitsOrNull } from "../route";

export const dynamic = "force-dynamic";

/**
 * Editar nome de exibição, CNPJ ou situação. A chave de reconhecimento
 * (normalized_name) não muda: a grafia antiga continua caindo neste cliente.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyFeature(CLIENTE_FEATURES, "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const changes: { name?: string; tax_id?: string | null; active?: boolean } = {};
  if (typeof body.name === "string") {
    if (!body.name.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
    changes.name = body.name.trim();
  }
  if (body.taxId !== undefined) {
    const taxId = digitsOrNull(body.taxId);
    if (taxId === undefined) {
      return NextResponse.json({ error: "CNPJ (14 dígitos) ou CPF (11 dígitos) inválido." }, { status: 400 });
    }
    changes.tax_id = taxId;
  }
  if (typeof body.active === "boolean") changes.active = body.active;
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });

  const { data, error } = await guard.supabase.from("customers").update(changes).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  return NextResponse.json({ id });
}

/**
 * Exclui o cadastro. Cliente com histórico NÃO é apagado: o vínculo do card ou
 * do título viraria nulo e a história perderia o dono. Nesse caso o caminho é
 * desativar, que tira das listas sem apagar nada.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyFeature(CLIENTE_FEATURES, "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;

  // A checagem roda no banco (security definer): quem cuida do CRM pode não
  // enxergar o Financeiro, e mesmo assim não pode apagar cliente com título.
  const { data: emUso, error: usoError } = await guard.supabase.rpc("customer_in_use", { target: id });
  if (usoError) return dbError(usoError);
  if (emUso) {
    return NextResponse.json(
      {
        error: "Este cliente tem histórico (cards ou títulos). Desative-o em Editar em vez de excluir.",
      },
      { status: 409 },
    );
  }

  const { data, error } = await guard.supabase.from("customers").delete().eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
