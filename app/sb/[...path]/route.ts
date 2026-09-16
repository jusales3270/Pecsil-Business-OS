import { NextResponse } from "next/server";
import { SUPABASE_ENV_KEYS } from "../../../lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Gateway do Supabase.
 *
 * O Supabase auto hospedado NÃO é publicado para fora do servidor: a única
 * porta pública é o próprio Business OS. O navegador usa
 * `NEXT_PUBLIC_SUPABASE_URL=https://<business-os>/sb` e este handler repassa
 * a chamada ao Kong pela rede interna (`SUPABASE_INTERNAL_URL`).
 *
 * Só as APIs que a aplicação usa passam. Todo o resto — postgres-meta (`pg/`),
 * analytics, functions — responde 404, então nada administrativo vaza por aqui.
 * A autorização continua sendo do Supabase: apikey + JWT do usuário + RLS.
 */
const ALLOWED_PREFIXES = ["auth/v1/", "rest/v1/", "storage/v1/"];

/** Headers que não podem atravessar um proxy (RFC 9110 §7.6.1) ou que o fetch recalcula. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const internalUrl = process.env[SUPABASE_ENV_KEYS.internalUrl]?.trim();
  if (!internalUrl) {
    // Sem a URL interna o repasse apontaria para si mesmo (loop).
    return NextResponse.json({ error: "Gateway do Supabase não configurado." }, { status: 503 });
  }

  const { path } = await context.params;
  if (path.some(segment => segment === ".." || segment === "." || segment === "")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const joined = path.join("/");
  if (!ALLOWED_PREFIXES.some(prefix => joined.startsWith(prefix))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const source = new URL(request.url);
  const target = `${internalUrl.replace(/\/+$/, "")}/${path.map(encodeURIComponent).join("/")}${source.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    // Cookies da plataforma não interessam ao Supabase (ele autentica pelo header).
    if (HOP_BY_HOP.has(name) || name === "cookie") return;
    headers.set(key, value);
  });
  headers.set("x-forwarded-host", source.host);
  headers.set("x-forwarded-proto", source.protocol.replace(":", ""));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      cache: "no-store",
      // Necessário para enviar corpo em stream (uploads do Storage).
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    console.error("[sb-gateway] Supabase interno inacessível:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    // O fetch já descomprimiu o corpo; repassar content-encoding corromperia a resposta.
    if (HOP_BY_HOP.has(name) || name === "content-encoding" || name === "set-cookie") return;
    responseHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
