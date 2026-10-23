import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSessionAccess } from "../../auth/session-access";
import { FERRAMENTAS } from "../ferramentas";
import { sessaoComo } from "../guias-executar";
import { agoraSP } from "../tempo";
import { janelaDoBomDia } from "./bom-dia";
import { CRESCIMENTO, pesquisar, semanaDe, sintetizar, validarRelatorio, type Relatorio } from "./crescimento";

/**
 * Execução do crescimento (J4). A tarefa de 10 em 10 minutos chama /api/sara/crescimento/rodar: na janela
 * (segunda-feira, 8h às 12h) sai uma vez por semana; o proprietário também pede na War Room.
 *   1. Retrato da semana: as consultas das SARAs com a sessão da VISÃO (o proprietário, W1).
 *   2. Pesquisa na internet aberta, só com o assunto (setor e região): o modelo não recebe nada da empresa.
 *   3. Síntese sem internet (retrato + gargalos da vigia + relatório anterior + pesquisa), conferida.
 *   4. Aviso no sino para o proprietário e quem tem a SARA central.
 */

/** O retrato: as consultas que mostram para onde a empresa está indo (sem dado pessoal de colaborador). */
const RETRATO: [string, Record<string, unknown>][] = [
  ["fluxo_de_caixa_90_dias", { cenario: "base" }],
  ["contas_a_receber", { situacao: "a_vencer", dias: 30, limite: 10 }],
  ["contas_a_pagar", { situacao: "vencidas", limite: 10 }],
  ["comercial_funil", {}],
  ["comercial_orcamentos", {}],
  ["comercial_a_faturar", {}],
  ["comercial_clientes", {}],
  ["compras_realizadas", {}],
  ["producao_ordens", {}],
  ["fiscal_notas_emitidas", {}],
];

export type RelatorioCrescimento = { id?: string; jaRodou?: boolean; relatorio?: Relatorio; buscas: number; achadosDaPesquisa: number; erro?: string };
export type OpcoesCrescimento = {
  agora?: Date; disparo?: "agenda" | "manual";
  visao?: { sb: SupabaseClient; profileId: string };
  /** Teste: quem recebe o aviso (nunca avisa a gente de verdade). */
  destinatarios?: string[];
};

