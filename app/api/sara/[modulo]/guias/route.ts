import { NextResponse } from "next/server";
import { EVENT_CATALOG } from "../../../../../modules/event-catalog";
import { ACOES } from "../../../../../lib/sara/acoes";
import { ROTULO_DAS_ACOES } from "../../../../../lib/sara/acoes-areas";
import { FERRAMENTAS } from "../../../../../lib/sara/ferramentas";
import { descreverGatilho, limparLimites, type Gatilho, type Limites } from "../../../../../lib/sara/guias";
import type { Passo } from "../../../../../lib/sara/habilidades";
import { preparar } from "../../../../../lib/sara/sessao";
import { PODE_PELO_WHATSAPP } from "../../../../../lib/whatsapp/confirmar-regras";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;
/** Nome das ações para o quadro de limites ("pedir material"). */
const ACAO_ROTULO: Record<string, string> = { pedir_material: "Pedir material ao Compras", pedir_material_fundicao: "Pedir material ao Compras", abrir_chamado_ti: "Abrir chamado de TI", anotar_na_biblioteca: "Anotar na Biblioteca", ...ROTULO_DAS_ACOES };
const rotuloEvento = (t: string) => EVENT_CATALOG.find((e) => e.type === t)?.label;

type LinhaGuia = { id: string; nome: string; descricao: string; passos: Passo[]; formato: string | null; gatilho: Gatilho; situacao: string; pausada: boolean; limites: Limites;
  responsavel: string | null; minha: boolean; criada_em: string; decidido_por: string | null; decidido_em: string | null; motivo: string | null; proxima_em: string | null;
  ultima_execucao: string | null; execucoes: unknown[] };

/**
 * Guias da SARA do módulo (E3). GET: as guias que a pessoa vê (quem aprova vê todas as do módulo; os
 * outros, só as suas), com o gatilho em português e as ações de cada uma (para o quadro de limites).
 * POST: decidir (aprovar, recusar, arquivar e os limites — quem responde pela área), pausar/retomar
 * (quem criou ou quem aprova) e rodar agora (quem criou). O banco confere cada permissão.
 * Junto, o quadro "Confirmar pelo WhatsApp" das ações que são desta área (PLANO-WHATSAPP §5): quem aprova liga cada
 * uma com o limite por pessoa por dia; os outros só leem.
 */
export async function GET(_request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const { data, error } = await p.sb.rpc("sara_guias", { p_modulo: modulo });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  const d = data as { pode_aprovar: boolean; guias: LinhaGuia[] };
  // Nome de cada passo para quem lê (também para quem aprova e não tem a consulta): ação pelo verbo, consulta pelo nome.
  const rotulos: Record<string, string> = Object.fromEntries([...FERRAMENTAS, ...p.ferramentas].filter((f) => !f.acao && f.rotulo).map((f) => [f.nome, f.rotulo as string]));
  Object.assign(rotulos, ACAO_ROTULO);
  const doModulo = Object.entries(PODE_PELO_WHATSAPP).filter(([, x]) => x.modulo === modulo);
  const { data: liberadas } = doModulo.length
    ? await p.sb.from("sara_whatsapp_confirmar").select("ferramenta, ate_por_dia, liberado_por_nome, updated_at").in("ferramenta", doModulo.map(([n]) => n))
    : { data: [] };
  const porNome = new Map(((liberadas ?? []) as { ferramenta: string; ate_por_dia: number; liberado_por_nome: string | null; updated_at: string }[]).map((x) => [x.ferramenta, x]));
  return NextResponse.json({
    podeAprovar: d.pode_aprovar,
    whatsapp: doModulo.map(([nome, x]) => ({ nome, rotulo: x.rotulo, ate: porNome.get(nome)?.ate_por_dia ?? null, por: porNome.get(nome)?.liberado_por_nome ?? null, em: porNome.get(nome)?.updated_at ?? null })),
    guias: d.guias.map((g) => ({
      ...g, quando: descreverGatilho(g.gatilho, rotuloEvento),
      passos: g.passos.map((x) => ({ ...x, rotulo: rotulos[x.ferramenta] ?? x.ferramenta.replace(/_/g, " ") })),
      acoes: [...new Set(g.passos.map((x) => x.ferramenta).filter((n) => ACOES.some((a) => a.nome === n)))].map((n) => ({ nome: n, rotulo: ACAO_ROTULO[n] ?? n.replace(/_/g, " "), soComPessoa: ACOES.find((a) => a.nome === n)?.acao?.soComPessoa === true })),
    })),
  });
}

export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { acao?: string; id?: string; situacao?: string; limites?: unknown; motivo?: string; pausada?: boolean; ferramenta?: string; ate?: unknown } | null;
  if (corpo?.acao === "whatsapp") {
    // Ligar (1 a 20 por dia) ou desligar (0) uma ação desta área para confirmar pela enquete do WhatsApp.
    const f = String(corpo.ferramenta ?? "");
    if (PODE_PELO_WHATSAPP[f]?.modulo !== modulo) return NextResponse.json({ error: "Esta ação não é desta área." }, { status: 400 });
    const ate = Math.round(Number(corpo.ate ?? 0));
    if (!Number.isFinite(ate) || ate < 0 || ate > 20) return NextResponse.json({ error: "O limite vai de 1 a 20 por dia." }, { status: 400 });
    const { error } = await p.sb.rpc("sara_whatsapp_confirmar_salvar", { p_ferramenta: f, p_ate: ate });
    return error ? NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 }) : NextResponse.json({ ok: true });
  }
  const id = String(corpo?.id ?? "");
  if (!UUID.test(id)) return NextResponse.json({ error: "Guia não encontrada." }, { status: 404 });
  const erro = (e: { message: string; code?: string }) => NextResponse.json({ error: e.message }, { status: e.code === "42501" ? 403 : 400 });
  if (corpo?.acao === "decidir") {
    if (!["ativa", "recusada", "arquivada"].includes(String(corpo.situacao))) return NextResponse.json({ error: "Diga se aprova, recusa ou arquiva." }, { status: 400 });
    const limites = corpo.limites === undefined ? null : limparLimites(corpo.limites, ACOES.map((a) => a.nome));
    const { error } = await p.sb.rpc("sara_guia_decidir", { p_id: id, p_situacao: corpo.situacao, p_limites: limites, p_motivo: corpo.motivo ? String(corpo.motivo).slice(0, 500) : null });
    return error ? erro(error) : NextResponse.json({ ok: true });
  }
  if (corpo?.acao === "pausar") {
    const { error } = await p.sb.rpc("sara_guia_pausar", { p_id: id, p_pausada: corpo.pausada !== false });
    return error ? erro(error) : NextResponse.json({ ok: true });
  }
  if (corpo?.acao === "rodar") {
    const { error } = await p.sb.rpc("sara_guia_rodar", { p_id: id });
    return error ? erro(error) : NextResponse.json({ ok: true, texto: "A guia entrou na fila e roda em até 10 minutos. O resultado chega no sino." });
  }
  return NextResponse.json({ error: "Nada para fazer." }, { status: 400 });
}
