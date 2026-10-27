import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { montarBalancete, type ContaPlano, type Movimento } from "../../../../lib/contabil/escrituracao/balancete";
import { lerEcd, lerPlanoCsv, partidasDeAbertura } from "../../../../lib/contabil/escrituracao/ecd";
import { planoDeExemplo } from "../../../../lib/contabil/escrituracao/exemplo";
import { PAPEIS } from "../../../../lib/contabil/escrituracao/regras";
import { escriturar, todas } from "../../../../lib/contabil/escrituracao/servidor";
import { autorDaSessao } from "../../../../lib/fiscal/emissao/servidor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Fiscal › Contabilidade (N-04): plano de contas, vínculos, escrituração automática, lançamento manual, estorno,
 * balancete, razão e trava do mês. Leitura pela sessão (RLS); escrita pelas funções do banco, que conferem a
 * permissão. A escrituração automática lê o Financeiro com a chave de serviço, depois de conferir fiscal.contabilidade operar.
 */
const COLUNAS_CONTA = "id, codigo, nome, natureza, tipo, nivel, superior_codigo, referencial, ativa";
/** Todas as contas do plano, em páginas: o Supabase para em 1.000 linhas e o plano oficial tem mais de 2 mil. */
const contasDoPlano = <T,>(sb: SupabaseClient, plano: string, colunas: string) =>
  todas<T>((de, ate) => sb.from("contabil_contas").select(colunas).eq("plano_id", plano).order("codigo").range(de, ate) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>);
const dataOk = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const erro = (mensagem: string, status = 400) => NextResponse.json({ error: mensagem }, { status });

