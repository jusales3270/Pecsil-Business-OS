export const SUPABASE_ENV_KEYS = {
  url: "NEXT_PUBLIC_SUPABASE_URL",
  publishableKey: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  anonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  serviceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
} as const;

export type SupabaseConfigStatus = {
  publicConnectionReady: boolean;
  serverAdministrationReady: boolean;
  missingPublicKeys: string[];
};

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

export function requirePublicSupabaseConfig() {
  const status = getSupabaseConfigStatus();
  if (!status.publicConnectionReady) {
    throw new Error(
      `Supabase não configurado. Variáveis ausentes: ${status.missingPublicKeys.join(", ")}`,
    );
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  };
}
