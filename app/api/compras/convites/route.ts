import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Endereço público da plataforma, como o fornecedor vai abrir (atrás do proxy, pelos cabeçalhos). */
function base(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(request.url).host;
  const proto = h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * Compras › convites de cotação por link (A-09). Ler: quem vê cotações. Criar e cancelar: quem lança
 * cotações. O link só existe na resposta da criação: o banco guarda apenas o hash.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("compras.cotacoes");
  if ("error" in guard) return guard.error;
  const pedidos = (new URL(request.url).searchParams.get("pedidos") ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 300);
  if (!pedidos.length) return NextResponse.json({ convites: [] });
  const { data, error } = await guard.supabase.from("compras_convites")
    .select("id, material_request_id, ramo_id, fornecedor, situacao, expira_em, cotacao_id, respondido_em, aberto_em, criado_por_nome, created_at")
    .in("material_request_id", pedidos).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Não foi possível carregar os convites." }, { status: 500 });
  return NextResponse.json({ convites: data ?? [] });
}

type Acao = { acao: "criar"; pedido: string; fornecedorId?: string | null; fornecedor?: string; dias?: number; ramo?: string | null } | { acao: "cancelar"; id: string };

export async function POST(request: Request) {
  const guard = await requireFeature("compras.cotacoes", "operar");
  if ("error" in guard) return guard.error;
  const a = (await request.json().catch(() => null)) as Acao | null;
  if (a?.acao === "criar") {
    if (!UUID.test(a.pedido)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    const { data, error } = await guard.supabase.rpc("compras_convite_criar", {
      p_pedido: a.pedido, p_supplier: a.fornecedorId && UUID.test(a.fornecedorId) ? a.fornecedorId : null,
      p_fornecedor: String(a.fornecedor ?? "").slice(0, 200), p_dias: Number.isInteger(a.dias) ? a.dias : 7,
      p_ramo: a.ramo && UUID.test(a.ramo) ? a.ramo : null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
    const r = data as { id: string; codigo: string; expira_em: string; fornecedor: string };
    return NextResponse.json({ id: r.id, fornecedor: r.fornecedor, expiraEm: r.expira_em, link: `${base(request)}/cotar/${r.codigo}` });
  }
  if (a?.acao === "cancelar") {
    if (!UUID.test(a.id)) return NextResponse.json({ error: "Convite inválido." }, { status: 400 });
    const { error } = await guard.supabase.rpc("compras_convite_cancelar", { p_id: a.id });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
