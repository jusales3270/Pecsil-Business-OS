import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { proporBancos, proporFornecedores, proporGerenciais, normalizarNome, type ContaRef, type PartidaHist, type Proposta, type TituloVoto } from "./depara";
import { todas } from "./servidor";
import { contaNoPlano } from "./eventos";

/**
 * Propõe o de-para do plano (N-04 passo 5), com a chave de serviço DEPOIS de a rota conferir fiscal.contabilidade
 * operar. Lê os cadastros do Financeiro, o plano e o histórico já importado da ECD; grava só PROPOSTAS
 * (contabil_vinculos_propor), que nunca passam por cima de vínculo confirmado.
 */
type Conta = ContaRef & { tipo: string; natureza: string; superior_codigo: string | null };

/** O grupo das contas de fornecedor: o sintético do passivo chamado "Fornecedores" com mais contas; sem ele, o de mais contas. */
export function grupoDeFornecedores(contas: readonly Conta[]) {
  const filhas = new Map<string, number>();
  for (const c of contas) if (c.tipo === "analitica" && c.natureza === "passivo" && c.superior_codigo) filhas.set(c.superior_codigo, (filhas.get(c.superior_codigo) ?? 0) + 1);
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]));
  const grupos = [...filhas].sort((a, b) => b[1] - a[1]);
  return (grupos.find(([g]) => /^FORNECEDOR/.test(normalizarNome(porCodigo.get(g)?.nome ?? ""))) ?? grupos[0])?.[0] ?? null;
}

/** Evidência sem documento de pessoa: nome de conta do plano às vezes traz o CPF. */
const semDocumento = (p: Proposta) => ({ ...p, evidencia: p.evidencia.replace(/\d{11,14}/g, "…") });

export async function proporVinculos(admin: SupabaseClient, org: string, plano: string, autor: { nome: string | null }) {
  const contas = await todas<Conta>((a, b) => admin.from("contabil_contas").select("id, codigo, nome, natureza, tipo, superior_codigo").eq("plano_id", plano).eq("ativa", true).order("codigo").range(a, b));
  const analiticas = contas.filter((c) => c.tipo === "analitica");
  const grupo = grupoDeFornecedores(contas);
  const contasForn = analiticas.filter((c) => c.superior_codigo === grupo);

  // Só o que conta para o plano: o histórico de antes da abertura (memória 2020–2025) não gera proposta.
  const { data: pl } = await admin.from("contabil_planos").select("abertura").eq("id", plano).maybeSingle();
  const abertura = (pl?.abertura as string | null | undefined) ?? null;
  type Titulo = { id: string; direction: string; supplier_id: string | null; chart_account_id: string | null; original_amount: number | string; is_forecast: boolean | null; archived_at: string | null; competence_date: string | null; issue_date: string | null; cancelled_at: string | null };
  const titulos = (await todas<Titulo>((a, b) => admin.from("finance_titles").select("id, direction, supplier_id, chart_account_id, original_amount, is_forecast, archived_at, cancelled_at, competence_date, issue_date")
    .eq("organization_id", org).eq("direction", "payable").order("id").range(a, b))).filter((t) => contaNoPlano(t, abertura));
  const idsForn = new Set(titulos.map((t) => t.supplier_id).filter((x): x is string => Boolean(x)));
  const fornecedores = (await todas<{ id: string; name: string | null; legal_name: string | null; trade_name: string | null; merged_into: string | null }>((a, b) =>
    admin.from("suppliers").select("id, name, legal_name, trade_name, merged_into").eq("organization_id", org).order("id").range(a, b))).filter((f) => idsForn.has(f.id) && !f.merged_into);
  const pf = proporFornecedores(fornecedores, contasForn);

  const { data: bancos, error: eb } = await admin.from("finance_bank_accounts").select("id, bank_name, account_number, account_digit").eq("organization_id", org).eq("active", true);
  if (eb) throw new Error(eb.message);
  const pb = proporBancos(bancos ?? [], analiticas.filter((c) => c.natureza === "ativo"));

  // Voto do histórico: os fornecedores já ligados (confirmados) mais os propostos agora.
  const { data: jaForn, error: ev } = await admin.from("contabil_vinculos").select("chave, conta_id").eq("plano_id", plano).eq("origem", "fornecedor").eq("situacao", "confirmado");
  if (ev) throw new Error(ev.message);
  const contaDoFornecedor = new Map<string, string>([...pf.propostas.map((p) => [p.chave, p.conta_id] as [string, string]), ...(jaForn ?? []).map((x) => [x.chave as string, x.conta_id as string] as [string, string])]);
  const partidas = await todas<PartidaHist>((a, b) => admin.from("contabil_partidas").select("lancamento_id, conta_id, lado, valor, l:contabil_lancamentos!inner(plano_id, origem_tipo, encerramento)")
    .eq("l.plano_id", plano).eq("l.origem_tipo", "historico_ecd").eq("l.encerramento", false).order("id").range(a, b) as unknown as PromiseLike<{ data: PartidaHist[] | null; error: { message: string } | null }>);
  const rateios: { title_id: string; chart_account_id: string; amount: number | string }[] = [];
  const ids = titulos.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("finance_title_allocations").select("title_id, chart_account_id, amount").in("title_id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    rateios.push(...(data ?? []));
  }
  const porTitulo = new Map<string, typeof rateios>();
  for (const r of rateios) porTitulo.set(r.title_id, [...(porTitulo.get(r.title_id) ?? []), r]);
  const votos: TituloVoto[] = titulos.filter((t) => t.supplier_id).flatMap((t) => {
    const rs = porTitulo.get(t.id);
    if (rs?.length) return rs.map((r) => ({ conta_gerencial: r.chart_account_id, fornecedor: t.supplier_id!, valor: Number(r.amount) }));
    return t.chart_account_id ? [{ conta_gerencial: t.chart_account_id, fornecedor: t.supplier_id!, valor: Number(t.original_amount) }] : [];
  });
  const pg = proporGerenciais(partidas, votos, contaDoFornecedor, analiticas);

  const itens = [
    ...pf.propostas.map((p) => ({ origem: "fornecedor", ...semDocumento(p) })),
    ...pb.map((p) => ({ origem: "conta_bancaria", ...semDocumento(p) })),
    ...pg.map((p) => ({ origem: "conta_gerencial", ...semDocumento(p) })),
  ];
  let gravados = 0;
  for (let i = 0; i < itens.length; i += 500) {
    const { data, error } = await admin.rpc("contabil_vinculos_propor", { p_org: org, p_plano: plano, p_itens: itens.slice(i, i + 500), p_autor_nome: autor.nome });
    if (error) throw new Error(error.message);
    gravados += Number(data ?? 0);
  }
  return {
    gravados, fornecedores: { comTitulo: fornecedores.length, propostos: pf.propostas.length, ambiguos: pf.ambiguos.length },
    bancos: { total: (bancos ?? []).length, propostos: pb.length }, gerenciais: { comTitulo: new Set(votos.map((v) => v.conta_gerencial)).size, propostos: pg.length },
    grupoFornecedores: contas.find((c) => c.codigo === grupo)?.codigo ?? null,
  };
}
