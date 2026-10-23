import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { rodarFilaDasGuias } from "../../../../../lib/sara/guias-executar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fila das guias da SARA (E3). Quem chama é a mesma tarefa agendada do Coolify que sincroniza a Forja
 * (scripts/sync-os-cron.mjs, de 10 em 10 minutos, de dentro do contêiner), com o mesmo segredo
 * (FORJA_SYNC_SECRET). Sem sessão de usuário: cada guia roda com a sessão de quem a criou
 * (lib/sara/guias-executar.ts). A resposta traz só contagens e situações.
 */
function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.FORJA_SYNC_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!segredoConfere(request.headers.get("x-sync-secret"))) return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  const r = await rodarFilaDasGuias(admin);
  return NextResponse.json({ enfileiradas: r.enfileiradas, rodadas: r.rodadas.map((x) => x.situacao), erro: r.erro ?? null }, { status: r.erro ? 500 : 200 });
}
