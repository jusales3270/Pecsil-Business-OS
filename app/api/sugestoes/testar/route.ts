import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { perguntar } from "../../../../lib/decisao/client";
import type { Pergunta } from "../../../../lib/decisao/core";

export const dynamic = "force-dynamic";

/**
 * "Testar o modelo" (só o proprietário): um texto e uma pergunta, pelo mesmo caminho de
 * qualquer uso — filtro de dado pessoal, chamada ao Clef e registro na auditoria.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("fundacao.sugestoes", "ver");
  if ("error" in guard) return guard.error;
  if (!guard.access.isOwner) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { estado?: string; tipo?: string; pergunta?: string; opcoes?: string[] };
  const estado = (body.estado ?? "").trim();
  const texto = (body.pergunta ?? "").trim();
  const opcoes = (body.opcoes ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 10);
  if (!estado || !texto) return NextResponse.json({ error: "Escreva o texto e a pergunta." }, { status: 400 });
  if (estado.length > 2000) return NextResponse.json({ error: "Texto longo demais para o teste (até 2.000 caracteres)." }, { status: 400 });

  let pergunta: Pergunta;
  if (body.tipo === "choice") {
    if (opcoes.length < 2) return NextResponse.json({ error: "Informe ao menos duas opções." }, { status: 400 });
    pergunta = { type: "choice", instructions: texto, criteria: Object.fromEntries(opcoes.map((o) => [o, o])) };
  } else if (body.tipo === "score") {
    if (opcoes.length < 2) return NextResponse.json({ error: "Informe os níveis da escala, do menor para o maior." }, { status: 400 });
    pergunta = { type: "score", instructions: texto, criteria: opcoes };
  } else {
    pergunta = { type: "noul", instructions: texto, criteria: { true: "sim", false: "não" } };
  }

  const resultado = await perguntar(guard.supabase, { uso: "fundacao.teste", estado, perguntas: { resposta: pergunta }, ignorarDesligado: true });
  if (resultado.status === "nao_configurado") return NextResponse.json({ error: "O Clef não está configurado neste servidor (CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN)." }, { status: 503 });
  if (resultado.status === "uso_desconhecido") return NextResponse.json({ error: "O uso de teste não existe nesta organização." }, { status: 500 });
  return NextResponse.json(resultado);
}
