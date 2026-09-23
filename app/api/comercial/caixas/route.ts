import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Cadastro das caixas monitoradas. Só o proprietário (o RLS de `mail_accounts`
 * exige `is_owner()`): decidir qual caixa o sistema lê, e se lê o corpo, é
 * decisão de dono, não de operação.
 *
 * `modo = remetentes_conhecidos` força `reads_body = false` no banco: é a caixa
 * de uma pessoa, e de lá o sistema só registra quem já está cadastrado, sem
 * corpo. Vale junto com o papel restrito no Exchange (`Mail.ReadBasic`) — um
 * protege o banco, o outro impede que o corpo chegue até aqui.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("comercial.conexao");
  if ("error" in guard) return guard.error;
  if (!guard.access.isOwner) return NextResponse.json({ error: "Só o proprietário cadastra caixas." }, { status: 403 });
  const body = await request.json().catch(() => ({}));

  const address = String(body.address ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return NextResponse.json({ error: "E-mail da caixa inválido." }, { status: 400 });
  }
  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Dê um nome à caixa (ex.: Comercial)." }, { status: 400 });
  const mode = body.mode === "remetentes_conhecidos" ? "remetentes_conhecidos" : "todos";

  const { data: organizationId, error: orgError } = await guard.supabase.rpc("current_organization_id");
  if (orgError || !organizationId) return NextResponse.json({ error: "Organização não encontrada." }, { status: 400 });

  const { data, error } = await guard.supabase
    .from("mail_accounts")
    .insert({
      organization_id: organizationId,
      address,
      label,
      // O identificador no Graph é o próprio endereço (UPN da caixa).
      mailbox_id: address,
      mode,
      reads_body: mode === "todos",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Esta caixa já está cadastrada." }, { status: 409 });
    return dbError(error);
  }
  return NextResponse.json({ id: data.id });
}
