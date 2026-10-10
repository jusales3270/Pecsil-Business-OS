import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { perguntar } from "../../../../lib/decisao/client";
import type { Resposta } from "../../../../lib/decisao/core";
import { SETORES_DOCUMENTO } from "../../../../lib/documentos/setores";

export const dynamic = "force-dynamic";

/**
 * Setor sugerido pelo Clef para os arquivos que a regra deixou em dúvida. Vai só o nome do
 * arquivo e o nome da pasta, depois do filtro de dado pessoal. Com o uso "Triagem da coleta"
 * desligado no painel de Sugestões da IA, nada é consultado.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("fundacao.coleta", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { itens?: { id: string; nome: string; pasta?: string }[] };
  const itens = (body.itens ?? []).filter((i) => i.id && i.nome).slice(0, 50);
  const criterios: Record<string, string> = Object.fromEntries(SETORES_DOCUMENTO.map((s) => [s.modulo, `documento do setor ${s.rotulo}`]));
  criterios.pessoal = "arquivo pessoal, sem relação com a empresa";
  const resultado: { id: string; setor: string | null; confianca: number | null; faixa: string | null; julgamentoId: string | null; status: string }[] = [];
  for (const item of itens) {
    const r = await perguntar(guard.supabase, {
      uso: "fundacao.coleta_triagem",
      entidade: { tipo: "arquivo_coleta", id: item.id.slice(0, 80) },
      estado: `Arquivo: ${item.nome.slice(0, 200)}${item.pasta ? ` · pasta: ${item.pasta.slice(0, 120)}` : ""}`,
      perguntas: { setor: { type: "choice", instructions: "A qual setor da empresa este arquivo pertence?", criteria: criterios } },
    });
    if (r.status === "desligado" || r.status === "nao_configurado" || r.status === "uso_desconhecido") {
      return NextResponse.json({ status: r.status, itens: [] });
    }
    if (r.status !== "ok") { resultado.push({ id: item.id, setor: null, confianca: null, faixa: null, julgamentoId: "julgamentoId" in r ? r.julgamentoId : null, status: r.status }); continue; }
    const resposta = r.respostas.setor as Extract<Resposta, { type: "choice" }>;
    resultado.push({ id: item.id, setor: resposta.escolha, confianca: r.confianca, faixa: r.faixa, julgamentoId: r.julgamentoId, status: "ok" });
  }
  return NextResponse.json({ status: "ok", itens: resultado });
}
