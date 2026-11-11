import { NextResponse } from "next/server";
import { transcrever } from "../../../../lib/sara/voz";
import { conferirAudio } from "../../../../lib/sara/voz-core";
import { requireUserSession } from "../../../../lib/supabase/session";
import { semAlucinacao } from "../../../../lib/tarefas/reuniao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Um trecho (~50 s) da reunião gravada (I-29) vira texto no Whisper da Cloudflare. Qualquer pessoa ativa (tarefa é
 * para todos, não depende da SARA da área). O áudio não é guardado: vai, volta o texto e acabou. Silêncio não é
 * erro (volta texto vazio); falha do serviço é 502, e a tela tenta de novo antes de marcar o trecho como perdido.
 */
export async function POST(request: Request) {
  const s = await requireUserSession();
  if ("error" in s && s.error) return s.error;
  const { data: eu } = await s.supabase.from("profiles").select("status, access_expires_at").eq("user_id", s.user.id).maybeSingle();
  if (!eu || eu.status !== "active" || (eu.access_expires_at && Date.parse(eu.access_expires_at) <= Date.now()))
    return NextResponse.json({ error: "Acesso inativo." }, { status: 403 });
  const audio = await request.arrayBuffer().catch(() => null);
  const conferido = conferirAudio(request.headers.get("content-type"), audio?.byteLength ?? 0);
  if (!audio || !conferido.ok) return NextResponse.json({ error: conferido.ok ? "Áudio vazio." : conferido.erro }, { status: 400 });
  const r = await transcrever(audio);
  if ("erro" in r) return r.erro.startsWith("Não entendi") ? NextResponse.json({ texto: "", silencio: true }) : NextResponse.json({ error: r.erro }, { status: 502 });
  const texto = semAlucinacao(r.texto);
  return NextResponse.json(texto ? { texto } : { texto: "", silencio: true });
}
