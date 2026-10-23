import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabaseUrl, requirePublicSupabaseConfig } from "../supabase/config";
import { chaveConfigurada, conversar } from "./claude";
import { regrasDeEscopo } from "./escopo";
import { FERRAMENTAS } from "./ferramentas";
import { ACOES } from "./acoes";
import { PROPOR_HABILIDADE, instrucoesDeHabilidades, type Passo } from "./habilidades";
import { REGRA_GUIA_SOZINHA, dentroDoLimite, pedidoDaGuia, proximaExecucao, type Agenda, type Limites } from "./guias";
import { regrasDaSara } from "./modulos";
import { prepararCom } from "./sessao";
import { temaDe } from "./temas";
import { contextoDeTempo, primeiroNome, situacaoDaConversa } from "./tempo";

/**
 * Execução das guias (E3) fora da conversa: a tarefa agendada de 10 em 10 minutos chama
 * /api/sara/guias/rodar, que põe na fila as guias de agenda que venceram e roda a fila (as de evento
 * entram pela trigger do banco). Cada guia roda COMO quem a criou: o servidor abre uma sessão dela
 * (link mágico gerado e trocado aqui mesmo, sem e-mail; a sessão é encerrada no fim), então o RLS e as
 * permissões dela valem em tudo. Ação dentro do limite que a área aprovou é feita sozinha; as outras
 * ficam como cartão "Permitir" por 24 h. O resultado vira uma conversa da SARA e um aviso no sino.
 */

type Guia = { id: string; organization_id: string; modulo: string; nome: string; descricao: string; passos: Passo[]; formato: string | null; gatilho: Record<string, unknown>;
  limites: Limites; situacao: string; pausada: boolean; responsavel_id: string | null; gatilhos: string[] };
type Execucao = { id: string; organization_id: string; guia_id: string; disparo: string; evento: { resumo?: string; tipo?: string; quem?: string; quando?: string } | null; created_at: string };
export type RelatorioGuias = { enfileiradas: number; rodadas: { id: string; guia: string; situacao: string }[]; erro?: string };

/** Sessão de uma pessoa aberta pelo servidor, para a guia rodar com as permissões dela. */
export async function sessaoComo(admin: SupabaseClient, profileId: string): Promise<{ sb: SupabaseClient; sair: () => Promise<void> } | { erro: string }> {
  const { data: perfil } = await admin.from("profiles").select("user_id, status").eq("id", profileId).maybeSingle();
  if (!perfil?.user_id || perfil.status !== "active") return { erro: "Quem criou a guia não está mais ativo na plataforma." };
  const { data: u } = await admin.auth.admin.getUserById(perfil.user_id);
  const email = u?.user?.email;
  if (!email) return { erro: "Quem criou a guia não tem e-mail de acesso." };
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hash = link.data?.properties?.hashed_token;
  if (!hash) return { erro: `Não abriu a sessão: ${link.error?.message ?? "sem token"}` };
  const url = getServerSupabaseUrl();
  const { publishableKey } = requirePublicSupabaseConfig();
  if (!url) return { erro: "Configuração do banco ausente." };
  const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
  const v = await createClient(url, publishableKey, opcoes).auth.verifyOtp({ token_hash: hash, type: "magiclink" });
  const token = v.data?.session?.access_token;
  if (!token) return { erro: `Não abriu a sessão: ${v.error?.message ?? "sem sessão"}` };
  const sb = createClient(url, publishableKey, { ...opcoes, global: { headers: { Authorization: `Bearer ${token}` } } });
  return { sb, sair: async () => { await admin.auth.admin.signOut(token, "local").catch(() => null); } };
}

/** Aviso no sino quando não deu nem para abrir a sessão da pessoa (gravado pelo servidor). */
async function avisar(admin: SupabaseClient, g: Guia, titulo: string, corpo: string) {
  if (!g.responsavel_id) return;
  await admin.from("notifications").insert({ organization_id: g.organization_id, recipient_profile_id: g.responsavel_id, module_code: g.modulo, severity: "attention",
    title: titulo.slice(0, 200), body: corpo.slice(0, 600), action_url: `/?module=${g.modulo}&sara=guias` });
}

