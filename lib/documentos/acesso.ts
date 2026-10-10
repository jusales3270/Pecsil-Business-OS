import "server-only";

import { NextResponse } from "next/server";
import { readSessionAccess } from "../auth/session-access";
import { requireUserSession } from "../supabase/session";
import { setoresDeEnvio, setoresVisiveis } from "./setores";

/** Sessão + setores que a pessoa vê e em que pode enviar. Sem setor nenhum → 403. */
export async function exigirDocumentos() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { error: session.error } as const;
  let access;
  try {
    access = await readSessionAccess(session.supabase);
  } catch {
    return { error: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  }
  const visiveis = setoresVisiveis(access);
  if (!visiveis.length) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  return { supabase: session.supabase, access, visiveis, envio: setoresDeEnvio(access) } as const;
}

export const LIMITE_DOCUMENTO = 9_500_000;
