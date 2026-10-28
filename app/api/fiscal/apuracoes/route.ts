import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { apurarPisCofinsCumulativo, apurarPresumidoAno, type ReceitaTrimestre } from "../../../../lib/contabil/apuracao/presumido";
import { conferirGuia, tributoDoCodigo, type Esperado } from "../../../../lib/contabil/apuracao/guia";
import { receitaPorMes, type NotaParaReceita } from "../../../../lib/contabil/apuracao/receita";
import { montarCalendario, type DadosCalendario } from "../../../../lib/contabil/calendario";
import { vigente, type Parametro } from "../../../../lib/contabil/parametros";
import { semRepetidas } from "../../../../lib/fiscal/ibs-cbs/leitura";
import { sincronizar } from "../../../../lib/fiscal/ibs-cbs/servidor";
import { autorDaSessao } from "../../../../lib/fiscal/emissao/servidor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › Apurações (N-07): IRPJ e CSLL do Lucro Presumido por trimestre e PIS/COFINS por mês, a partir das notas
 * de saída guardadas (regime de competência), e cada guia do portal conferida contra a apuração. Só leitura: o
 * cálculo é puro (lib/contabil/apuracao) e as notas e guias são lidas com a chave de serviço depois de conferir que a
 * pessoa vê o Fiscal. Enquanto o escritório não confirmar o método (caixa ou competência), a tela trata a base pelas
 * notas como estimativa.
 */
const LEITURA = ["fiscal.contabilidade", "fiscal.icms", "fiscal.config", "fiscal.parametros", "fiscal.escritorio", "fiscal.portal"] as const;
const CHAVES = ["lucro_presumido_percentuais", "pis_cofins_aliquotas", "codigos_darf"];
const fimDoMes = (c: string) => { const [a, m] = c.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };

