import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { processarPendentes } from "../../../../../lib/leitura/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Rodada da leitura dos documentos (Segundo Cérebro, Etapa 3): lê o texto dos documentos ainda
 * sem leitura e faz o OCR (local, D4) dos escaneados e fotos.
 *
 * Quem chama é a tarefa agendada do Coolify, de dentro do contêiner, a cada 5 minutos:
 * `node scripts/leitura-documentos-cron.mjs`. Sem sessão de usuário, grava com a chave de
 * serviço; por isso exige segredo próprio (`DOCUMENTOS_LEITURA_SECRET`, 16+ caracteres),
 * comparado sem vazar tempo. A resposta traz só contagens.
 */
function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.DOCUMENTOS_LEITURA_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.DOCUMENTOS_LEITURA_SECRET?.trim()) {
    return NextResponse.json({ error: "DOCUMENTOS_LEITURA_SECRET não configurado." }, { status: 503 });
  }
  if (!segredoConfere(request.headers.get("x-leitura-secret"))) {
    return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  }
  try {
    const rodada = await processarPendentes(createSupabaseAdminClient(), { limite: 10, prazoMs: 50_000 });
    return NextResponse.json(rodada);
  } catch (e) {
    console.error("Falha na rodada de leitura dos documentos", e);
    return NextResponse.json({ error: "Falha na rodada de leitura." }, { status: 500 });
  }
}
