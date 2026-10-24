import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { chaveConfigurada } from "../../../../lib/sara/claude";
import { agoraSP, saudacao } from "../../../../lib/sara/tempo";
import { ACOES } from "../../../../lib/sara/acoes";
import { comProgresso } from "../../../../lib/sara/progresso";
import { parametrosUsados, type Usada } from "../../../../lib/sara/parametros";
import { preparar } from "../../../../lib/sara/sessao";
import { temaDe } from "../../../../lib/sara/temas";
import { tratamento } from "../../../../lib/sara/personalidade";
import { cartao, COLUNAS_ACAO, responder, rotulosDe, TABELAS, type Corpo, type LinhaAcao } from "../../../../lib/sara/responder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;
/**
 * SARA de um módulo (I-12, nível 1: orienta e consulta). GET: situação (configurada, ferramentas que
 * a pessoa tem, sugestões). POST: uma pergunta. PATCH: a nota de uma resposta. A pessoa precisa ter
 * acesso ao módulo e a SARA liberada para ela em Pessoas e Acessos (`<modulo>.sara`); as ferramentas oferecidas à SARA são só as que ela pode usar (inclusive de outros
 * módulos), e cada consulta roda com a sessão dela.
 *
 * Guarda de escopo: a SARA só trata da empresa e da rotina de quem pergunta. A regra fixa vai no prompt
 * e um verificador separado classifica a pergunta em paralelo; se ele der FORA, a conversa é cancelada
 * e a resposta é a recusa padrão (registrada na conversa, para auditoria).
 */
type LinhaMensagem = { id: string; papel: "pessoa" | "sara"; texto: string; created_at: string; nota: number | null; ferramentas: Record<string, unknown> | null };

/** A última conversa da pessoa neste módulo, para a janela abrir na última interação. */

async function ultimaConversa(sb: SupabaseClient, modulo: string, eu: string | null, rotulos: Record<string, string> = {}) {
  if (!eu) return null;
  const { data: conv } = await sb.from("sara_conversas").select("id, updated_at").eq("modulo", modulo).eq("profile_id", eu).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conv) return null;
  // As 40 mais recentes, na ordem da conversa (no empate de horário, a pergunta antes da resposta).
  const { data } = await sb.from("sara_mensagens").select("id, papel, texto, created_at, nota, ferramentas").eq("conversa_id", conv.id)
    .order("created_at", { ascending: false }).order("papel", { ascending: false }).limit(40);
  const { data: acoes } = await sb.from("sara_acoes").select(COLUNAS_ACAO).eq("conversa_id", conv.id).order("created_at");
  const acoesDe = (id: string) => ((acoes ?? []) as LinhaAcao[]).filter((a) => a.mensagem_id === id).map(cartao);
  const mensagens = ((data ?? []) as LinhaMensagem[]).reverse().map((m) => {
    const f = (m.ferramentas ?? {}) as { usadas?: Usada[]; fontes?: unknown[]; abriu?: unknown; escopo?: { fora?: string | null }; visuais?: unknown[]; documentos?: unknown[] };
    return { id: m.id, papel: m.papel, texto: m.texto, quando: m.created_at, nota: m.nota, consultas: (f.usadas ?? []).map((u) => u.nome), fontes: f.fontes ?? [], abrir: f.abriu ?? null, fora: Boolean(f.escopo?.fora), visuais: f.visuais ?? [], acoes: acoesDe(m.id), documentos: f.documentos ?? [],
      parametros: m.papel === "sara" ? parametrosUsados(f.usadas ?? [], rotulos, new Set(ACOES.map((x) => x.nome)), TABELAS) : [] };
  });
  return { id: conv.id, mensagens };
}

export async function GET(_request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const eu = (await p.sb.rpc("current_profile_id")).data as string | null;
  const [{ data: me }, conversa] = await Promise.all([
    eu ? p.sb.from("profiles").select("full_name").eq("id", eu).maybeSingle() : Promise.resolve({ data: null }),
    ultimaConversa(p.sb, modulo, eu, rotulosDe(p.ferramentas)),
  ]);
  return NextResponse.json({
    // Na apresentação, só as consultas do próprio módulo (as dos outros módulos e a pesquisa vão numa frase).
    nome: p.sara.nome, configurada: chaveConfigurada(), sugestoes: p.sara.sugestoes,
    ferramentas: p.ferramentas.filter((f) => p.sara.ferramentas.includes(f.nome) || ["abrir_tela", "abrir_lancamento"].includes(f.nome)).map((f) => f.nome),
    alcance: { outrosModulos: p.ferramentas.some((f) => !p.sara.ferramentas.includes(f.nome) && f.exige.length > 0), dados: p.ferramentas.some((f) => f.nome === "consultar_dados"), pesquisa: Boolean(temaDe(modulo)) },
    // Como cada consulta aparece para quem usa.
    rotulos: Object.fromEntries(p.ferramentas.filter((f) => f.rotulo).map((f) => [f.nome, f.rotulo])),
    // Atalhos das habilidades aprovadas (o primeiro jeito de pedir vira o texto da pergunta).
    habilidades: p.habilidades.map((h) => ({ id: h.id, nome: h.nome, pedido: h.gatilhos[0] ?? h.nome })),
    // Cumprimento pelo relógio do servidor, no fuso de São Paulo, com o nome de quem está logado.
    // Tratamento pelo sistema (o fundador verificado é "Senhor"), nunca pelo que se diz na conversa.
    pessoa: tratamento({ nome: me?.full_name, fundador: p.access.isOwner, verificado: true }), saudacao: saudacao(agoraSP().hora24), conversa,
  });
}

export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as Corpo | null;
  if (!corpo?.progresso) return responder(p, modulo, corpo);
  // Passos ao vivo (24/10): cada linha é { tipo: "passo", passo } e a última é { tipo: "fim", status, corpo },
  // com a mesma resposta de sempre. "vivo" a cada 10 s mantém a conexão aberta numa consulta longa.
  // no-transform: a compressão do servidor não segura as linhas até o fim.
  const enc = new TextEncoder();
  const fluxo = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let aberto = true;
      const linha = (o: unknown) => { if (aberto) { try { ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { aberto = false; } } };
      const vivo = setInterval(() => linha({ tipo: "vivo" }), 10_000);
      void comProgresso((passo) => linha({ tipo: "passo", passo }), () => responder(p, modulo, corpo))
        .then(async (res) => linha({ tipo: "fim", status: res.status, corpo: await res.json().catch(() => null) }))
        .catch((e) => { console.error("[sara] falha no fluxo", e instanceof Error ? e.message.slice(0, 200) : e); linha({ tipo: "fim", status: 503, corpo: { error: "A SARA está indisponível agora. Tente de novo em instantes." } }); })
        .finally(() => { clearInterval(vivo); if (aberto) { aberto = false; ctrl.close(); } });
    },
  });
  return new Response(fluxo, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}


export async function PATCH(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { mensagem?: string; nota?: number } | null;
  if (corpo?.mensagem && UUID.test(corpo.mensagem) && corpo.nota) {
    const { error } = await p.sb.rpc("sara_avaliar", { p_mensagem: corpo.mensagem, p_nota: Math.round(corpo.nota) });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Nada para fazer." }, { status: 400 });
}
