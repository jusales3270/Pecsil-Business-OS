import { NextResponse } from "next/server";
import { preparar } from "../../../../../../lib/sara/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Decisão do cartão "Permitir / Não permitir" (E1). Só quem pediu decide; a proposta vale 15 minutos (24 h quando veio de uma guia).
 * Permitir roda a ação com a SESSÃO da pessoa: a função do banco confere a permissão de novo, então a
 * SARA não faz nada que a pessoa não pudesse fazer pela tela. O resultado fica no histórico.
 */
export async function POST(request: Request, context: { params: Promise<{ modulo: string; id: string }> }) {
  const { modulo, id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ação não encontrada." }, { status: 404 });
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { permitir?: boolean } | null;
  if (typeof corpo?.permitir !== "boolean") return NextResponse.json({ error: "Diga se permite ou não." }, { status: 400 });

  const { data, error } = await p.sb.rpc("sara_acao_decidir", { p_id: id, p_permitir: corpo.permitir });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  const d = data as { situacao: string; ferramenta?: string; entrada?: Record<string, unknown> };
  if (d.situacao === "expirada") return NextResponse.json({ situacao: "expirada", texto: "Esta proposta venceu e nada foi feito. Peça de novo à SARA." });
  if (d.situacao === "recusada") return NextResponse.json({ situacao: "recusada", texto: "Tudo bem: nada foi feito." });

  // Permitida: executa com a sessão de quem permitiu. Sem a ferramenta (a permissão mudou), não executa.
  const f = p.ferramentas.find((x) => x.nome === d.ferramenta && x.acao);
  let ok = false, resultado: Record<string, unknown> | null = null, erro: string | null = null, abrir = null;
  if (!f) erro = "Você não tem mais permissão para esta ação.";
  else {
    try {
      const r = await f.rodar(p.sb, d.entrada ?? {});
      ok = true;
      resultado = (r.dados ?? null) as Record<string, unknown> | null;
      abrir = r.abrir ?? null;
    } catch (e) { erro = e instanceof Error ? e.message.slice(0, 300) : "Falhou."; }
  }
  const { error: e2 } = await p.sb.rpc("sara_acao_concluir", { p_id: id, p_ok: ok, p_resultado: resultado, p_erro: erro });
  if (e2) console.error("[sara] não registrou o resultado da ação", e2.message);
  return ok
    ? NextResponse.json({ situacao: "executada", texto: String(resultado?.feito ?? "Feito."), feito: resultado?.feito ?? null, abrir })
    : NextResponse.json({ situacao: "falhou", texto: `Não foi feito: ${erro}`, erro }, { status: 200 });
}
