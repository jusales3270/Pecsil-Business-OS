import { NextResponse } from "next/server";
import { alertasDo } from "../../../../../lib/sara/alertas";
import { preparar } from "../../../../../lib/sara/sessao";
import { agoraSP } from "../../../../../lib/sara/tempo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Degrau 3: a pessoa tocou na ação pronta de um aviso ("Refazer o pedido"). O aviso é recalculado aqui,
 * com a sessão dela (a tela manda só a chave), a SARA prepara o cartão e grava a proposta pendente
 * (15 min). Nada é feito: quem decide é a pessoa, no Permitir / Não permitir. Sem chamar o modelo.
 */
export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { chave?: string } | null;
  const chave = String(corpo?.chave ?? "");
  if (!chave.startsWith(`${modulo}.`)) return NextResponse.json({ error: "Aviso não encontrado." }, { status: 404 });

  const alertas = await alertasDo(modulo, p.sb, { pode: (f) => p.access.can(f, "ver"), hoje: agoraSP().dia });
  const propor = alertas.find((a) => a.chave === chave)?.propor;
  if (!propor) return NextResponse.json({ error: "Este aviso não está mais valendo. Atualize a janela." }, { status: 404 });
  const f = p.ferramentas.find((x) => x.nome === propor.ferramenta && x.acao);
  if (!f?.acao) return NextResponse.json({ error: "Você não tem permissão para esta ação." }, { status: 403 });

  const prop = await f.acao.preparar(p.sb, propor.entrada).catch((e) => ({ erro: e instanceof Error ? e.message : "Não consegui preparar." }));
  if ("erro" in prop) return NextResponse.json({ error: prop.erro }, { status: 400 });
  const { data: id, error } = await p.sb.rpc("sara_acao_propor", { p_conversa: null, p_mensagem: null, p_modulo: modulo, p_ferramenta: f.nome,
    p_entrada: propor.entrada, p_resumo: prop.resumo, p_detalhes: prop.detalhes, p_risco: prop.risco ?? "normal" });
  if (error || !id) return NextResponse.json({ error: error?.message ?? "Não consegui registrar a proposta." }, { status: 400 });
  return NextResponse.json({ cartao: { id, resumo: prop.resumo, detalhes: prop.detalhes, risco: prop.risco ?? "normal", situacao: "pendente", feito: null, erro: null,
    expiraEm: new Date(Date.now() + 15 * 60_000).toISOString() } });
}