async function encerrar(admin: SupabaseClient, e: Execucao, situacao: "falhou" | "sem_permissao" | "cancelada", erro: string) {
  await admin.from("sara_guia_execucoes").update({ situacao, erro: erro.slice(0, 500), terminada_em: new Date().toISOString() }).eq("id", e.id);
}

/** Uma frase do resultado para o aviso (sem markdown e sem as linhas de tabela). */
const resumoDe = (texto: string) => texto.split("\n").filter((l) => !/^\s*\|/.test(l) && !/^\s*[-:| ]{3,}$/.test(l)).join(" ")
  .replace(/[*_#`>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 280);

async function rodarUma(admin: SupabaseClient, e: Execucao): Promise<string> {
  const { data: g } = await admin.from("sara_habilidades").select("id, organization_id, modulo, nome, descricao, passos, formato, gatilho, limites, situacao, pausada, responsavel_id, gatilhos")
    .eq("id", e.guia_id).maybeSingle<Guia>();
  if (!g || g.situacao !== "ativa" || g.pausada || !g.responsavel_id) { await encerrar(admin, e, "cancelada", "A guia não está mais ativa."); return "cancelada"; }
  const s = await sessaoComo(admin, g.responsavel_id);
  if ("erro" in s) {
    await encerrar(admin, e, "falhou", s.erro);
    await avisar(admin, g, `⚡ Guia «${g.nome}» não rodou`, s.erro);
    return "falhou";
  }
  let pendentes = 0, feitas = 0;
  try {
    const p = await prepararCom(s.sb, g.modulo);
    if ("erro" in p) {
      await encerrar(admin, e, "sem_permissao", "Você não tem mais a SARA deste módulo.");
      await avisar(admin, g, `⚡ Guia «${g.nome}» não rodou`, "Você não tem mais permissão para a SARA deste módulo. Fale com quem cuida dos acessos.");
      return "sem_permissao";
    }
    const faltam = g.passos.filter((x) => !p.ferramentas.some((f) => f.nome === x.ferramenta)).map((x) => x.ferramenta);
    if (faltam.length) {
      await encerrar(admin, e, "sem_permissao", `Sem permissão para: ${faltam.join(", ")}.`);
      await avisar(admin, g, `⚡ Guia «${g.nome}» não rodou`, `Você não tem mais permissão para uma parte da guia (${faltam.join(", ")}). Fale com quem cuida dos acessos.`);
      return "sem_permissao";
    }
    if (!chaveConfigurada()) throw new Error("A SARA não está configurada (falta a chave do modelo).");
    const { data: uso } = await s.sb.rpc("sara_uso_mes", { p_modulo: g.modulo });
    if (Number(uso ?? 0) >= p.cfg.teto_tokens_mes) throw new Error("A SARA deste módulo atingiu o limite de uso do mês.");
    const [{ data: me }, { data: org }] = await Promise.all([
      s.sb.from("profiles").select("full_name").eq("id", g.responsavel_id).maybeSingle(),
      s.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle(),
    ]);
    const empresa = org?.display_name || org?.legal_name || "empresa";
    const sistema = {
      fixo: `${p.sara.manual}\n\n${regrasDaSara(p.sara)}\n\n${regrasDeEscopo(empresa, p.sara.rotulo, temaDe(g.modulo))}${p.habilidades.length ? `\n\n${instrucoesDeHabilidades(p.habilidades)}` : ""}`,
      variavel: `${contextoDeTempo({ nome: primeiroNome(me?.full_name), situacao: situacaoDaConversa(null) })}\n${REGRA_GUIA_SOZINHA}\nResponda sempre em português do Brasil.`,
    };
    // Memória da guia: o resultado da última execução feita vai junto, para a SARA dizer o que mudou.
    const { data: ultima } = await admin.from("sara_guia_execucoes").select("mensagem_id, terminada_em").eq("guia_id", g.id).eq("situacao", "feita")
      .not("mensagem_id", "is", null).neq("id", e.id).order("terminada_em", { ascending: false }).limit(1).maybeSingle();
    const { data: msgAnterior } = ultima?.mensagem_id ? await admin.from("sara_mensagens").select("texto").eq("id", ultima.mensagem_id).maybeSingle() : { data: null };
    const anterior = msgAnterior?.texto && ultima?.terminada_em ? { quando: ultima.terminada_em, texto: msgAnterior.texto } : null;
    // Na guia, sem propor habilidade nem criar outra guia.
    const ferramentas = p.ferramentas.filter((f) => f.nome !== "criar_guia" && f.nome !== PROPOR_HABILIDADE.nome);
    const r = await conversar(s.sb, { modelo: p.cfg.modelo, sistema, historico: [], pergunta: pedidoDaGuia(g, e.disparo, e.evento, anterior), ferramentas,
      todasAsConsultas: [...FERRAMENTAS.map((f) => f.nome), ...ACOES.map((f) => f.nome), "consultar_dados", "buscar_documentos_do_setor"], maxTokens: p.sara.maxTokens });
    const QUANDO: Record<string, string> = { agenda: "pela agenda", evento: "por um acontecimento", manual: "Rodar agora" };
    const { data: reg, error: eReg } = await s.sb.rpc("sara_registrar", {
      p_conversa: null, p_modulo: g.modulo, p_pergunta: `⚡ Guia «${g.nome}» · ${QUANDO[e.disparo] ?? e.disparo}${e.evento?.resumo ? ` · ${e.evento.resumo}` : ""}`, p_resposta: r.texto,
      p_ferramentas: { usadas: r.ferramentas, fontes: r.fontes, abriu: r.abrir, visuais: r.visuais, cache: { lido: r.cacheLido, gravado: r.cacheGravado }, guia: { id: g.id, execucao: e.id } },
      p_modelo: r.modelo, p_tokens_entrada: r.tokensEntrada, p_tokens_saida: r.tokensSaida,
    });
    if (eReg) throw new Error(`não registrou a conversa: ${eReg.message}`);
    const ids = reg as { conversa: string; mensagem: string };
    for (const a of r.acoes) {
      const base = { p_conversa: ids.conversa, p_mensagem: ids.mensagem, p_modulo: g.modulo, p_ferramenta: a.ferramenta, p_entrada: a.entrada, p_resumo: a.resumo, p_detalhes: a.detalhes, p_risco: a.risco ?? "normal", p_execucao: e.id };
      const hoje = new Date(Date.parse(`${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00-03:00`)).toISOString();
      const { count } = await s.sb.from("sara_acoes").select("id", { count: "exact", head: true }).eq("guia_id", g.id).eq("ferramenta", a.ferramenta).eq("automatica", true).gte("created_at", hoje);
      const limite = dentroDoLimite(g.limites?.[a.ferramenta], a.entrada, count ?? 0);
      const f = ferramentas.find((x) => x.nome === a.ferramenta && x.acao);
      if (limite.sozinha && f && a.risco !== "alto") {
        // Dentro do limite da área: a guia faz sozinha (o banco confere o limite de novo).
        const { data: id, error: e1 } = await s.sb.rpc("sara_acao_propor", { ...base, p_validade_min: 15, p_automatica: true });
        if (!e1 && id) {
          const { error: e2 } = await s.sb.rpc("sara_acao_decidir", { p_id: id, p_permitir: true });
          if (!e2) {
            let ok = false, resultado: Record<string, unknown> | null = null, erro: string | null = null;
            try { const x = await f.rodar(s.sb, a.entrada); ok = true; resultado = (x.dados ?? null) as Record<string, unknown> | null; }
            catch (err) { erro = err instanceof Error ? err.message.slice(0, 300) : "Falhou."; }
            await s.sb.rpc("sara_acao_concluir", { p_id: id, p_ok: ok, p_resultado: resultado, p_erro: erro });
            if (ok) { feitas++; continue; }
          }
        }
      }
      // Fora do limite (ou sem limite): cartão "Permitir" esperando a pessoa por 24 h.
      const { error: e3 } = await s.sb.rpc("sara_acao_propor", { ...base, p_validade_min: 1440 });
      if (e3) console.error("[sara] guia: não registrou a ação", e3.message); else pendentes++;
    }
    const { error: eFim } = await s.sb.rpc("sara_guia_concluir", { p_execucao: e.id, p_situacao: "feita", p_conversa: ids.conversa, p_mensagem: ids.mensagem,
      p_resumo: resumoDe(r.texto), p_pendentes: pendentes, p_feitas: feitas, p_erro: null });
    if (eFim) throw new Error(`não concluiu: ${eFim.message}`);
    return "feita";
  } catch (err) {
    const m = err instanceof Error ? err.message.slice(0, 300) : "Falhou.";
    console.error("[sara] guia falhou", g.id, m);
    const { error } = await s.sb.rpc("sara_guia_concluir", { p_execucao: e.id, p_situacao: "falhou", p_conversa: null, p_mensagem: null, p_resumo: null, p_pendentes: pendentes, p_feitas: feitas, p_erro: m });
    if (error) { await encerrar(admin, e, "falhou", m); await avisar(admin, g, `⚡ Guia «${g.nome}» não rodou`, m); }
    return "falhou";
  } finally {
    await s.sair();
  }
}

/** Põe na fila as guias de agenda que venceram, limpa a fila velha e roda até `max` execuções. */
export async function rodarFilaDasGuias(admin: SupabaseClient, { max = 3, agora = new Date() }: { max?: number; agora?: Date } = {}): Promise<RelatorioGuias> {
  let enfileiradas = 0;
  // Agenda: a primeira vez só marca a próxima; vencida, entra na fila e anda para a próxima.
  const { data: agendadas, error } = await admin.from("sara_habilidades").select("id, organization_id, gatilho, proxima_em")
    .eq("tipo", "guia").eq("situacao", "ativa").eq("pausada", false).eq("gatilho->>tipo", "agenda");
  if (error) return { enfileiradas, rodadas: [], erro: error.message };
  for (const g of agendadas ?? []) {
    const prox = proximaExecucao(g.gatilho as Agenda, agora)?.toISOString() ?? null;
    if (!g.proxima_em) { await admin.from("sara_habilidades").update({ proxima_em: prox }).eq("id", g.id); continue; }
    if (Date.parse(g.proxima_em) > agora.getTime()) continue;
    const { count } = await admin.from("sara_guia_execucoes").select("id", { count: "exact", head: true }).eq("guia_id", g.id).in("situacao", ["na_fila", "rodando"]);
    if (!count) { await admin.from("sara_guia_execucoes").insert({ organization_id: g.organization_id, guia_id: g.id, disparo: "agenda" }); enfileiradas++; }
    await admin.from("sara_habilidades").update({ proxima_em: prox }).eq("id", g.id);
  }
  // Fila velha: rodando há mais de 30 min (o processo caiu) falhou; na fila há mais de 24 h, cancelada.
  const ha = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();
  await admin.from("sara_guia_execucoes").update({ situacao: "falhou", erro: "Interrompida (o servidor reiniciou durante a execução).", terminada_em: agora.toISOString() })
    .eq("situacao", "rodando").lt("iniciada_em", ha(30));
  await admin.from("sara_guia_execucoes").update({ situacao: "cancelada", erro: "Ficou mais de 24 h na fila.", terminada_em: agora.toISOString() })
    .eq("situacao", "na_fila").lt("created_at", ha(24 * 60));
  const { data: fila } = await admin.from("sara_guia_execucoes").select("id, organization_id, guia_id, disparo, evento, created_at")
    .eq("situacao", "na_fila").order("created_at").limit(max);
  const rodadas: RelatorioGuias["rodadas"] = [];
  for (const e of (fila ?? []) as Execucao[]) {
    // Pega a execução (só uma tarefa por vez fica com ela).
    const { data: peguei } = await admin.from("sara_guia_execucoes").update({ situacao: "rodando", iniciada_em: new Date().toISOString() })
      .eq("id", e.id).eq("situacao", "na_fila").select("id");
    if (!peguei?.length) continue;
    rodadas.push({ id: e.id, guia: e.guia_id, situacao: await rodarUma(admin, e) });
  }
  return { enfileiradas, rodadas };
}
