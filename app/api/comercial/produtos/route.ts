import { NextResponse } from "next/server";
import { dbError, requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { normalizarProduto } from "../../../../lib/comercial/vendas";

export const dynamic = "force-dynamic";

const POR_PAGINA = 1000;
const MAXIMO = 50000;
const COLUNAS = "id, codigo, descricao, group_id, customer_id, tipo_peca, unidade, ncm, origem, material, desenho_codigo, desenho_revisao, nome_cliente, peso_liquido, observacoes, ativo, cloned_from, created_by_name, created_at, updated_at";

/**
 * Comercial › Produtos (o "material" do GRV): código interno, NCM, desenho e material. Leem quem
 * cuida de produtos e orçamentos, quem dá entrada de produção e quem fatura; operar cadastra.
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["comercial.produtos", "comercial.orcamentos", "producao.entrada", "fiscal.nfe"], "ver");
  if ("error" in guard) return guard.error;
  const p = new URL(request.url).searchParams;
  const termo = (p.get("q") ?? "").trim().replace(/[%,()]/g, " ").slice(0, 80);
  const cliente = p.get("cliente");
  // O catálogo vem da Forja (milhares de peças) e o banco entrega no máximo 1000 linhas por vez:
  // lê em páginas para a busca do orçamento enxergar todas.
  const pagina = (de: number) => {
    let consulta = guard.supabase.from("products").select(COLUNAS).order("codigo").order("id").range(de, de + POR_PAGINA - 1);
    if (termo) consulta = consulta.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%,desenho_codigo.ilike.%${termo}%`);
    if (p.get("ativos") === "1") consulta = consulta.eq("ativo", true);
    if (cliente && /^[0-9a-f-]{36}$/i.test(cliente)) consulta = consulta.eq("customer_id", cliente);
    return consulta;
  };
  const todos = async () => {
    const lista: Record<string, unknown>[] = [];
    for (let de = 0; de < MAXIMO; de += POR_PAGINA) {
      const { data, error } = await pagina(de);
      if (error) return { data: null, error };
      lista.push(...(data ?? []));
      if ((data ?? []).length < POR_PAGINA) break;
    }
    return { data: lista, error: null };
  };
  const [{ data: produtos, error }, { data: grupos }, { data: clientes }] = await Promise.all([
    todos(),
    guard.supabase.from("product_groups").select("id, codigo, nome, prefixo, proximo").order("codigo"),
    guard.supabase.from("customers").select("id, name, uf, ind_ie").eq("active", true).is("merged_into", null).order("name").limit(1000),
  ]);
  if (error) return dbError(error);
  return NextResponse.json({
    produtos: produtos ?? [], grupos: grupos ?? [], clientes: clientes ?? [],
    podeOperar: guard.access.can("comercial.produtos", "operar"),
  });
}

/** Novo produto. Sem código, o próximo do grupo (formato do GRV: 5-24-00040). */
export async function POST(request: Request) {
  const guard = await requireFeature("comercial.produtos", "operar");
  if ("error" in guard) return guard.error;
  const { produto, erros } = normalizarProduto(await request.json().catch(() => null));
  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  let codigo = produto.codigo;
  if (!codigo) {
    if (!produto.group_id) return NextResponse.json({ error: "Informe o código interno ou escolha o grupo para gerar o próximo." }, { status: 400 });
    const { data, error } = await guard.supabase.rpc("product_proximo_codigo", { p_group: produto.group_id });
    if (error) return dbError(error);
    codigo = String(data);
  }
  const [{ data: org }, { data: perfil }] = await Promise.all([guard.supabase.rpc("current_organization_id"), guard.supabase.rpc("current_profile_id")]);
  const { data: autor } = await guard.supabase.from("profiles").select("full_name, email").eq("id", perfil).maybeSingle();
  const { data, error } = await guard.supabase.from("products").insert({
    ...produto, codigo, organization_id: org, created_by: perfil, created_by_name: autor?.full_name || autor?.email || null,
  }).select("id, codigo").single();
  if (error) return error.code === "23505" ? NextResponse.json({ error: `Já existe um produto com o código ${codigo}.` }, { status: 409 }) : dbError(error);
  return NextResponse.json(data);
}
