import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * CNPJ a conferir (captura automática a cada nota, 12/10/2026): pendências "completar", "novo" e
 * "conflito" vindas das notas do ICMS, dos recebimentos e dos XML guardados. Quem vê Fornecedores
 * (Compras) ou Cadastros (Fundação) vê a lista; decidir exige operar (o banco confere).
 * `?busca=` devolve até 10 fornecedores SEM CNPJ com o nome parecido, para "É um fornecedor já cadastrado".
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["compras.fornecedores", "fundacao.cadastros"], "ver");
  if ("error" in guard) return guard.error;
  const busca = (new URL(request.url).searchParams.get("busca") ?? "").trim().slice(0, 80);
  if (busca) {
    const termo = busca.replace(/[%,()]/g, " ");
    const { data } = await guard.supabase.from("suppliers").select("id, name").is("merged_into", null).is("tax_id", null)
      .ilike("name", `%${termo}%`).order("name").limit(10);
    return NextResponse.json({ fornecedores: data ?? [] });
  }
  const { data, error } = await guard.supabase.from("supplier_cnpj_suggestions")
    .select("id, tipo, cnpj, nome_na_nota, origem_tipo, origem_id, created_at, fornecedor:suppliers!supplier_cnpj_suggestions_supplier_id_fkey(id, name, tax_id), outro:suppliers!supplier_cnpj_suggestions_outro_supplier_id_fkey(id, name, tax_id)")
    .eq("status", "pendente").order("created_at", { ascending: false }).limit(200);
  if (error) {
    console.error("Falha ao listar CNPJ a conferir", error);
    return NextResponse.json({ error: "CNPJ_UNAVAILABLE" }, { status: 503 });
  }
  const podeDecidir = guard.access.isOwner || guard.access.can("compras.fornecedores", "operar") || guard.access.can("fundacao.cadastros", "operar");
  return NextResponse.json({ pendencias: data ?? [], podeDecidir });
}
