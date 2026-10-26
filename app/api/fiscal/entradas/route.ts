import { NextResponse } from "next/server";
import { dbError, requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { classificar, type Achado, type ItemEntrada, type NotaEntrada } from "../../../../lib/fiscal/entradas/checagem";
import { sincronizarEntradas } from "../../../../lib/fiscal/entradas/servidor";
import { autorDaSessao } from "../../../../lib/fiscal/emissao/servidor";
import { semRepetidas } from "../../../../lib/fiscal/ibs-cbs/leitura";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › Conferência de entradas (N-09): as notas recebidas do mês, o que não confere em cada uma e a
 * classificação proposta de cada item (calculada agora, com as dicas de hoje: cadastro de materiais e Painel do
 * ICMS). Quem opera o ICMS confirma; a confirmação fica gravada com auditoria.
 */
const LEITURA = ["fiscal.icms", "fiscal.config", "fiscal.parametros", "fiscal.nfe", "fiscal.escritorio", "fiscal.portal"] as const;

type Linha = { id: string; chave: string | null; numero: string | null; emissao: string | null; competencia: string | null; finalidade: string | null; emitente_cnpj: string | null; emitente_nome: string | null; emitente_uf: string | null; emitente_crt: number | null; v_nf: number; itens: ItemEntrada[]; achados: Achado[]; situacao: string; classificacao: { nItem: number; tipo: string; cfopEntrada: string }[]; conferida: boolean; conferida_por_nome: string | null; conferida_em: string | null };

export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem empresa." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  let sinc: { lidas: number; aviso: string | null };
  try { sinc = await sincronizarEntradas(admin, autor.org); } catch (e) { sinc = { lidas: 0, aviso: `Não foi possível ler as notas novas agora (${e instanceof Error ? e.message.slice(0, 120) : "erro"}).` }; }
  const [{ data, error }, { data: cfg }, { data: painel }] = await Promise.all([
    guard.supabase.from("fiscal_entradas").select("id, chave, numero, emissao, competencia, finalidade, emitente_cnpj, emitente_nome, emitente_uf, emitente_crt, v_nf, itens, achados, situacao, classificacao, conferida, conferida_por_nome, conferida_em")
      .neq("situacao", "fora").not("competencia", "is", null).order("emissao", { ascending: true }).order("lido_em", { ascending: true }).limit(3000),
    admin.from("fiscal_config").select("uf").eq("organization_id", autor.org).maybeSingle(),
    // Dicas para a proposta: a classificação da nota no Painel do ICMS e o código do fornecedor ligado ao material.
    admin.from("fiscal_icms_entries").select("chave, tipo").eq("organization_id", autor.org).not("chave", "is", null),
  ]);
  if (error) return dbError(error);
  const { notas, repetidas } = semRepetidas((data ?? []) as Linha[]);
  const cnpjs = [...new Set(notas.map((n) => (n.emitente_cnpj ?? "").replace(/\D/g, "")).filter(Boolean))];
  const { data: codigos } = cnpjs.length ? await admin.from("material_codigos_fornecedor").select("cnpj, codigo_fornecedor, material:materials(tipo_item)").eq("organization_id", autor.org).in("cnpj", cnpjs) : { data: [] };
  const tipoMaterial = new Map(((codigos ?? []) as unknown as { cnpj: string; codigo_fornecedor: string; material: { tipo_item: string | null } | null }[])
    .filter((c) => c.material?.tipo_item).map((c) => [`${c.cnpj}|${c.codigo_fornecedor}`, c.material!.tipo_item!.slice(0, 2)]));
  const tipoPainel = new Map(((painel ?? []) as { chave: string; tipo: string | null }[]).map((p) => [p.chave, p.tipo]));
  const uf = String(cfg?.uf ?? "");
  const saida = notas.reverse().map((n) => {
    const nota = { finalidade: n.finalidade, emitente: { uf: n.emitente_uf, cnpj: n.emitente_cnpj, nome: n.emitente_nome, crt: n.emitente_crt } } as unknown as NotaEntrada;
    const confirmada = new Map((n.classificacao ?? []).map((c) => [c.nItem, c]));
    return { ...n, v_nf: Number(n.v_nf), itens: (n.itens ?? []).map((i) => ({ ...i,
      proposta: classificar(nota, i, uf, { tipoMaterial: tipoMaterial.get(`${(n.emitente_cnpj ?? "").replace(/\D/g, "")}|${i.cProd}`) ?? null, tipoPainel: n.chave ? tipoPainel.get(n.chave) ?? null : null }),
      confirmada: confirmada.get(i.nItem) ?? null })) };
  });
  return NextResponse.json({ notas: saida, repetidas, uf, sincronizacao: sinc, podeOperar: guard.access.can("fiscal.icms", "operar") }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { acao?: string; id?: string; classificacao?: unknown } | null;
  if (corpo?.acao !== "confirmar" || !corpo.id || !Array.isArray(corpo.classificacao)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  const { error } = await guard.supabase.rpc("fiscal_entrada_confirmar", { p_id: corpo.id, p_classificacao: corpo.classificacao.slice(0, 990) });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
