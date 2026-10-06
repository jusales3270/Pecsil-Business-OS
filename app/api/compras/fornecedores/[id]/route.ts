import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { normalizeName, supplierChanges, type SupplierInput } from "../../../../../lib/compras/fornecedores-core";

export const dynamic = "force-dynamic";

/**
 * Editar o cadastro pelo Compras. O nome é o de exibição: os lançamentos
 * apontam pelo id e o nome original continua sendo a chave que liga cotações
 * novas escritas daquele jeito (mesmo comportamento da Fundação › Cadastros).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("compras.fornecedores", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SupplierInput;
  const result = supplierChanges(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  if (!Object.keys(result.changes).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });

  const newName = typeof result.changes.name === "string" ? result.changes.name : null;
  if (newName) {
    const { data: clash } = await guard.supabase
      .from("suppliers")
      .select("id, name, merged_into")
      .eq("normalized_name", normalizeName(newName))
      .maybeSingle();
    if (clash && (clash.merged_into ?? clash.id) !== id) {
      return NextResponse.json({ error: `Já existe o fornecedor "${clash.name}". Use Unificar.` }, { status: 409 });
    }
  }

  const newTaxId = typeof result.changes.tax_id === "string" ? result.changes.tax_id : null;
  if (newTaxId) {
    const { data: owner } = await guard.supabase
      .from("suppliers")
      .select("id, name, active, merged_into")
      .eq("tax_id", newTaxId)
      .neq("id", id)
      .maybeSingle();
    if (owner) {
      const aviso = owner.merged_into ? " (já unificado em outro cadastro)" : owner.active ? "" : " (inativo)";
      return NextResponse.json({ error: `Este CNPJ já está no fornecedor "${owner.name}"${aviso}.` }, { status: 409 });
    }
  }

  const { data, error } = await guard.supabase.from("suppliers").update(result.changes).eq("id", id).is("merged_into", null).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Fornecedor não encontrado." }, { status: 404 });
  return NextResponse.json({ id });
}
