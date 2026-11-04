import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../supabase/admin";

/** Attribution always comes from the authenticated session, never request JSON. */
export async function identidadeSara(sb: SupabaseClient): Promise<{ organizacao: string; perfil: string }> {
  const [org, perfil] = await Promise.all([sb.rpc("current_organization_id"), sb.rpc("current_profile_id")]);
  if (org.error || perfil.error || typeof org.data !== "string" || typeof perfil.data !== "string") throw new Error("Não foi possível conferir a sessão da SARA.");
  return { organizacao: org.data, perfil: perfil.data };
}

/** Missing, malformed or failed usage checks must never authorize paid work. */
export async function usoDoMes(sb: SupabaseClient, modulo: string): Promise<number> {
  const { data, error } = await sb.rpc("sara_uso_mes", { p_modulo: modulo });
  if (error || data === null || !/^\d+$/.test(String(data)) || !Number.isSafeInteger(Number(data))) throw new Error("Não foi possível conferir o limite de uso da SARA. Tente novamente.");
  return Number(data);
}

type Registro = { p_conversa: string | null; p_modulo: string; p_pergunta: string; p_resposta: string; p_ferramentas: unknown; p_modelo: string; p_tokens_entrada: number; p_tokens_saida: number };
/** Only the trusted server, with provider usage, can write the consumption ledger. */
export async function registrarNoServidor(sb: SupabaseClient, registro: Registro, admin?: SupabaseClient) {
  const pessoa = await identidadeSara(sb);
  for (const n of [registro.p_tokens_entrada, registro.p_tokens_saida]) if (!Number.isSafeInteger(n) || n < 0 || n > 10_000_000) throw new Error("Consumo da SARA inválido.");
  return (admin ?? createSupabaseAdminClient()).rpc("sara_registrar_servidor", { ...registro, p_organizacao: pessoa.organizacao, p_perfil: pessoa.perfil });
}

/** Conservative debit before transcription, including failed provider requests; atomic rate/ceiling guard. */
export async function reservarTranscricao(sb: SupabaseClient, modulo: string, bytes: number, admin?: SupabaseClient) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 10_000_000) throw new Error("Áudio vazio ou grande demais.");
  const pessoa = await identidadeSara(sb);
  const tokens = Math.max(5000, Math.min(200_000, Math.ceil(bytes / 1000) * 100));
  const { error } = await (admin ?? createSupabaseAdminClient()).rpc("sara_audio_reservar", { p_organizacao: pessoa.organizacao, p_perfil: pessoa.perfil, p_modulo: modulo, p_tokens: tokens });
  if (error) throw new Error("Transcrição indisponível ou limite de uso atingido. Tente mais tarde.");
}
