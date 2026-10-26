import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { autorDaSessao } from "../../../../lib/fiscal/emissao/servidor";
import { apurar, lerIbsCbs, type NotaIbsCbs } from "../../../../lib/fiscal/ibs-cbs/leitura";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › IBS e CBS (N-03): a apuração informativa de 2026 a partir das NF-e guardadas na plataforma. Antes de
 * responder, lê os XMLs novos (no máximo 150 por vez) e guarda o resultado em fiscal_ibscbs_notas. Quem vê o
 * Fiscal lê; ninguém escreve por aqui (a leitura é do servidor).
 */
const LEITURA = ["fiscal.icms", "fiscal.config", "fiscal.parametros", "fiscal.nfe", "fiscal.escritorio", "fiscal.portal"] as const;
const LOTE = 150;

type Linha = { id: string; chave: string | null; numero: string | null; lado: NotaIbsCbs["lado"]; finalidade: string | null; emissao: string | null; competencia: string | null; emitente_cnpj: string | null; emitente_nome: string | null; destinatario_cnpj: string | null; tem_grupo: boolean; v_bc: number; v_ibs_uf: number; v_ibs_mun: number; v_ibs: number; v_cbs: number; v_nf: number; itens: { cst: string; cClassTrib: string }[]; document_id: string | null };

async function sincronizar(org: string) {
  const admin = createSupabaseAdminClient();
  const { data: cfg } = await admin.from("fiscal_config").select("cnpj").eq("organization_id", org).maybeSingle();
  const cnpj = (cfg?.cnpj ?? "").replace(/\D/g, "");
  if (cnpj.length !== 14) return { lidas: 0, aviso: "Configure o CNPJ da empresa em Fiscal › Configuração para separar entradas e saídas." };
  const { data: lidos } = await admin.from("fiscal_ibscbs_notas").select("document_id").eq("organization_id", org).not("document_id", "is", null);
  const ja = new Set((lidos ?? []).map((l) => l.document_id as string));
  const { data: docs } = await admin.from("company_documents").select("id, storage_path").eq("organization_id", org).in("mime_type", ["text/xml", "application/xml"]).is("archived_at", null).order("created_at", { ascending: false }).limit(2000);
  const novos = (docs ?? []).filter((d) => !ja.has(d.id)).slice(0, LOTE);
  let lidas = 0;
  for (const d of novos) {
    const { data: blob } = await admin.storage.from("empresa-documentos").download(d.storage_path);
    if (!blob) continue;
    const n = lerIbsCbs(await blob.text(), cnpj);
    if (!n) continue;
    const { error } = await admin.from("fiscal_ibscbs_notas").insert({
      organization_id: org, document_id: d.id, chave: n.chave, numero: n.numero, lado: n.lado, finalidade: n.finalidade, emissao: n.emissao, competencia: n.competencia,
      emitente_cnpj: n.emitenteCnpj, emitente_nome: n.emitenteNome, destinatario_cnpj: n.destinatarioCnpj, tem_grupo: n.temGrupo,
      v_bc: n.vBC, v_ibs_uf: n.vIBSUF, v_ibs_mun: n.vIBSMun, v_ibs: n.vIBS, v_cbs: n.vCBS, v_nf: n.vNF,
      itens: n.itens.map((i) => ({ nItem: i.nItem, cst: i.cst, cClassTrib: i.cClassTrib, vBC: i.vBC, pIBSUF: i.pIBSUF, pIBSMun: i.pIBSMun, pCBS: i.pCBS })),
    });
    if (!error) lidas++;
  }
  // NF-e emitida pela plataforma em produção (o treino não conta).
  const { data: emitidas } = await admin.from("fiscal_nfe").select("id, xml_autorizado").eq("organization_id", org).eq("ambiente", "producao").not("xml_autorizado", "is", null);
  const { data: jaNfe } = await admin.from("fiscal_ibscbs_notas").select("nfe_id").eq("organization_id", org).not("nfe_id", "is", null);
  const nfeLidas = new Set((jaNfe ?? []).map((l) => l.nfe_id as string));
  for (const e of (emitidas ?? []).filter((x) => !nfeLidas.has(x.id)).slice(0, LOTE)) {
    const n = lerIbsCbs(String(e.xml_autorizado), cnpj);
    if (!n) continue;
    await admin.from("fiscal_ibscbs_notas").insert({
      organization_id: org, nfe_id: e.id, chave: n.chave, numero: n.numero, lado: n.lado, finalidade: n.finalidade, emissao: n.emissao, competencia: n.competencia,
      emitente_cnpj: n.emitenteCnpj, emitente_nome: n.emitenteNome, destinatario_cnpj: n.destinatarioCnpj, tem_grupo: n.temGrupo,
      v_bc: n.vBC, v_ibs_uf: n.vIBSUF, v_ibs_mun: n.vIBSMun, v_ibs: n.vIBS, v_cbs: n.vCBS, v_nf: n.vNF, itens: n.itens.map((i) => ({ nItem: i.nItem, cst: i.cst, cClassTrib: i.cClassTrib, vBC: i.vBC, pIBSUF: i.pIBSUF, pIBSMun: i.pIBSMun, pCBS: i.pCBS })),
    });
    lidas++;
  }
  return { lidas, aviso: null as string | null, pendentes: Math.max(0, (docs ?? []).filter((d) => !ja.has(d.id)).length - novos.length) };
}

export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem empresa." }, { status: 403 });
  let sinc: Awaited<ReturnType<typeof sincronizar>>;
  try { sinc = await sincronizar(autor.org); } catch (e) { sinc = { lidas: 0, aviso: `Não foi possível ler as notas novas agora (${e instanceof Error ? e.message.slice(0, 120) : "erro"}).` }; }
  const [{ data, error }, { data: regra }] = await Promise.all([
    guard.supabase.from("fiscal_ibscbs_notas").select("id, chave, numero, lado, finalidade, emissao, competencia, emitente_cnpj, emitente_nome, destinatario_cnpj, tem_grupo, v_bc, v_ibs_uf, v_ibs_mun, v_ibs, v_cbs, v_nf, itens, document_id").order("emissao", { ascending: false }).limit(5000),
    // Parâmetro legal é público para quem vê o Fiscal; a RLS dele só abre para a curadoria e o escritório.
    createSupabaseAdminClient().from("contabil_parametros").select("valor, fonte, situacao, vigente_de, vigente_ate").eq("chave", "reforma_2026_fase_teste").neq("situacao", "descartado").order("vigente_de", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) return dbError(error);
  const linhas = ((data ?? []) as Linha[]).map((l) => ({ ...l, v_bc: Number(l.v_bc), v_ibs_uf: Number(l.v_ibs_uf), v_ibs_mun: Number(l.v_ibs_mun), v_ibs: Number(l.v_ibs), v_cbs: Number(l.v_cbs), v_nf: Number(l.v_nf) }));
  const apuracao = apurar(linhas.map((l) => ({ competencia: l.competencia, lado: l.lado, finalidade: l.finalidade, temGrupo: l.tem_grupo, vIBS: l.v_ibs, vCBS: l.v_cbs } as unknown as NotaIbsCbs)));
  return NextResponse.json({ notas: linhas, apuracao, sincronizacao: sinc, regra: regra ?? null }, { headers: { "Cache-Control": "no-store" } });
}
