import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

export type Supplier = {
  id: string;
  name: string;
  taxId: string | null;
  active: boolean;
  aliases: string[];
  usage: { cotacoes: number; compras: number; titulos: number };
};

/** Cadastro mestre de fornecedores, com os apelidos unificados e o uso em cada módulo. */
export async function GET() {
  const guard = await requireFeature("fundacao.cadastros");
  if ("error" in guard) return guard.error;
  const { supabase } = guard;

  const [suppliersResult, usageResult] = await Promise.all([
    supabase.from("suppliers").select("id, name, normalized_name, tax_id, active, merged_into").order("name"),
    supabase.rpc("supplier_usage"),
  ]);
  if (suppliersResult.error) return dbError(suppliersResult.error);
  if (usageResult.error) return dbError(usageResult.error);

  const usage = new Map(
    ((usageResult.data ?? []) as { supplier_id: string; cotacoes: number; compras: number; titulos: number }[])
      .map((row) => [row.supplier_id, row]),
  );
  const rows = suppliersResult.data ?? [];
  const aliases = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.merged_into) continue;
    aliases.set(row.merged_into, [...(aliases.get(row.merged_into) ?? []), row.name]);
  }

  const suppliers: Supplier[] = rows
    .filter((row) => !row.merged_into)
    .map((row) => {
      const counts = usage.get(row.id);
      return {
        id: row.id,
        name: row.name,
        taxId: row.tax_id,
        active: row.active,
        aliases: aliases.get(row.id) ?? [],
        usage: { cotacoes: Number(counts?.cotacoes ?? 0), compras: Number(counts?.compras ?? 0), titulos: Number(counts?.titulos ?? 0) },
      };
    });
  return NextResponse.json({ suppliers, canEdit: guard.access.can("fundacao.cadastros", "operar") });
}
