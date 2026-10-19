import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Segundo Cérebro (War Room › Segundo Cérebro, docs/PLANO-WAR-ROOM-CEREBRO.md). Todas as consultas
 * rodam com a sessão de quem pergunta: o RLS do grafo exige `warroom.cerebro` (W2: quem tem vê tudo).
 */
const UUID = /^[0-9a-f-]{36}$/i;
const lista = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter((x) => /^[a-z_]{2,30}$/.test(x)) : null);
const data = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const inteiro = (v: string | null, padrao: number) => (v && /^\d+$/.test(v) ? Number(v) : padrao);

export async function GET(request: Request) {
  const guard = await requireFeature("warroom.cerebro", "ver");
  if ("error" in guard) return guard.error;
  const q = new URL(request.url).searchParams;
  const sb = guard.supabase;
  const acao = q.get("acao") ?? "visao";
  const id = (k: string) => { const v = q.get(k); return v && UUID.test(v) ? v : null; };
  let r;
  switch (acao) {
    case "visao":
      r = await sb.rpc("cerebro_visao", { p_tipos: lista(q.get("tipos")), p_min_grau: inteiro(q.get("min_grau"), 1), p_limite: inteiro(q.get("limite"), 6000) });
      break;
    case "buscar":
      r = await sb.rpc("cerebro_buscar", { p_termo: (q.get("termo") ?? "").slice(0, 100), p_tipos: lista(q.get("tipos")), p_limite: inteiro(q.get("limite"), 20) });
      break;
    case "vizinhanca":
      if (!id("no")) return NextResponse.json({ error: "Escolha um nó." }, { status: 400 });
      r = await sb.rpc("cerebro_vizinhanca", { p_no: id("no"), p_profundidade: inteiro(q.get("profundidade"), 1), p_tipos_no: lista(q.get("tipos")),
        p_tipos_ligacao: lista(q.get("ligacoes")), p_familias: lista(q.get("familias")), p_desde: data(q.get("desde")), p_limite: inteiro(q.get("limite"), 600) });
      break;
    case "caminho":
      if (!id("de") || !id("para")) return NextResponse.json({ error: "Escolha os dois nós." }, { status: 400 });
      r = await sb.rpc("cerebro_caminho", { p_de: id("de"), p_para: id("para"), p_max: inteiro(q.get("max"), 4) });
      break;
    case "dependencias":
      if (!id("no")) return NextResponse.json({ error: "Escolha um nó." }, { status: 400 });
      r = await sb.rpc("cerebro_dependencias", { p_no: id("no"), p_sentido: q.get("sentido") === "montante" ? "montante" : "jusante", p_profundidade: inteiro(q.get("profundidade"), 3) });
      break;
    case "expandir":
      if (!id("ligacao")) return NextResponse.json({ error: "Escolha uma ligação." }, { status: 400 });
      r = await sb.rpc("cerebro_expandir", { p_ligacao: id("ligacao") });
      break;
    case "situacao": {
      const [ex, visoes] = await Promise.all([
        sb.from("cerebro_execucoes").select("inicio, fim, ms, nos, ligacoes, erro").order("inicio", { ascending: false }).limit(1).maybeSingle(),
        sb.from("cerebro_visoes").select("id, nome, filtros, criado_por_nome, updated_at").order("nome"),
      ]);
      if (ex.error) return NextResponse.json({ error: "CEREBRO_UNAVAILABLE" }, { status: 503 });
      // Sem as visões (tabela ainda não criada ou falha), o resto da situação continua valendo.
      if (visoes.error) console.error("Cérebro: visões salvas indisponíveis", visoes.error.message);
      return NextResponse.json({ ultima: ex.data, visoes: visoes.error ? [] : visoes.data ?? [], visoesDisponiveis: !visoes.error, podeRefazer: guard.access.isOwner });
    }
    default:
      return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }
  if (r.error) {
    console.error("Cérebro: falha na consulta", acao, r.error);
    return NextResponse.json({ error: r.error.code === "42501" ? r.error.message : "Não foi possível consultar o grafo." }, { status: r.error.code === "42501" ? 403 : 400 });
  }
  return NextResponse.json(r.data);
}

/** Refazer o grafo (proprietário), salvar e apagar visões. */
export async function POST(request: Request) {
  const guard = await requireFeature("warroom.cerebro", "ver");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as { acao?: string; nome?: string; filtros?: Record<string, unknown>; id?: string };
  let r;
  if (b.acao === "refazer") r = await guard.supabase.rpc("cerebro_refazer");
  else if (b.acao === "salvar_visao") r = await guard.supabase.rpc("cerebro_salvar_visao", { p_nome: String(b.nome ?? ""), p_filtros: b.filtros ?? {} });
  else if (b.acao === "apagar_visao" && b.id && UUID.test(b.id)) r = await guard.supabase.rpc("cerebro_apagar_visao", { p_id: b.id });
  else return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  if (r.error) {
    const claro = r.error.code === "P0001" || r.error.code === "42501";
    return NextResponse.json({ error: claro ? r.error.message : "Não foi possível concluir." }, { status: r.error.code === "42501" ? 403 : 400 });
  }
  return NextResponse.json(r.data ?? { ok: true });
}
