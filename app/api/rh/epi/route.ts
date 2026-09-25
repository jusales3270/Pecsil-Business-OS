import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Ficha de EPI: todas as entregas, com o item (nome e CA) e o colaborador.
 * Fica fora do snapshot geral do RH para não pesar as outras telas. A RLS de
 * `rh_ppe_deliveries` repete a exigência de `rh.sst` no banco. Nenhum
 * documento pessoal sai por aqui.
 */
export async function GET() {
  const guard = await requireFeature("rh.sst");
  if ("error" in guard) return guard.error;

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await guard.supabase
      .from("rh_ppe_deliveries")
      .select("id,quantity,delivered_on,signed_on,employee_id,employees(full_name,departments(name)),rh_ppe_items(id,name,ca_number)")
      .order("delivered_on", { ascending: false })
      .order("id")
      .range(from, from + 999);
    if (error) return dbError(error);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
  const deliveries = rows.map((row) => {
    const employee = one(row.employees as { full_name: string; departments: { name: string } | { name: string }[] | null } | null);
    const item = one(row.rh_ppe_items as { id: string; name: string; ca_number: string | null } | null);
    return {
      id: String(row.id),
      employeeId: String(row.employee_id),
      employeeName: employee?.full_name ?? "Não informado",
      department: one(employee?.departments)?.name ?? null,
      itemId: item?.id ?? "",
      itemName: item?.name ?? "—",
      caNumber: item?.ca_number ?? null,
      quantity: Number(row.quantity),
      deliveredOn: String(row.delivered_on),
      signedOn: row.signed_on ? String(row.signed_on) : null,
    };
  });

  const response = NextResponse.json({ deliveries });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
