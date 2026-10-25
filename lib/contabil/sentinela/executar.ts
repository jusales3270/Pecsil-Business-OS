import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { filtrarEstado } from "../../decisao/guard";
import { atuais, type Parametro } from "../parametros";
import { extrair, type Candidato, type TeseCandidata } from "./extracao";
import { chaveDoItem, lerDoeSp, lerFeed, lerFeriados, lerSenado, lerSerieBcb, textoDeHtml, type ItemFonte } from "./feeds";
import { triar, type NivelFonte, type TeseVigiada } from "./triagem";

/**
 * Sentinela (N-02): uma rodada. Quem chama é a tarefa agendada (scripts/sync-os-cron.mjs, de 10 em 10
 * minutos); cada fonte só é lida quando passou a cadência dela. Uma fonte com erro não para as outras.
 * Desenho em docs/PLANO-CONTABIL-FISCAL.md §4; fontes em docs/contabil/fontes-sentinela.md.
 */

type Fonte = {
  id: string; nome: string; url: string; formato: "feed" | "senado" | "doe_sp" | "bcb_sgs" | "feriados"; nivel: NivelFonte; tribunal: string | null;
  cadencia_min: number; config: Record<string, unknown>; ultima_coleta_em: string | null; coletas: number; itens: number;
};
type Config = { enviar_decisoes: boolean; janela_dias: number; max_extracoes_dia: number };
export type OpcoesSentinela = { agora?: Date; buscar?: typeof fetch; chaveModelo?: string; somente?: string[]; forcar?: boolean; responsaveis?: string[] };
export type Relatorio = { fontes: number; itensNovos: number; relevantes: number; propostas: number; automaticos: number; extracoes: number; erros: { fonte: string; erro: string }[]; rodada?: string };

export const UA = "ECOS-Sentinela/1.0 (monitor de legislacao; contato: jusales3270@gmail.com)";
const HOSTS_OFICIAIS = /(^|\.)(gov\.br|jus\.br|leg\.br|cgibs\.gov\.br)$/i;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const ultimoDiaDoMes = (competencia: string) => { const [a, m] = competencia.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };

