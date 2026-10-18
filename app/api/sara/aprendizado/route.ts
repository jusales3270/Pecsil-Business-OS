import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { ferramentasDe } from "../../../../lib/sara/ferramentas";
import { analisarConversas } from "../../../../lib/sara/habilidades";
import { SARAS } from "../../../../lib/sara/modulos";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Fundação › O que a SARA aprendeu. GET: uso por módulo, lacunas, respostas ruins e habilidades
 * (proprietário e Auditoria). PATCH: o proprietário ativa/recusa uma habilidade ou dá destino às lacunas.
 * POST { analisar }: o proprietário pede que as perguntas recentes de cada módulo sejam lidas em busca de
 * trabalho repetitivo; as rotinas encontradas viram habilidades PROPOSTAS (só ele ativa).
 */
async function sessao() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  if (!access.isOwner && !access.can("fundacao.auditoria", "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  return { sb: session.supabase, access } as const;
}

export async function GET() {
  const s = await sessao();
  if ("erro" in s) return s.erro;
  const { data, error } = await s.sb.rpc("sara_aprendizado", { p_dias: 90 });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  const rotulos = Object.fromEntries(Object.values(SARAS).map((x) => [x.modulo, x.rotulo]));
  const nomes = Object.fromEntries(Object.values(SARAS).flatMap((x) => ferramentasDe(() => true, x.ferramentas).map((f) => [f.nome, f.rotulo ?? f.nome.replace(/_/g, " ")])));
  return NextResponse.json({ ...(data as object), rotulos, consultas: nomes });
}

export async function PATCH(request: Request) {
  const s = await sessao();
  if ("erro" in s) return s.erro;
  if (!s.access.isOwner) return NextResponse.json({ error: "Decidir é do proprietário." }, { status: 403 });
  const corpo = (await request.json().catch(() => null)) as { habilidade?: { id: string; situacao: string; motivo?: string }; lacunas?: { ids: string[]; destino: string; nota?: string } } | null;
  if (corpo?.habilidade) {
    const { error } = await s.sb.rpc("sara_habilidade_decidir", { p_id: corpo.habilidade.id, p_situacao: corpo.habilidade.situacao, p_motivo: corpo.habilidade.motivo ?? null });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  if (corpo?.lacunas?.ids?.length) {
    const { data, error } = await s.sb.rpc("sara_lacunas_destino", { p_ids: corpo.lacunas.ids.slice(0, 500), p_destino: corpo.lacunas.destino, p_nota: corpo.lacunas.nota ?? null });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, atualizadas: data });
  }
  return NextResponse.json({ error: "Nada para fazer." }, { status: 400 });
}

export async function POST(request: Request) {
  const s = await sessao();
  if ("erro" in s) return s.erro;
  if (!s.access.isOwner) return NextResponse.json({ error: "A análise das conversas é do proprietário." }, { status: 403 });
  const corpo = (await request.json().catch(() => null)) as { analisar?: boolean } | null;
  if (!corpo?.analisar) return NextResponse.json({ error: "Nada para fazer." }, { status: 400 });
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) return NextResponse.json({ error: "Falta a chave do modelo no servidor." }, { status: 503 });
  const { data: org } = await s.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle();
  const empresa = org?.display_name || org?.legal_name || "empresa";
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const resultado: { modulo: string; perguntas: number; propostas: string[]; erro?: string }[] = [];
  let tokens = 0;
  for (const sara of Object.values(SARAS)) {
    const { data } = await s.sb.from("sara_mensagens").select("texto, sara_conversas!inner(modulo)").eq("papel", "pessoa").eq("sara_conversas.modulo", sara.modulo)
      .gte("created_at", desde).order("created_at", { ascending: false }).limit(400);
    const perguntas = ((data ?? []) as { texto: string }[]).map((m) => m.texto);
    if (perguntas.length < 4) { resultado.push({ modulo: sara.modulo, perguntas: perguntas.length, propostas: [] }); continue; }
    try {
      const consultas = ferramentasDe(() => true, sara.ferramentas).map((f) => ({ nome: f.nome, descricao: f.descricao }));
      const r = await analisarConversas({ chave, empresa, rotulo: sara.rotulo, perguntas, ferramentas: consultas });
      tokens += r.tokens;
      const feitas: string[] = [];
      for (const p of r.propostas) {
        const { error } = await s.sb.rpc("sara_habilidade_propor", { p_modulo: sara.modulo, p_nome: p.nome, p_descricao: p.descricao, p_gatilhos: p.gatilhos, p_passos: p.passos,
          p_formato: p.formato, p_origem: "analise", p_evidencia: { vezes: p.vezes ?? 3, exemplos: p.exemplos ?? [] } });
        if (!error) feitas.push(p.nome);
      }
      resultado.push({ modulo: sara.modulo, perguntas: r.usadas, propostas: feitas });
    } catch (e) {
      resultado.push({ modulo: sara.modulo, perguntas: perguntas.length, propostas: [], erro: e instanceof Error ? e.message.slice(0, 160) : "falhou" });
    }
  }
  return NextResponse.json({ resultado, tokens });
}
