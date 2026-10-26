import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { autorDaSessao } from "../../../../lib/fiscal/emissao/servidor";
import type { Parametro } from "../../../../lib/contabil/parametros";
import { CHAVES_ALIQUOTA, conferirNota } from "../../../../lib/fiscal/ibs-cbs/conferencia";
import { apurar, semRepetidas, type ItemIbsCbs, type NotaIbsCbs } from "../../../../lib/fiscal/ibs-cbs/leitura";
import { sincronizar } from "../../../../lib/fiscal/ibs-cbs/servidor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › IBS e CBS (N-03): a apuração informativa de 2026 a partir das NF-e guardadas na plataforma. Antes de
 * responder, lê o que ainda faltar (o envio e a tarefa de 10 em 10 minutos já leem na hora). Cada nota sai
 * conferida contra a alíquota legal da data dela; a mesma chave de acesso conta uma vez. Quem vê o Fiscal lê;
 * ninguém escreve por aqui (a leitura é do servidor).
 */
const LEITURA = ["fiscal.icms", "fiscal.config", "fiscal.parametros", "fiscal.nfe", "fiscal.escritorio", "fiscal.portal"] as const;

type Linha = { id: string; chave: string | null; numero: string | null; lado: NotaIbsCbs["lado"]; finalidade: string | null; emissao: string | null; competencia: string | null; emitente_cnpj: string | null; emitente_nome: string | null; emitente_crt: number | null; destinatario_cnpj: string | null; tem_grupo: boolean; v_bc: number; v_ibs_uf: number; v_ibs_mun: number; v_ibs: number; v_cbs: number; v_nf: number; itens: ItemIbsCbs[]; document_id: string | null };

export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem empresa." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  let sinc: Awaited<ReturnType<typeof sincronizar>>;
  try { sinc = await sincronizar(admin, autor.org); } catch (e) { sinc = { lidas: 0, pendentes: 0, aviso: `Não foi possível ler as notas novas agora (${e instanceof Error ? e.message.slice(0, 120) : "erro"}).` }; }
  const [{ data, error }, { data: params }] = await Promise.all([
    guard.supabase.from("fiscal_ibscbs_notas").select("id, chave, numero, lado, finalidade, emissao, competencia, emitente_cnpj, emitente_nome, emitente_crt, destinatario_cnpj, tem_grupo, v_bc, v_ibs_uf, v_ibs_mun, v_ibs, v_cbs, v_nf, itens, document_id")
      .not("competencia", "is", null).order("emissao", { ascending: true }).order("lido_em", { ascending: true }).limit(5000),
    // Parâmetro legal é público para quem vê o Fiscal; a RLS dele só abre para a curadoria e o escritório.
    admin.from("contabil_parametros").select("id, chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao, situacao").in("chave", [...CHAVES_ALIQUOTA]).neq("situacao", "descartado"),
  ]);
  if (error) return dbError(error);
  const parametros = (params ?? []) as Parametro[];
  const { notas: unicas, repetidas } = semRepetidas((data ?? []) as Linha[]);
  const linhas = unicas.reverse().map((l) => {
    const n = { ...l, v_bc: Number(l.v_bc), v_ibs_uf: Number(l.v_ibs_uf), v_ibs_mun: Number(l.v_ibs_mun), v_ibs: Number(l.v_ibs), v_cbs: Number(l.v_cbs), v_nf: Number(l.v_nf) };
    return { ...n, conferencia: conferirNota({ temGrupo: n.tem_grupo, itens: n.itens ?? [], data: n.emissao ? n.emissao.slice(0, 10) : null, crt: n.emitente_crt }, parametros) };
  });
  const apuracao = apurar(linhas.map((l) => ({ competencia: l.competencia, lado: l.lado, finalidade: l.finalidade, temGrupo: l.tem_grupo, emitenteCrt: l.emitente_crt, vIBS: l.v_ibs, vCBS: l.v_cbs } as unknown as NotaIbsCbs)));
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const regra = parametros.filter((p) => p.chave === "reforma_2026_fase_teste" && p.vigente_de <= hoje && (!p.vigente_ate || p.vigente_ate >= hoje))
    .sort((a, b) => Number(b.situacao === "conferido") - Number(a.situacao === "conferido"))[0] ?? null;
  return NextResponse.json({ notas: linhas, apuracao, sincronizacao: { ...sinc, repetidas }, regra }, { headers: { "Cache-Control": "no-store" } });
}
