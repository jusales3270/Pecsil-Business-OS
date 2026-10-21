import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { agruparPorPeca, termoDeBusca, TIPOS_DESENHO, type DesenhoLinha, type VersaoLinha } from "../../../../lib/fundicao/biblioteca-regras";

export const dynamic = "force-dynamic";

const LIMITE = 200;
const COLUNAS = "id, origem, artigo_codigo, artigo_chave, artigo_descricao, cliente_nome, tipo, codigo, revisao, data_revisao, observacoes, fundicao_prevista, primeira_fundicao_em, ultima_fundicao_em, os_codigos, removido_na_forja_em, enviado_por, enviado_por_nome, created_at";

/**
 * Biblioteca da Fundição: desenhos por peça, com as versões do arquivo e as anotações.
 * Filtros: q (peça, descrição, cliente, código do desenho), fundicao (fundidas | previstas | sem),
 * tipo, origem (forja | acervo) e removidos=1. Tudo com a sessão de quem pede (RLS).
 */
export async function GET(request: Request) {
  const guard = await requireFeature("fundicao.biblioteca", "ver");
  if ("error" in guard) return guard.error;
  const { supabase } = guard;
  const p = new URL(request.url).searchParams;

  let consulta = supabase.from("fundicao_desenhos").select(COLUNAS);
  const termo = termoDeBusca(p.get("q"));
  if (termo) consulta = consulta.or(["artigo_codigo", "artigo_descricao", "cliente_nome", "codigo"].map((c) => `${c}.ilike.%${termo}%`).join(","));
  const fundicao = p.get("fundicao");
  if (fundicao === "fundidas") consulta = consulta.not("ultima_fundicao_em", "is", null);
  else if (fundicao === "previstas") consulta = consulta.eq("fundicao_prevista", true).is("ultima_fundicao_em", null);
  else if (fundicao === "sem") consulta = consulta.eq("fundicao_prevista", false).is("ultima_fundicao_em", null);
  const tipo = p.get("tipo");
  if (tipo && tipo in TIPOS_DESENHO) consulta = consulta.eq("tipo", tipo);
  const origem = p.get("origem");
  if (origem === "forja" || origem === "acervo") consulta = consulta.eq("origem", origem);
  if (p.get("removidos") !== "1") consulta = consulta.is("removido_na_forja_em", null);

  const { data, error } = await consulta.order("artigo_chave").order("tipo").order("codigo").order("revisao", { ascending: false }).limit(LIMITE + 1);
  if (error) {
    console.error("Falha ao ler a Biblioteca da Fundição", error);
    return NextResponse.json({ error: "BIBLIOTECA_UNAVAILABLE" }, { status: 503 });
  }
  const mais = (data ?? []).length > LIMITE;
  const desenhos = (data ?? []).slice(0, LIMITE) as DesenhoLinha[];

  const ids = desenhos.map((d) => d.id);
  const chaves = [...new Set(desenhos.map((d) => d.artigo_chave))];
  const versoes: VersaoLinha[] = [];
  const notas: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await supabase.from("fundicao_desenho_arquivos").select("id, desenho_id, mime, tamanho, nome, recebido_em, substituido_em").in("desenho_id", ids.slice(i, i + 100));
    if (r.error) return NextResponse.json({ error: "BIBLIOTECA_UNAVAILABLE" }, { status: 503 });
    versoes.push(...((r.data ?? []) as VersaoLinha[]));
  }
  for (let i = 0; i < chaves.length; i += 100) {
    const r = await supabase.from("fundicao_notas").select("id, artigo_chave, texto, autor_id, autor_nome, created_at, updated_at").in("artigo_chave", chaves.slice(i, i + 100)).order("created_at", { ascending: false });
    if (r.error) return NextResponse.json({ error: "BIBLIOTECA_UNAVAILABLE" }, { status: 503 });
    notas.push(...(r.data ?? []));
  }

  const [total, fundidas, acervo] = await Promise.all([
    supabase.from("fundicao_desenhos").select("id", { count: "exact", head: true }).is("removido_na_forja_em", null),
    supabase.from("fundicao_desenhos").select("id", { count: "exact", head: true }).is("removido_na_forja_em", null).not("ultima_fundicao_em", "is", null),
    supabase.from("fundicao_desenhos").select("id", { count: "exact", head: true }).eq("origem", "acervo"),
  ]);
  const { data: eu } = await supabase.rpc("current_profile_id");

  const response = NextResponse.json({
    podeOperar: guard.access.can("fundicao.biblioteca", "operar"),
    eu: eu ?? null,
    pecas: agruparPorPeca(desenhos, versoes),
    notas,
    mais,
    resumo: { desenhos: total.count ?? 0, fundidos: fundidas.count ?? 0, acervo: acervo.count ?? 0 },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
