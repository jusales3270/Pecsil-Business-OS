import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { lerConfigGraph } from "../../../../lib/mail/graph-client";

export const dynamic = "force-dynamic";

export type ContaConexao = {
  id: string;
  address: string;
  label: string;
  mode: "todos" | "remetentes_conhecidos";
  readsBody: boolean;
  active: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  mensagens: number;
  ultimaMensagem: string | null;
};

/**
 * Situação da leitura de e-mail: o que está configurado, quando rodou pela
 * última vez e qual foi o último erro. Não devolve o estado do delta (que
 * carrega token do provedor) nem segredo nenhum — só se está preenchido.
 */
export async function GET() {
  const guard = await requireFeature("comercial.conexao");
  if ("error" in guard) return guard.error;

  const { data, error } = await guard.supabase.rpc("mail_accounts_status");
  if (error) return dbError(error);

  const contas: ContaConexao[] = (
    (data ?? []) as {
      id: string;
      address: string;
      label: string;
      mode: "todos" | "remetentes_conhecidos";
      reads_body: boolean;
      active: boolean;
      last_sync_at: string | null;
      last_error: string | null;
      last_error_at: string | null;
      mensagens: number;
      ultima_mensagem: string | null;
    }[]
  ).map((linha) => ({
    id: linha.id,
    address: linha.address,
    label: linha.label,
    mode: linha.mode,
    readsBody: linha.reads_body,
    active: linha.active,
    lastSyncAt: linha.last_sync_at,
    lastError: linha.last_error,
    lastErrorAt: linha.last_error_at,
    mensagens: Number(linha.mensagens ?? 0),
    ultimaMensagem: linha.ultima_mensagem,
  }));

  return NextResponse.json({
    contas,
    // Só dizemos se o aplicativo da Microsoft está configurado — nunca o valor.
    aplicativoConfigurado: Boolean(lerConfigGraph()),
    agendamentoConfigurado: Boolean(process.env.MAIL_SYNC_SECRET?.trim()),
    isOwner: guard.access.isOwner,
  });
}