export async function GET(request: Request) {
  const guard = await requireFeature("fiscal.contabilidade", "ver");
  if ("error" in guard) return guard.error;
  const q = new URL(request.url).searchParams;
  const sb = guard.supabase;
  const { data: planos, error } = await sb.from("contabil_planos").select("id, nome, origem, oficial, abertura, criado_por_nome, created_at").order("oficial", { ascending: false }).order("created_at", { ascending: false });
  if (error) return dbError(error);
  const plano = (planos ?? []).find((p) => p.id === q.get("plano")) ?? planos?.[0] ?? null;
  if (!plano) return NextResponse.json({ planos: [], plano: null, contas: [], vinculos: [], periodos: [], lancamentos: 0, papeis: PAPEIS, gerenciais: [], bancos: [], podeOperar: guard.access.can("fiscal.contabilidade", "operar") });
  const visao = q.get("visao");
  const de = q.get("de") ?? "", ate = q.get("ate") ?? "";

  if (visao === "balancete") {
    if (!dataOk(de) || !dataOk(ate) || de > ate) return erro("Período inválido.");
    const [contas, { data: mov, error: e }] = await Promise.all([
      contasDoPlano<ContaPlano>(sb, plano.id, COLUNAS_CONTA),
      sb.rpc("contabil_balancete", { p_plano: plano.id, p_de: de, p_ate: ate }),
    ]);
    if (e) return dbError(e);
    return NextResponse.json({ plano, balancete: montarBalancete(contas, (mov ?? []) as Movimento[]) });
  }
  if (visao === "razao") {
    const conta = q.get("conta");
    if (!conta || !dataOk(de) || !dataOk(ate)) return erro("Escolha a conta e o período.");
    const [{ data: mov }, { data: partidas, error: e }] = await Promise.all([
      sb.rpc("contabil_balancete", { p_plano: plano.id, p_de: de, p_ate: ate }),
      sb.from("contabil_partidas").select("id, lado, valor, lancamento:contabil_lancamentos!inner(id, data, historico, origem_tipo, estorno_de)")
        .eq("conta_id", conta).gte("lancamento.data", de).lte("lancamento.data", ate).limit(5000),
    ]);
    if (e) return dbError(e);
    const anterior = Number(((mov ?? []) as Movimento[]).find((m) => m.conta_id === conta)?.anterior ?? 0);
    type P = { id: string; lado: "D" | "C"; valor: number; lancamento: { id: string; data: string; historico: string; origem_tipo: string; estorno_de: string | null } };
    const linhas = ((partidas ?? []) as unknown as P[]).sort((a, b) => a.lancamento.data.localeCompare(b.lancamento.data));
    return NextResponse.json({ plano, razao: { anterior, linhas } });
  }
  if (visao === "lancamentos") {
    if (!dataOk(de) || !dataOk(ate)) return erro("Período inválido.");
    let consulta = sb.from("contabil_lancamentos").select("id, data, historico, origem_tipo, estorno_de, criado_por_nome, partidas:contabil_partidas(lado, valor, conta:contabil_contas(codigo, nome))")
      .eq("plano_id", plano.id).gte("data", de).lte("data", ate).order("data", { ascending: false }).limit(300);
    const origem = q.get("origem");
    if (origem) consulta = consulta.eq("origem_tipo", origem);
    const [{ data, error: e }, { data: estornados }] = await Promise.all([consulta, sb.from("contabil_lancamentos").select("estorno_de").eq("plano_id", plano.id).not("estorno_de", "is", null)]);
    if (e) return dbError(e);
    return NextResponse.json({ plano, lancamentos: data ?? [], estornados: (estornados ?? []).map((x) => x.estorno_de) });
  }

  const admin = createSupabaseAdminClient();
  const autor = await autorDaSessao(sb);
  const [contas, { data: vinculos }, { data: periodos }, { count: lancamentos }, { data: gerenciais }, { data: bancos }] = await Promise.all([
    contasDoPlano<Record<string, unknown>>(sb, plano.id, COLUNAS_CONTA),
    sb.from("contabil_vinculos").select("origem, chave, conta_id, situacao, atualizado_por_nome").eq("plano_id", plano.id),
    sb.from("contabil_periodos").select("competencia, situacao, motivo, atualizado_por_nome, updated_at").eq("plano_id", plano.id).order("competencia", { ascending: false }),
    sb.from("contabil_lancamentos").select("id", { count: "exact", head: true }).eq("plano_id", plano.id),
    // As contas gerenciais e bancárias são do Financeiro: lidas com a chave de serviço, só nome e código.
    admin.from("finance_chart_accounts").select("id, code, name, account_type, management_type").eq("organization_id", autor?.org ?? "").eq("active", true).eq("allows_posting", true).order("code"),
    admin.from("finance_bank_accounts").select("id, bank_name, branch, account_number").eq("organization_id", autor?.org ?? "").eq("active", true),
  ]);
  return NextResponse.json({
    planos, plano, contas, vinculos: vinculos ?? [], periodos: periodos ?? [], lancamentos: lancamentos ?? 0,
    papeis: PAPEIS, gerenciais: gerenciais ?? [], bancos: bancos ?? [], podeOperar: guard.access.can("fiscal.contabilidade", "operar"),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.contabilidade", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo) return erro("Pedido inválido.");
  const sb = guard.supabase;
  const autor = await autorDaSessao(sb);
  if (!autor) return erro("Sessão sem empresa.", 403);
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
  };
  try {
    switch (corpo.acao) {
      case "criar_exemplo": {
        const { contas, vinculos } = planoDeExemplo();
        const id = await rpc("contabil_plano_importar", { p_nome: "Plano de exemplo (teste do motor)", p_origem: "exemplo", p_contas: contas, p_vinculos: vinculos });
        return NextResponse.json({ ok: true, plano: id, mensagem: `Plano de exemplo criado com ${contas.length} contas e os papéis ligados.` });
      }
      case "importar": {
        const formato = corpo.formato === "ecd" ? "ecd" : "planilha";
        const texto = String(corpo.texto ?? "");
        if (texto.length < 20) return erro("O arquivo veio vazio.");
        const lido = formato === "ecd" ? lerEcd(texto) : lerPlanoCsv(texto);
        if (!lido.contas.length) return erro(lido.avisos[0] ?? "Nenhuma conta encontrada.");
        const nome = String(corpo.nome ?? "").trim() || (formato === "ecd" ? `Plano da ECD${lido.empresa.nome ? ` · ${lido.empresa.nome}` : ""}` : "Plano importado da planilha");
        const id = String(await rpc("contabil_plano_importar", { p_nome: nome.slice(0, 120), p_origem: formato, p_contas: lido.contas, p_vinculos: [] }));
        let abertura: { data: string; fecha: boolean; debitos: number; creditos: number; faltam: string[] } | null = null;
        if (lido.saldos.length && lido.saldosEm) {
          const contas = await contasDoPlano<Parameters<typeof partidasDeAbertura>[0][number]>(sb, id, "id, codigo, natureza, tipo");
          const a = partidasDeAbertura(contas, lido.saldos);
          const dia = new Date(`${lido.saldosEm}T12:00:00Z`); dia.setUTCDate(dia.getUTCDate() + 1);
          const data = dia.toISOString().slice(0, 10);
          abertura = { data, fecha: a.fecha, debitos: a.debitos, creditos: a.creditos, faltam: a.faltam };
          if (a.fecha && a.partidas.length) {
            await rpc("contabil_plano_definir", { p_plano: id, p_oficial: false, p_abertura: data });
            const admin = createSupabaseAdminClient();
            const { error } = await admin.rpc("contabil_escriturar_lote", { p_org: autor.org, p_plano: id, p_autor: autor.profileId, p_autor_nome: autor.nome,
              p_lote: [{ data, historico: `Saldos de abertura (ECD, saldos de ${lido.saldosEm.split("-").reverse().join("/")})`, origem_tipo: "abertura", origem_id: id, partidas: a.partidas }] });
            if (error) throw new Error(`Abertura: ${error.message}`);
          }
        }
        return NextResponse.json({ ok: true, plano: id, contas: lido.contas.length, avisos: lido.avisos, abertura });
      }
      case "definir":
        await rpc("contabil_plano_definir", { p_plano: corpo.plano, p_oficial: corpo.oficial === true, p_abertura: dataOk(corpo.abertura) ? corpo.abertura : null });
        return NextResponse.json({ ok: true });
      case "apagar":
        await rpc("contabil_plano_apagar", { p_plano: corpo.plano });
        return NextResponse.json({ ok: true });
      case "vincular":
        if (!["conta_gerencial", "conta_bancaria", "papel"].includes(String(corpo.origem))) return erro("Origem inválida.");
        await rpc("contabil_vincular", { p_plano: corpo.plano, p_origem: corpo.origem, p_chave: String(corpo.chave ?? ""), p_conta: corpo.conta || null });
        return NextResponse.json({ ok: true });
      case "escriturar": {
        if (!dataOk(corpo.de) || !dataOk(corpo.ate) || String(corpo.de) > String(corpo.ate)) return erro("Período inválido.");
        const { data: p } = await sb.from("contabil_planos").select("id").eq("id", String(corpo.plano ?? "")).maybeSingle();
        if (!p) return erro("Plano não encontrado.", 404);
        const r = await escriturar(createSupabaseAdminClient(), autor.org, p.id, { de: String(corpo.de), ate: String(corpo.ate) }, { id: autor.profileId, nome: autor.nome });
        const porMotivo: Record<string, number> = {};
        const semVinculo = new Map<string, { contas: number; valor: number }>();
        for (const x of r.pendencias) {
          porMotivo[x.motivo] = (porMotivo[x.motivo] ?? 0) + 1;
          if (x.motivo === "sem_vinculo_gerencial") { const s = semVinculo.get(x.detalhe) ?? { contas: 0, valor: 0 }; s.contas++; s.valor += x.valor; semVinculo.set(x.detalhe, s); }
        }
        return NextResponse.json({
          ok: true, lancados: r.lancados, jaLancados: r.jaLancados, eventos: r.eventos, de: r.de, ate: r.ate, porMotivo,
          semVinculo: [...semVinculo].map(([chave, s]) => ({ chave, ...s })).sort((a, b) => b.contas - a.contas),
          amostra: r.pendencias.filter((x) => x.motivo !== "sem_vinculo_gerencial").slice(0, 100),
        });
      }
      case "manual": {
        const partidas = Array.isArray(corpo.partidas) ? corpo.partidas.slice(0, 50) : [];
        const id = await rpc("contabil_lancamento_manual", { p_plano: corpo.plano, p_data: corpo.data, p_historico: String(corpo.historico ?? ""), p_partidas: partidas });
        return NextResponse.json({ ok: true, id });
      }
      case "estornar": {
        const id = await rpc("contabil_estornar", { p_lancamento: corpo.lancamento, p_data: dataOk(corpo.data) ? corpo.data : null, p_motivo: String(corpo.motivo ?? "") });
        return NextResponse.json({ ok: true, id });
      }
      case "periodo":
        if (!/^\d{4}-\d{2}$/.test(String(corpo.competencia))) return erro("Competência inválida.");
        await rpc("contabil_periodo_definir", { p_plano: corpo.plano, p_competencia: corpo.competencia, p_fechar: corpo.fechar === true, p_motivo: String(corpo.motivo ?? "") });
        return NextResponse.json({ ok: true });
      default:
        return erro("Ação desconhecida.");
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json({ error: err.message ?? "Falha na contabilidade." }, { status: err.code === "42501" ? 403 : 400 });
  }
}