export async function rodarCrescimento(admin: SupabaseClient, o: OpcoesCrescimento = {}): Promise<RelatorioCrescimento> {
  const agora = o.agora ?? new Date();
  const disparo = o.disparo ?? "agenda";
  const rel: RelatorioCrescimento = { buscas: 0, achadosDaPesquisa: 0 };
  if (disparo === "agenda" && !janelaDoBomDia(agora, CRESCIMENTO)) return rel;
  const semana = semanaDe(agora);
  const { data: dono } = await admin.from("profiles").select("id, organization_id").eq("is_owner", true).eq("status", "active").order("created_at").limit(1).maybeSingle();
  if (!dono) return { ...rel, erro: "Sem proprietário ativo para a visão da empresa." };
  const { data: linha, error: eL } = await admin.from("sara_relatorios").insert({ organization_id: dono.organization_id, semana, disparo, pedido_por: o.visao?.profileId ?? null }).select("id").single();
  if (eL) return eL.code === "23505" ? { ...rel, jaRodou: true } : { ...rel, erro: eL.message };
  rel.id = linha.id;
  const fim = (campos: Record<string, unknown>) => admin.from("sara_relatorios").update({ ...campos, terminada_em: new Date().toISOString() }).eq("id", linha.id);
  const aberta = o.visao ? null : await sessaoComo(admin, dono.id);
  if (aberta && "erro" in aberta) { await fim({ situacao: "falhou", erro: aberta.erro.slice(0, 500) }); return { ...rel, erro: aberta.erro }; }
  const visao = o.visao ?? { sb: (aberta as { sb: SupabaseClient }).sb, profileId: dono.id };
  const tokens = { entrada: 0, saida: 0 };
  try {
    const chave = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
    const [{ data: cfg }, { data: uso }] = await Promise.all([
      visao.sb.from("sara_modulos").select("teto_tokens_mes").eq("modulo", "warroom").maybeSingle(),
      visao.sb.rpc("sara_uso_mes", { p_modulo: "warroom" }),
    ]);
    if (Number(uso ?? 0) >= Number(cfg?.teto_tokens_mes ?? 60_000_000)) throw new Error("A SARA central atingiu o teto de uso do mês.");
    if (!chave) throw new Error("A SARA não está configurada (falta a chave do modelo).");

    // 1. Retrato da semana, só com as consultas que a visão pode usar.
    const access = await readSessionAccess(visao.sb, visao.profileId);
    const retrato: Record<string, unknown> = {};
    await Promise.all(RETRATO.map(async ([nome, entrada]) => {
      const f = FERRAMENTAS.find((x) => x.nome === nome);
      if (!f || !f.exige.some((c) => access.can(c, "ver"))) return;
      try { retrato[f.rotulo ?? nome] = JSON.stringify((await f.rodar(visao.sb, entrada)).dados).slice(0, 4000); }
      catch (e) { retrato[f.rotulo ?? nome] = `(a consulta falhou: ${e instanceof Error ? e.message.slice(0, 120) : "erro"})`; }
    }));
    // Gargalos abertos da vigia e o relatório anterior (a memória: "o que mudou").
    const [{ data: gargalos }, { data: anterior }] = await Promise.all([
      admin.from("sara_achados").select("area, titulo, situacao, impacto").eq("organization_id", dono.organization_id).in("situacao", ["aberto", "enviado", "tratando", "ajuda", "sem_responsavel"]).limit(20),
      admin.from("sara_relatorios").select("semana, conteudo").eq("organization_id", dono.organization_id).eq("situacao", "feito").neq("id", linha.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const ant = anterior?.conteudo as Relatorio | null;
    const resumoAnterior = ant ? `Semana de ${anterior?.semana}: ${ant.resumo} Ideias: ${ant.ideias.map((x) => x.titulo).join("; ")}. Investimentos: ${ant.investimentos.map((x) => x.titulo).join("; ")}.` : null;

    // 2. Pesquisa, só com o assunto.
    const hoje = agoraSP(agora).data;
    const p = await pesquisar({ chave, hoje });
    if (p) { tokens.entrada += p.uso.tokensEntrada; tokens.saida += p.uso.tokensSaida; rel.buscas = p.uso.buscas; rel.achadosDaPesquisa = p.achados.length; }

    // 3. Síntese.
    const s = await sintetizar({ chave, hoje, retrato, anterior: resumoAnterior, pesquisa: p?.achados ?? [],
      gargalos: ((gargalos ?? []) as { area: string; titulo: string; situacao: string; impacto: string }[]).map((g) => `${g.area} (${g.impacto}, ${g.situacao}): ${g.titulo}`) });
    if (!s) throw new Error("A síntese do relatório não respondeu.");
    tokens.entrada += s.uso.tokensEntrada; tokens.saida += s.uso.tokensSaida;
    const relatorio = validarRelatorio(s.bruto, Object.values(retrato), p?.achados ?? []);
    rel.relatorio = relatorio;
    await fim({ situacao: "feito", conteudo: relatorio, pesquisa: { achados: p?.achados ?? [], fontes: p?.fontes ?? [] }, modelo: CRESCIMENTO.modelo,
      tokens_entrada: tokens.entrada, tokens_saida: tokens.saida, buscas: rel.buscas });

    // 4. Aviso: o proprietário e quem tem a SARA central.
    let para = o.destinatarios;
    if (!para) {
      const [{ data: donos }, { data: grants }] = await Promise.all([
        admin.from("profiles").select("id").eq("organization_id", dono.organization_id).eq("is_owner", true).eq("status", "active"),
        admin.from("user_feature_grants").select("profile_id, profiles!inner(status)").eq("feature_code", "warroom.sara").eq("profiles.status", "active"),
      ]);
      para = [...new Set([...((donos ?? []) as { id: string }[]).map((x) => x.id), ...((grants ?? []) as { profile_id: string }[]).map((x) => x.profile_id)])];
    }
    const total = relatorio.ideias.length + relatorio.recursos.length + relatorio.concorrencia.length + relatorio.investimentos.length;
    if (para.length) await admin.from("notifications").insert(para.map((pid) => ({ organization_id: dono.organization_id, recipient_profile_id: pid, module_code: "warroom", severity: "info",
      title: "📈 Relatório de crescimento da semana", body: `${relatorio.resumo || `${total} itens`}`.slice(0, 600), action_url: "/?module=warroom&secao=Conselho" })));
    return rel;
  } catch (err) {
    const m = err instanceof Error ? err.message.slice(0, 300) : "Falhou.";
    console.error("[crescimento] falhou", m);
    await fim({ situacao: "falhou", erro: m, tokens_entrada: tokens.entrada, tokens_saida: tokens.saida, buscas: rel.buscas });
    return { ...rel, erro: m };
  } finally {
    if (aberta && !("erro" in aberta)) await aberta.sair();
  }
}
