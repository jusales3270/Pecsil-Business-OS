import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { normalizeName, suggestDuplicates, supplierChanges, type SupplierInput } from "../../../../lib/compras/fornecedores-core";
import { SUPPLIER_COLUMNS, toSupplier, type SummaryRow, type SupplierRow } from "../../../../lib/compras/fornecedores-db";

export const dynamic = "force-dynamic";

/** Fornecedores do Compras: cadastro, apelidos, resumo de compras e possíveis duplicados. */
export async function GET() {
  const guard = await requireFeature("compras.fornecedores");
  if ("error" in guard) return guard.error;
  const { supabase, access } = guard;

  const [suppliersResult, summaryResult] = await Promise.all([
    supabase.from("suppliers").select(SUPPLIER_COLUMNS).order("name"),
    supabase.rpc("supplier_purchase_summary"),
  ]);
  if (suppliersResult.error) return dbError(suppliersResult.error);
  if (summaryResult.error) return dbError(summaryResult.error);

  const rows = (suppliersResult.data ?? []) as SupplierRow[];
  const aliases = new Map<string, string[]>();
  for (const row of rows) {
    if (row.merged_into) aliases.set(row.merged_into, [...(aliases.get(row.merged_into) ?? []), row.name]);
  }
  const summary = new Map(((summaryResult.data ?? []) as SummaryRow[]).map((s) => [s.supplier_id, s]));
  const principal = rows.filter((row) => !row.merged_into);

  const suppliers = principal.map((row) => {
    const s = summary.get(row.id);
    return {
      ...toSupplier(row, aliases.get(row.id) ?? []),
      summary: {
        cotacoes: Number(s?.cotacoes ?? 0),
        aprovadas: Number(s?.aprovadas ?? 0),
        rejeitadas: Number(s?.rejeitadas ?? 0),
        compradas: Number(s?.compradas ?? 0),
        pendentes: Number(s?.pendentes ?? 0),
        compras: Number(s?.compras ?? 0),
        totalComprado: Number(s?.total_comprado ?? 0),
        primeiraCompra: s?.primeira_compra ?? null,
        ultimaCompra: s?.ultima_compra ?? null,
        ultimaCotacao: s?.ultima_cotacao ?? null,
        divisoes: s?.divisoes ?? [],
      },
    };
  });

  return NextResponse.json({
    suppliers,
    duplicates: suggestDuplicates(principal.filter((row) => row.active)),
    canEdit: access.can("compras.fornecedores", "operar") || access.can("fundacao.cadastros", "operar"),
  });
}

/** Cadastrar fornecedor novo pelo Compras. */
export async function POST(request: Request) {
  const guard = await requireFeature("compras.fornecedores", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as SupplierInput;
  if (!body.name?.trim()) return NextResponse.json({ error: "Informe o nome do fornecedor." }, { status: 400 });
  const result = supplierChanges(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const { data: organizationId, error: orgError } = await guard.supabase.rpc("current_organization_id");
  if (orgError || !organizationId) return NextResponse.json({ error: "Organização não encontrada." }, { status: 400 });
  const normalized = normalizeName(body.name);
  const { data: existing } = await guard.supabase
    .from("suppliers")
    .select("id, name, merged_into")
    .eq("normalized_name", normalized)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `Já existe o fornecedor "${existing.name}".`, id: existing.merged_into ?? existing.id }, { status: 409 });
  }

  const { data, error } = await guard.supabase
    .from("suppliers")
    .insert({ ...result.changes, organization_id: organizationId, normalized_name: normalized })
    .select("id")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
