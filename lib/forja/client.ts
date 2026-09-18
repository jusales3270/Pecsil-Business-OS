import "server-only";

import http from "node:http";
import https from "node:https";
import { createForjaSession, ForjaError, type ForjaTransport } from "./forja-session";

/**
 * Cliente do Forja no servidor do Business OS.
 *
 * O Forja roda em outra rede Docker; o caminho interno é o Traefik do Coolify
 * (`coolify-proxy`, na rede `coolify`), que roteia pelo cabeçalho `Host`
 * (`forja.pecsil`) até o nginx do Forja e dali ao backend. O `fetch` do Node
 * descarta um `Host` customizado, por isso a chamada usa `node:http`.
 *
 * - FORJA_API_URL: base (padrão `http://coolify-proxy`)
 * - FORJA_API_HOST: nome virtual no Traefik (ex.: `forja.pecsil`)
 * - FORJA_SERVICE_CODE / FORJA_SERVICE_PIN: conta de integração (papel Chefe)
 */

const TIMEOUT_MS = { POST: 5_000, GET: 10_000 } as const;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

function forjaTransport(baseUrl: string, hostHeader: string | undefined): ForjaTransport {
  const base = new URL(baseUrl);
  const client = base.protocol === "https:" ? https : http;

  return ({ method, path, token, body }) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (hostHeader) headers.Host = hostHeader;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }

    const request = client.request(new URL(path, base), { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          request.destroy(new ForjaError("BAD_RESPONSE", "Resposta do Forja maior que o esperado."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        resolve({ status: response.statusCode ?? 0, body: parsed });
      });
    });

    request.setTimeout(TIMEOUT_MS[method], () => {
      request.destroy(new ForjaError("TIMEOUT", `O Forja não respondeu em ${TIMEOUT_MS[method] / 1000}s.`));
    });
    request.on("error", (error) => {
      reject(error instanceof ForjaError ? error : new ForjaError("UNREACHABLE", `Forja inacessível (${(error as NodeJS.ErrnoException).code ?? error.message}).`));
    });
    if (payload) request.write(payload);
    request.end();
  });
}

function createFromEnv() {
  const code = process.env.FORJA_SERVICE_CODE?.trim();
  const pin = process.env.FORJA_SERVICE_PIN?.trim();
  return createForjaSession({
    transport: forjaTransport(process.env.FORJA_API_URL?.trim() || "http://coolify-proxy", process.env.FORJA_API_HOST?.trim() || undefined),
    credentials: code && pin ? { code, pin } : null,
  });
}

// Uma sessão por processo: token e cache valem para todos os usuários.
const globalForja = globalThis as typeof globalThis & { __forjaSession?: ReturnType<typeof createFromEnv> };

export function getForjaSession() {
  globalForja.__forjaSession ??= createFromEnv();
  return globalForja.__forjaSession;
}

export { ForjaError };
