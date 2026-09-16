export const SUPABASE_ENV_KEYS = {
  url: "NEXT_PUBLIC_SUPABASE_URL",
  internalUrl: "SUPABASE_INTERNAL_URL",
  publishableKey: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  anonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  serviceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
} as const;

/**
 * Nome fixo do cookie de sessão.
 *
 * Por padrão o `@supabase/ssr` deriva o nome do hostname da URL. Em produção o
 * navegador fala com `https://<business-os>/sb` e o servidor com o Kong pela
 * rede interna — hostnames diferentes gerariam cookies diferentes e o servidor
 * não enxergaria a sessão. Todo cliente SSR deve usar este nome.
 */
export const SUPABASE_AUTH_COOKIE = "sb-pecsil-auth-token";

/**
 * O Next.js só substitui `process.env.NEXT_PUBLIC_*` no bundle do navegador
 * quando o acesso é ESTÁTICO (nome literal). Um acesso dinâmico
 * `process.env[nome]` não é embutido no client e vira `undefined` no navegador
 * — foi o que quebrava o login após migrar do vinext (que expunha `process.env`
 * inteiro) para o Next padrão. Por isso os públicos são referenciados por nome
 * literal aqui; o server-only (service role) fica no acesso dinâmico, lido só em
 * runtime no servidor e nunca embutido no navegador.
 */
const STATIC_PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

/**
 * Lê uma variável tratando string vazia como ausente.
 *
 * O `.env.example` instrui a deixar em branco a chave que não se aplica —
 * instalação self-hosted usa ANON_KEY e deixa PUBLISHABLE_KEY vazia. Com `??`
 * a string vazia venceria o fallback (só null/undefined disparam `??`) e o
 * navegador reportaria "Supabase não configurado" mesmo com tudo preenchido.
 */
function readEnv(name: string): string | undefined {
  const value =
    name in STATIC_PUBLIC_ENV ? STATIC_PUBLIC_ENV[name] : process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export type SupabaseConfigStatus = {
  publicConnectionReady: boolean;
  serverAdministrationReady: boolean;
  missingPublicKeys: string[];
};

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const url = readEnv(SUPABASE_ENV_KEYS.url);
  const publishableKey =
    readEnv(SUPABASE_ENV_KEYS.publishableKey) ?? readEnv(SUPABASE_ENV_KEYS.anonKey);
  const serviceRoleKey = readEnv(SUPABASE_ENV_KEYS.serviceRoleKey);
  const missingPublicKeys = [
    !url ? SUPABASE_ENV_KEYS.url : null,
    !publishableKey
      ? `${SUPABASE_ENV_KEYS.publishableKey} ou ${SUPABASE_ENV_KEYS.anonKey}`
      : null,
  ].filter((key): key is string => Boolean(key));

  return {
    publicConnectionReady: missingPublicKeys.length === 0,
    serverAdministrationReady: Boolean(url && serviceRoleKey),
    missingPublicKeys,
  };
}

/**
 * URL do Supabase para chamadas feitas NO SERVIDOR.
 *
 * O Supabase não é publicado para fora: o navegador passa pelo gateway `/sb`
 * do Business OS (URL pública), enquanto o servidor fala direto com o Kong pela
 * rede interna do Docker (`SUPABASE_INTERNAL_URL`). Sem a interna configurada
 * (ex.: desenvolvimento local), usa a pública.
 */
export function getServerSupabaseUrl() {
  return readEnv(SUPABASE_ENV_KEYS.internalUrl) ?? readEnv(SUPABASE_ENV_KEYS.url);
}

export function requireServerSupabaseConfig() {
  const { publishableKey } = requirePublicSupabaseConfig();
  return { url: getServerSupabaseUrl()!, publishableKey };
}

export function requirePublicSupabaseConfig() {
  const status = getSupabaseConfigStatus();
  if (!status.publicConnectionReady) {
    throw new Error(
      `Supabase não configurado. Variáveis ausentes: ${status.missingPublicKeys.join(", ")}`,
    );
  }

  return {
    url: readEnv(SUPABASE_ENV_KEYS.url)!,
    publishableKey:
      (readEnv(SUPABASE_ENV_KEYS.publishableKey) ?? readEnv(SUPABASE_ENV_KEYS.anonKey))!,
  };
}
