import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * IP de quem fez o login (B-11). O GoTrue grava o login com o IP vazio, então a plataforma guarda o
 * que o proxy entrega. Na frente do Business OS há um proxy só (o Traefik do Coolify), que descarta o
 * X-Forwarded-For vindo do navegador e acrescenta o IP de quem conectou: vale o ÚLTIMO da lista.
 * Sem cabeçalho (servidor local), fica sem IP.
 */
export function ipDaRequest(headers: Headers): string | null {
  const lista = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const candidato of [lista.at(-1), headers.get("x-real-ip")?.trim()]) {
    const ip = candidato?.replace(/^::ffff:/, "");
    if (ip && isIP(ip)) return ip;
  }
  return null;
}

/** Grava o IP do login. Nunca derruba o login: se a gravação falhar, só registra no log do servidor. */
export async function registrarIpDoLogin(admin: SupabaseClient, a: { userId: string; headers: Headers; via: "senha" | "digital" }) {
  const { error } = await admin.from("login_ips").insert({
    user_id: a.userId, ip: ipDaRequest(a.headers), via: a.via,
    user_agent: a.headers.get("user-agent")?.slice(0, 300) || null,
  });
  if (error) console.error("[login-ip] não gravou o IP do login:", error.message);
}
