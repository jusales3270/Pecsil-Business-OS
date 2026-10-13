import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { origemDoPedido, type Origem } from "./digital-regras";

/**
 * "Entrar com a digital" no servidor (passkey/WebAuthn, 13/10/2026). Desafios de uso único no banco
 * (5 minutos), conferência do endereço do pedido e auditoria. A biometria nunca chega aqui: o
 * celular assina o desafio e o servidor confere com a chave pública guardada.
 */

export const base64url = {
  de: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
  para: (b: Uint8Array) => Buffer.from(b).toString("base64url"),
};

export function origemDaRequest(request: Request): Origem | { erro: string } {
  return origemDoPedido({
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    origin: request.headers.get("origin"),
  });
}

/** Guarda o desafio e devolve o id (que o navegador manda de volta junto com a assinatura). */
export async function guardarDesafio(admin: SupabaseClient, kind: "registro" | "login", challenge: string, userId: string | null): Promise<string | null> {
  // Limpeza dos vencidos e freio contra enxurrada de pedidos de desafio (a rota de login é pública).
  await admin.from("access_passkey_challenges").delete().lt("expires_at", new Date().toISOString());
  const { count } = await admin.from("access_passkey_challenges").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 1000) return null;
  const { data, error } = await admin.from("access_passkey_challenges").insert({ kind, challenge, user_id: userId }).select("id").single();
  return error ? null : data.id;
}

/** Usa o desafio UMA vez: lê e apaga. Vencido, de outro tipo ou de outra pessoa → nulo. */
export async function consumirDesafio(admin: SupabaseClient, id: unknown, kind: "registro" | "login", userId: string | null): Promise<string | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("access_passkey_challenges").delete().eq("id", id).select("challenge, kind, user_id, expires_at").maybeSingle();
  if (!data || data.kind !== kind || new Date(data.expires_at).getTime() < Date.now()) return null;
  if (kind === "registro" && data.user_id !== userId) return null;
  return data.challenge;
}

export async function auditarDigital(
  admin: SupabaseClient,
  a: { org: string; userId: string; profileId: string; evento: "cadastrada" | "login" | "falha"; passkeyId: string | null; risco: "normal" | "sensitive"; dados: Record<string, unknown> },
) {
  await admin.from("audit_logs").insert({
    organization_id: a.org, actor_user_id: a.userId, actor_profile_id: a.profileId, module_code: "core",
    event_type: `core.access.digital.${a.evento}`, entity_type: "access_passkey", entity_id: a.passkeyId, risk_level: a.risco, metadata: a.dados,
  });
}
