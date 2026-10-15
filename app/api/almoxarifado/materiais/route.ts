import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { COLUNAS_MATERIAL, LEITORES_MATERIAIS, normalizarMaterial } from "../../../../lib/almoxarifado/materiais";

export const dynamic = "force-dynamic";

const podeCadastrar = (access: { can: (f: string, n: "operar") => boolean }) => access.can("almoxarifado.materiais", "operar") || access.can("compras.cotacoes", "operar");

/**
 * Almoxarifado › Materiais (docs/PLANO-ALMOXARIFADO.md, M1): busca no catálogo pelo código (com ou sem
 * traço) ou pelo nome sem acento, por família e grupo. Lê quem pede, compra, recebe ou entrega EPI.
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature([...LEITORES_MATERIAIS], "ver");
  if ("error" in guard) return guard.error;
  const p = new URL(request.url).searchParams;
  const limite = Math.min(Math.max(Number(p.get("limite") ?? 100) || 100, 1), 500);
  const grupo = p.get("grupo");
  const [{ data: materiais, error }, { data: grupos }] = await Promise.all([
    guard.supabase.rpc("almoxarifado_materiais_buscar", {
      p_q: (p.get("q") ?? "").slice(0, 80), p_familia: p.get("familia") || null,
      p_group: grupo && /^[0-9a-f-]{36}$/i.test(grupo) ? grupo : null, p_ativos: p.get("inativos") !== "1", p_limite: limite + 1,
    }).select(COLUNAS_MATERIAL),
    guard.supabase.from("material_groups").select("id, prefixo, codigo, nome, familia, proximo, controla_estoque").order("prefixo").order("codigo"),
  ]);
  if (error) return dbError(error);
  const lista = Array.isArray(materiais) ? materiais : [];
  return NextResponse.json({
    materiais: lista.slice(0, limite), temMais: lista.length > limite, grupos: grupos ?? [],
    podeOperar: podeCadastrar(guard.access),
  });
}

/** Material novo: sem código, o próximo do grupo (continua a numeração do GRV). */
export async function POST(request: Request) {
  const guard = await requireAnyFeature([...LEITORES_MATERIAIS], "ver");
  if ("error" in guard) return guard.error;
  if (!podeCadastrar(guard.access)) return NextResponse.json({ error: "Sem permissão para cadastrar materiais." }, { status: 403 });
  const { material, erros } = normalizarMaterial(await request.json().catch(() => null));
  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  let codigo = material.codigo;
  if (!codigo) {
    if (!material.group_id) return NextResponse.json({ error: "Informe o código ou escolha o grupo para gerar o próximo." }, { status: 400 });
    const { data, error } = await guard.supabase.rpc("almoxarifado_material_proximo_codigo", { p_group: material.group_id });
    if (error) return dbError(error);
    codigo = String(data);
  }
  const [{ data: org }, { data: perfil }] = await Promise.all([guard.supabase.rpc("current_organization_id"), guard.supabase.rpc("current_profile_id")]);
  const { data: autor } = await guard.supabase.from("profiles").select("full_name, email").eq("id", perfil).maybeSingle();
  const pendencias = [!material.ncm && "sem_ncm", !material.plano_contas && "sem_plano"].filter(Boolean);
  const { data, error } = await guard.supabase.from("materials").insert({
    ...material, codigo, organization_id: org, origem: "plataforma", pendencias,
    created_by: perfil, created_by_name: autor?.full_name || autor?.email || null,
  }).select("id, codigo").single();
  if (error) return error.code === "23505" ? NextResponse.json({ error: `Já existe um material com o código ${codigo}.` }, { status: 409 }) : dbError(error);
  return NextResponse.json(data);
}