export async function GET(request: Request) {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem empresa." }, { status: 403 });
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const pedido = Number(new URL(request.url).searchParams.get("ano"));
  const ano = Number.isInteger(pedido) && pedido >= 2020 && pedido <= Number(hoje.slice(0, 4)) ? pedido : Number(hoje.slice(0, 4));
  const admin = createSupabaseAdminClient();
  let aviso: string | null = null;
  try { aviso = (await sincronizar(admin, autor.org)).aviso; } catch (e) { aviso = `Não foi possível ler as notas novas agora (${e instanceof Error ? e.message.slice(0, 120) : "erro"}).`; }

  const COLUNAS_GUIA = "id, tipo, valor, vencimento, codigo_receita, tributo, periodo_apuracao, document_id, created_at";
  const [{ data: notas, error }, { data: params }, { data: perfil }, { data: guiasDoAno }, { data: semPeriodo }, { data: cal }] = await Promise.all([
    admin.from("fiscal_ibscbs_notas").select("chave, lado, competencia, receita").eq("organization_id", autor.org).like("competencia", `${ano}-%`).limit(20000),
    admin.from("contabil_parametros").select("id, chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao, situacao").in("chave", CHAVES).neq("situacao", "descartado"),
    admin.from("contabil_perfil_empresa").select("regime, modo").eq("organization_id", autor.org).maybeSingle(),
    admin.from("fiscal_guias").select(COLUNAS_GUIA).eq("organization_id", autor.org).neq("situacao", "cancelada")
      .gte("periodo_apuracao", `${ano}-01-01`).lte("periodo_apuracao", `${ano}-12-31`).order("periodo_apuracao"),
    // DARF ainda sem classificação (enviado antes ou sem código reconhecido): aparece para classificar.
    admin.from("fiscal_guias").select(COLUNAS_GUIA).eq("organization_id", autor.org).neq("situacao", "cancelada").eq("tipo", "DARF").is("periodo_apuracao", null)
      .gte("created_at", `${ano}-01-01`).lt("created_at", `${ano + 1}-02-01`).order("created_at"),
    guard.supabase.rpc("fiscal_calendario_dados"),
  ]);
  if (error) return dbError(error);
  const parametros = (params ?? []) as Parametro[];
  const regime = perfil?.regime ?? "a_definir";
  const { notas: unicas } = semRepetidas((notas ?? []) as (NotaParaReceita & { chave: string | null })[]);
  const porMes = new Map(receitaPorMes(unicas).map((m) => [m.competencia, m]));
  const ultimoMes = ano < Number(hoje.slice(0, 4)) ? 12 : Number(hoje.slice(5, 7));

  // PIS/COFINS de cada mês com notas.
  const meses = Array.from({ length: ultimoMes }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`).map((c) => {
    const r = porMes.get(c);
    if (!r || !r.notas) return { competencia: c, notas: 0, receita: null, pisCofins: null };
    try {
      const pc = apurarPisCofinsCumulativo(parametros, c, r.industria + r.servicos, [{ rotulo: "Exportação (CFOP 7xxx)", valor: r.exportacao }, { rotulo: "Devoluções de venda", valor: r.devolucoes }].filter((x) => x.valor));
      return { competencia: c, notas: r.notas, receita: r, pisCofins: { base: pc.base, pis: pc.pis, cofins: pc.cofins, darf: pc.darf, memoria: pc.memoria, aConferir: pc.aConferir.length > 0 } };
    } catch (e) {
      return { competencia: c, notas: r.notas, receita: r, pisCofins: null, erro: e instanceof Error ? e.message : "erro" };
    }
  });

  // IRPJ/CSLL: os trimestres completos em sequência desde janeiro (o limite da LC 224 se acumula no ano).
  const completos: ReceitaTrimestre[] = [];
  for (const t of [1, 2, 3, 4] as const) {
    const ms = meses.slice((t - 1) * 3, t * 3);
    if (ms.length < 3 || ms.some((m) => !m.receita)) break;
    const soma = (k: "industria" | "servicos" | "devolucoes") => ms.reduce((s, m) => s + (m.receita?.[k] ?? 0), 0);
    completos.push({ trimestre: t, receitas: { industria_comercio: soma("industria") - soma("devolucoes"), servicos: soma("servicos") }, outras: 0 });
  }
  let trimestres: ReturnType<typeof apurarPresumidoAno>["trimestres"] = [], semLc224: typeof trimestres = [], notasAno: string[] = [], aConferir = false;
  if (completos.length) {
    const r = apurarPresumidoAno(parametros, ano, completos);
    trimestres = r.trimestres; notasAno = r.notas; aConferir = r.aConferir.length > 0;
    // Alternativa para explicar diferença de guia: o mesmo cálculo sem o acréscimo da LC 224.
    const sem = parametros.map((p) => (p.chave === "lucro_presumido_percentuais" && p.valor && typeof p.valor === "object" ? { ...p, valor: { ...(p.valor as object), lc_224_2025: undefined } } : p));
    semLc224 = apurarPresumidoAno(sem, ano, completos).trimestres;
  }

  // Vencimentos pelo calendário fiscal da empresa.
  const ocorr = cal ? montarCalendario(cal as DadosCalendario, { de: `${ano}-01-01`, ate: `${ano + 1}-01-31`, hoje }).ocorrencias : [];
  const vencimento = (codigo: string, periodo: string) => ocorr.find((o) => o.codigo === codigo && o.periodo === periodo)?.vencimento ?? null;

  const codigos = vigente<Record<string, string>>(parametros, "codigos_darf", `${ano}-12-31`)?.valor ?? null;
  const conferidas = [...(guiasDoAno ?? []), ...(semPeriodo ?? [])].map((g) => {
    const tributo = tributoDoCodigo(codigos, g.codigo_receita) ?? g.tributo;
    const periodo = g.periodo_apuracao as string | null;
    let esperado: Esperado | null = null;
    if (periodo && (tributo === "IRPJ" || tributo === "CSLL")) {
      const t = Math.ceil(Number(periodo.slice(5, 7)) / 3);
      const x = trimestres.find((q) => q.trimestre === t), s = semLc224.find((q) => q.trimestre === t);
      const fimTri = `${ano}-${String(t * 3).padStart(2, "0")}`;
      if (x) esperado = { valor: tributo === "IRPJ" ? x.irpj : x.csllDevida, vencimento: vencimento("irpj_csll_trimestral", fimTri), alternativas: s ? [{ rotulo: "sem o acréscimo da LC 224", valor: tributo === "IRPJ" ? s.irpj : s.csllDevida }] : [] };
    } else if (periodo && (tributo === "PIS" || tributo === "COFINS")) {
      const m = meses.find((x) => x.competencia === periodo.slice(0, 7));
      if (m?.pisCofins) esperado = { valor: tributo === "PIS" ? m.pisCofins.pis : m.pisCofins.cofins, vencimento: vencimento("pis_cofins", m.competencia) };
    }
    return { ...g, tributo, conferencia: conferirGuia({ valor: Number(g.valor), codigo: g.codigo_receita, periodo, vencimento: g.vencimento }, codigos, regime, esperado) };
  });

  return NextResponse.json({
    ano, hoje, regime, aviso, metodo: "competencia", meses, trimestres: trimestres.map((t) => ({ ...t, vencimento: vencimento("irpj_csll_trimestral", t.fim.slice(0, 7)) })), notasAno, aConferir,
    guias: conferidas, semNotas: meses.filter((m) => !m.notas).map((m) => m.competencia), limite: fimDoMes(`${ano}-${String(ultimoMes).padStart(2, "0")}`),
  }, { headers: { "Cache-Control": "no-store" } });
}
