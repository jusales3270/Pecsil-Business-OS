import "server-only";

import { NextResponse } from "next/server";
import { requireUserSession } from "../supabase/session";
import { readSessionAccess } from "./session-access";
import type { AccessLevel } from "../../modules/access-catalog";

/**
 * Sessão do usuário + exigência de uma funcionalidade. O banco (RLS) continua
 * sendo quem decide as linhas; isto só devolve um 403 claro antes da consulta.
 */
export async function requireFeature(feature: string, level: AccessLevel = "ver") {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { error: session.error } as const;
  let access;
  try {
    access = await readSessionAccess(session.supabase);
  } catch {
    return { error: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  }
  if (!access.can(feature, level)) {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  }
  return { supabase: session.supabase, access } as const;
}

/**
 * Igual ao `requireFeature`, mas basta UMA das funcionalidades. Serve para o
 * que é compartilhado por dois caminhos — o cadastro de clientes, por exemplo,
 * abre em Fundação › Cadastros e no CRM.
 */
export async function requireAnyFeature(features: readonly string[], level: AccessLevel = "ver") {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { error: session.error } as const;
  let access;
  try {
    access = await readSessionAccess(session.supabase);
  } catch {
    return { error: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  }
  if (!features.some((feature) => access.can(feature, level))) {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  }
  return { supabase: session.supabase, access } as const;
}

/** Erro do Postgres → resposta. 42501 = RLS/permissão. */
export function dbError(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ error: "Sem permissão para esta alteração." }, { status: 403 });
  if (error.code === "23505") return NextResponse.json({ error: "Já existe um cadastro com esse código ou documento." }, { status: 409 });
  return NextResponse.json({ error: error.message }, { status: 400 });
}
