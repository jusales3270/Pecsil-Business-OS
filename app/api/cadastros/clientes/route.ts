import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Quem pode ver/editar clientes: os cadastros mestres ou o CRM. */
export const CLIENTE_FEATURES = ["fundacao.cadastros", "comercial.clientes"] as const;

export type Customer = {
  id: string;
  name: string;
  taxId: string | null;
  active: boolean;
  aliases: string[];
  emails: { id: string; email: string; label: string | null }[];
  usage: { titulos: number; cards: number };
};

/** Cadastro mestre de clientes, com apelidos unificados e e-mails conhecidos. */
export async function GET() {
  const guard = await requireAnyFeature(CLIENTE_FEATURES);
  if ("error" in guard) return guard.error;
  const { supabase } = guard;

  const [customersResult, emailsResult, usageResult] = await Promise.all([
    supabase.from("customers").select("id, name, tax_id, active, merged_into").order("name"),
    supabase.from("party_emails").select("id, email, label, customer_id").not("customer_id", "is", null).order("email"),
    supabase.rpc("customer_usage"),
  ]);
  if (customersResult.error) return dbError(customersResult.error);
  if (emailsResult.error) return dbError(emailsResult.error);
  const usage = new Map(
    ((usageResult.data ?? []) as { customer_id: string; titulos: number; cards: number }[]).map((row) => [row.customer_id, row]),
  );

  const rows = customersResult.data ?? [];
  const aliases = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.merged_into) continue;
    aliases.set(row.merged_into, [...(aliases.get(row.merged_into) ?? []), row.name]);
  }
  const emails = new Map<string, { id: string; email: string; label: string | null }[]>();
  for (const row of emailsResult.data ?? []) {
    const key = row.customer_id as string;
    emails.set(key, [...(emails.get(key) ?? []), { id: row.id, email: row.email, label: row.label }]);
  }

  const customers: Customer[] = rows
    .filter((row) => !row.merged_into)
    .map((row) => ({
      id: row.id,
      name: row.name,
      taxId: row.tax_id,
      active: row.active,
      aliases: aliases.get(row.id) ?? [],
      emails: emails.get(row.id) ?? [],
      usage: {
        titulos: Number(usage.get(row.id)?.titulos ?? 0),
        cards: Number(usage.get(row.id)?.cards ?? 0),
      },
    }));
  return NextResponse.json({
    customers,
    canEdit: CLIENTE_FEATURES.some((feature) => guard.access.can(feature, "operar")),
    // Unificar mexe em cadastro mestre: é de quem cuida dos Cadastros.
    canMerge: guard.access.can("fundacao.cadastros", "operar"),
  });
}

/** CNPJ (14) ou CPF (11); devolve só os dígitos, ou undefined se estiver errado. */
export function digitsOrNull(value: unknown): string | null | undefined {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length !== 14 && digits.length !== 11) return undefined;
  return digits;
}

/**
 * Novo cliente. Diferente do fornecedor, o cliente não nasce de lançamento
 * nenhum ainda: hoje é cadastrado aqui (e, com o CRM ligado, pelo e-mail que
 * chega). Nome repetido cai no cadastro existente — quem resolve é o banco,
 * pelo nome normalizado.
 */
export async function POST(request: Request) {
  const guard = await requireAnyFeature(CLIENTE_FEATURES, "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Informe o nome do cliente." }, { status: 400 });
  const taxId = digitsOrNull(body.taxId);
  if (taxId === undefined) {
    return NextResponse.json({ error: "CNPJ (14 dígitos) ou CPF (11 dígitos) inválido." }, { status: 400 });
  }

  const { data: organizationId, error: orgError } = await guard.supabase.rpc("current_organization_id");
  if (orgError || !organizationId) return NextResponse.json({ error: "Organização não encontrada." }, { status: 400 });

  const { data, error } = await guard.supabase
    .from("customers")
    // `normalized_name` fica por conta do gatilho `customers_key`.
    .insert({ organization_id: organizationId, name, tax_id: taxId })
    .select("id")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ id: data.id });
}