async function baixar(buscar: typeof fetch, url: string, tipo: "texto" | "json") {
  const r = await buscar(url, { headers: { "user-agent": UA, accept: tipo === "json" ? "application/json" : "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html" }, redirect: "follow", signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return tipo === "json" ? r.json() : r.text();
}

/** Os itens de uma fonte de notícias, leis ou atos. */
async function lerFonte(buscar: typeof fetch, f: Fonte, agora: Date): Promise<ItemFonte[]> {
  if (f.formato === "feed") return lerFeed(await baixar(buscar, f.url, "texto") as string);
  if (f.formato === "senado") {
    const ano = agora.getUTCFullYear();
    const tipos = Array.isArray(f.config.tipos) ? (f.config.tipos as string[]) : ["LEI"];
    const listas = await Promise.all(tipos.map(async (t) => lerSenado(await baixar(buscar, `${f.url}?tipo=${encodeURIComponent(t)}&ano=${ano}`, "json"))));
    return listas.flat();
  }
  if (f.formato === "doe_sp") {
    const ate = agora.toISOString().slice(0, 10);
    const de = new Date(agora.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
    const termos = Array.isArray(f.config.termos) ? (f.config.termos as string[]) : ["ICMS"];
    const listas = await Promise.all(termos.map(async (t) => lerDoeSp(await baixar(buscar, `${f.url}?Terms=${encodeURIComponent(t)}&FromDate=${de}&ToDate=${ate}&PageSize=50&PageNumber=1`, "json"))));
    return listas.flat();
  }
  return [];
}

/** Dado de API oficial (nível automático): entra na hora, sem proposta. Devolve quantos mudaram. */
async function aplicarDadoDeApi(admin: SupabaseClient, buscar: typeof fetch, f: Fonte, agora: Date): Promise<number> {
  const chave = String(f.config.chave ?? "");
  const titulo = String(f.config.titulo ?? f.nome);
  let mudou = 0;
  if (f.formato === "bcb_sgs") {
    // Só mês fechado: a Selic "acumulada no mês" do mês corrente ainda é parcial.
    const mesAtual = agora.toISOString().slice(0, 7);
    for (const p of lerSerieBcb(await baixar(buscar, f.url, "json")).filter((x) => x.competencia < mesAtual)) {
      const { data, error } = await admin.rpc("contabil_sentinela_automatico", { p: {
        chave, titulo, competencia: p.competencia, valor: { competencia: p.competencia, taxa_percentual: p.valor }, vigente_de: `${p.competencia}-01`, vigente_ate: ultimoDiaDoMes(p.competencia),
        fonte: { norma: String(f.config.norma ?? f.nome), url: f.url }, observacao: "Valor do mês publicado pelo Banco Central; entra automático (dado de API oficial).",
      } });
      if (error) throw new Error(error.message);
      if (data) mudou++;
    }
  }
  if (f.formato === "feriados") {
    const ano = agora.getUTCFullYear();
    for (const a of [ano, ano + 1]) {
      const datas = lerFeriados(await baixar(buscar, `${f.url}${a}`, "json"));
      if (!datas.length) continue;
      const { data, error } = await admin.rpc("contabil_sentinela_automatico", { p: {
        chave, titulo: `${titulo}`, competencia: String(a), valor: { ano: a, datas }, vigente_de: `${a}-01-01`, vigente_ate: `${a}-12-31`,
        fonte: { norma: "Lei 662/1949, Lei 6.802/1980, Lei 10.607/2002 e Lei 14.759/2023 (lista da BrasilAPI)", url: `${f.url}${a}` }, observacao: "Feriados nacionais do ano; os estaduais e municipais entram pela camada da UF e do município.",
      } });
      if (error) throw new Error(error.message);
      if (data) mudou++;
    }
  }
  return mudou;
}

/** Texto para a extração: o do feed quando é longo; senão a página da fonte oficial. */
async function textoDoItem(buscar: typeof fetch, f: Fonte, item: ItemFonte) {
  if (item.resumo.length >= 800 || f.nivel === "imprensa") return item.resumo;
  try {
    const host = new URL(item.url).hostname;
    if (!HOSTS_OFICIAIS.test(host)) return item.resumo;
    const html = await baixar(buscar, item.url, "texto") as string;
    const corpo = html.match(/<(article|main)[\s\S]*?<\/\1>/i)?.[0] ?? html;
    return `${item.resumo}\n${textoDeHtml(corpo)}`.slice(0, 18_000);
  } catch { return item.resumo; }
}

export async function rodarSentinela(admin: SupabaseClient, o: OpcoesSentinela = {}): Promise<Relatorio> {
  const agora = o.agora ?? new Date();
  const buscar = o.buscar ?? fetch;
  const chaveModelo = o.chaveModelo ?? process.env.ANTHROPIC_API_KEY ?? "";
  const rel: Relatorio = { fontes: 0, itensNovos: 0, relevantes: 0, propostas: 0, automaticos: 0, extracoes: 0, erros: [] };
  let tokens = { entrada: 0, saida: 0 };

  const [{ data: cfg }, { data: fontesDb }, { data: tesesDb }, { data: paramsDb }] = await Promise.all([
    admin.from("contabil_sentinela_config").select("enviar_decisoes, janela_dias, max_extracoes_dia").single(),
    admin.from("contabil_fontes").select("id, nome, url, formato, nivel, tribunal, cadencia_min, config, ultima_coleta_em, coletas, itens").eq("ativa", true).order("id"),
    admin.from("contabil_teses").select("id, tribunal, tema, titulo, situacao, modulacao"),
    admin.from("contabil_parametros").select("id, chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao, situacao"),
  ]);
  const config = (cfg ?? { enviar_decisoes: false, janela_dias: 10, max_extracoes_dia: 40 }) as Config;
  const teses = (tesesDb ?? []) as (TeseVigiada & TeseCandidata)[];
  const vigentes = new Map(atuais((paramsDb ?? []) as Parametro[], agora.toISOString().slice(0, 10)).map((p) => [p.chave, p]));
  const devidas = ((fontesDb ?? []) as Fonte[]).filter((f) => (!o.somente || o.somente.includes(f.id))
    && (o.forcar || !f.ultima_coleta_em || agora.getTime() - Date.parse(f.ultima_coleta_em) >= f.cadencia_min * 60_000));
  if (!devidas.length) return rel;

  const inicioDoDia = new Date(Date.parse(`${agora.toISOString().slice(0, 10)}T03:00:00Z`)).toISOString();
  const { count: jaExtraidas } = await admin.from("contabil_propostas").select("id", { count: "exact", head: true }).eq("origem", "modelo").gte("created_at", inicioDoDia);
  let orcamento = Math.max(0, config.max_extracoes_dia - (jaExtraidas ?? 0));
  const { data: rodada } = await admin.from("contabil_sentinela_rodadas").insert({ iniciada_em: agora.toISOString() }).select("id").single();
  rel.rodada = rodada?.id;
  const novasPropostas: string[] = [];

  for (const f of devidas) {
    rel.fontes++;
    const primeira = !f.ultima_coleta_em;
    try {
      if (f.nivel === "dado_api") {
        rel.automaticos += await aplicarDadoDeApi(admin, buscar, f, agora);
        await admin.from("contabil_fontes").update({ ultima_coleta_em: agora.toISOString(), ultimo_item_em: agora.toISOString(), ultimo_erro: null, coletas: f.coletas + 1 }).eq("id", f.id);
        continue;
      }
      const lidos = await lerFonte(buscar, f, agora);
      const linhas = lidos.map((i) => ({ item: i, hash: hash(chaveDoItem(f.id, i)) }));
      const unicos = [...new Map(linhas.map((l) => [l.hash, l])).values()];
      let novos: { id: string; hash: string }[] = [];
      if (unicos.length) {
        const { data, error } = await admin.from("contabil_itens").upsert(
          unicos.map(({ item, hash: h }) => ({ fonte_id: f.id, hash: h, titulo: item.titulo, url: item.url, publicado_em: item.data, resumo: f.nivel === "imprensa" ? null : item.resumo.slice(0, 4000) || null, situacao: "historico" })),
          { onConflict: "hash", ignoreDuplicates: true },
        ).select("id, hash");
        if (error) throw new Error(error.message);
        novos = (data ?? []) as { id: string; hash: string }[];
      }
      rel.itensNovos += novos.length;
      const porHash = new Map(unicos.map((l) => [l.hash, l.item]));
      for (const n of novos) {
        const item = porHash.get(n.hash)!;
        const publicado = item.data ? Date.parse(item.data) : agora.getTime();
        const recente = agora.getTime() - publicado <= config.janela_dias * 86_400_000;
        const t = triar(item, f.nivel, { teses, tribunal: f.tribunal });
        // Primeira leitura da fonte ou item antigo: fica como histórico (não inunda a curadoria com o passado).
        if (primeira || !recente) { await admin.from("contabil_itens").update({ triagem: t }).eq("id", n.id); continue; }
        if (!t.relevante) { await admin.from("contabil_itens").update({ triagem: t, situacao: "ignorado" }).eq("id", n.id); continue; }
        rel.relevantes++;
        const candidatos: Candidato[] = t.chaves.flatMap((c) => { const p = vigentes.get(c); return p ? [{ chave: c, titulo: p.titulo, valor: p.valor }] : []; }).slice(0, 4);
        const tesesCand = teses.filter((x) => t.teses.includes(x.id));
        const horas = Math.max(0, (agora.getTime() - publicado) / 3_600_000);
        const base = { item_id: n.id, fonte_id: f.id, titulo: item.titulo.slice(0, 400), url: item.url, chaves_triagem: t.chaves, horas_ate_proposta: Number(horas.toFixed(1)) };
        let proposta: Record<string, unknown> | null = null;
        if (f.nivel !== "imprensa" && chaveModelo && orcamento > 0) {
          const texto = await textoDoItem(buscar, f, item);
          const filtro = filtrarEstado(texto);
          if (!filtro.ok) {
            proposta = { ...base, tipo: "sinal", resumo: t.motivos.join("; "), confianca: "baixa", origem: "regra", avisos: [`o texto tem ${filtro.motivos.join(" e ")}: não foi enviado ao modelo`] };
          } else {
            orcamento--;
            rel.extracoes++;
            const r = await extrair({ chave: chaveModelo, buscar, fonte: f.nome, titulo: item.titulo, url: item.url, texto, candidatos, teses: tesesCand });
            if (r) {
              tokens = { entrada: tokens.entrada + r.tokensEntrada, saida: tokens.saida + r.tokensSaida };
              const e = r.extracao;
              if (!e.mudaRegra) { await admin.from("contabil_itens").update({ triagem: t, situacao: "analisado" }).eq("id", n.id); continue; }
              proposta = {
                ...base, tipo: e.tipo, chave: e.chave, tese_id: e.teseId, resumo: e.resumo, vigente_de: e.vigenteDe, norma: e.norma, trecho: e.trecho, confianca: e.confianca,
                valor_proposto: e.tipo === "tese" ? (e.teseSituacao || e.teseModulacao ? { situacao: e.teseSituacao, modulacao: e.teseModulacao } : null) : e.valorProposto,
                origem: "modelo", modelo: r.modelo, avisos: e.avisos,
              };
            }
          }
        }
        proposta ??= { ...base, tipo: "sinal", resumo: `Pode mexer em: ${t.motivos.join("; ")}.`, confianca: f.nivel === "imprensa" ? "baixa" : "media", origem: "regra", avisos: f.nivel === "imprensa" ? ["imprensa: só sinal, nunca muda regra"] : [] };
        const { data: criada, error: eP } = await admin.from("contabil_propostas").insert(proposta).select("id, tipo, valor_proposto, confianca").single();
        if (eP) throw new Error(eP.message);
        rel.propostas++;
        if (criada && criada.confianca !== "baixa" && ((criada.tipo === "parametro" && criada.valor_proposto) || criada.tipo === "tese")) novasPropostas.push(criada.id);
        await admin.from("contabil_itens").update({ triagem: t, situacao: proposta.tipo === "sinal" ? "sinal" : "proposta" }).eq("id", n.id);
      }
      await admin.from("contabil_fontes").update({
        ultima_coleta_em: agora.toISOString(), ultimo_erro: null, coletas: f.coletas + 1, itens: f.itens + novos.length,
        ...(novos.length ? { ultimo_item_em: agora.toISOString() } : {}),
      }).eq("id", f.id);
    } catch (err) {
      const m = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      rel.erros.push({ fonte: f.id, erro: m });
      await admin.from("contabil_fontes").update({ ultima_coleta_em: agora.toISOString(), ultimo_erro: m, ultimo_erro_em: agora.toISOString(), coletas: f.coletas + 1 }).eq("id", f.id);
    }
  }

  if (config.enviar_decisoes && novasPropostas.length) await enviarDecisoes(admin, novasPropostas, o.responsaveis);
  if (rodada?.id) {
    await admin.from("contabil_sentinela_rodadas").update({
      terminada_em: new Date().toISOString(), situacao: "feita", fontes: rel.fontes, itens_novos: rel.itensNovos, relevantes: rel.relevantes, propostas: rel.propostas,
      automaticos: rel.automaticos, extracoes: rel.extracoes, tokens_entrada: tokens.entrada, tokens_saida: tokens.saida, erros: rel.erros,
    }).eq("id", rodada.id);
  }
  return rel;
}

/** Quem responde pelo Fiscal recebe a proposta em "Decisões para você" (só com o envio ligado). */
async function enviarDecisoes(admin: SupabaseClient, ids: string[], somente?: string[]) {
  const { data: curadora } = await admin.from("contabil_curadoria").select("organization_id").single();
  if (!curadora) return;
  const { data: resp } = await admin.from("sara_responsaveis").select("profile_id").eq("organization_id", curadora.organization_id).eq("modulo", "fiscal");
  const pessoas = somente ?? ((resp ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
  if (!pessoas.length) return;
  const { data: propostas } = await admin.from("contabil_propostas").select("id, tipo, chave, titulo, resumo, norma, url, trecho, confianca, origem, vigente_de").in("id", ids);
  for (const p of propostas ?? []) {
    for (const pid of pessoas) {
      const { data: perfil } = await admin.from("profiles").select("full_name").eq("id", pid).maybeSingle();
      const detalhes = [
        p.origem === "modelo" ? `Sugestão do modelo (confiança ${p.confianca}); confira na norma antes de aprovar.` : "Apontado pela regra da Sentinela.",
        p.resumo ? `O que muda: ${p.resumo}` : null,
        p.vigente_de ? `Vale a partir de ${String(p.vigente_de).split("-").reverse().join("/")}.` : null,
        p.norma ? `Norma: ${p.norma}` : null,
        p.trecho ? `Trecho: "${p.trecho}"` : null,
        `Fonte: ${p.url}`,
      ].filter(Boolean).map((x) => String(x).slice(0, 500));
      const { data: dec } = await admin.from("decisoes").insert({
        organization_id: curadora.organization_id, chave: `sentinela.${p.id}`, origem: "contabil.sentinela", modulo: "fiscal",
        assunto: `Sentinela: ${p.titulo}`.slice(0, 160), pergunta: p.tipo === "tese" ? "Atualizar a tese com esta decisão?" : "Aplicar esta mudança nos parâmetros legais?",
        detalhes, opcoes: ["Aprovar", "Recusar"], para_profile_id: pid, para_nome: perfil?.full_name ?? null, criada_por_nome: "Sentinela (Contábil-Fiscal)",
      }).select("id").single();
      if (dec) await admin.from("contabil_propostas").update({ decisao_id: dec.id }).eq("id", p.id);
    }
  }
}
