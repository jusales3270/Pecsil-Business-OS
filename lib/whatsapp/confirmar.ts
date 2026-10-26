import type { SupabaseClient } from "@supabase/supabase-js";
import { sessaoComo } from "../sara/guias-executar";
import { prepararCom } from "../sara/sessao";
import { apagarMensagem, enviarInterativo, enviarTexto } from "./evolution";
import { inicioDoDia, LIBERADAS_PELO_PROPRIETARIO, OPCOES_ENQUETE, PODE_PELO_WHATSAPP, perguntaDaEnquete, podeVirarEnquete, VALIDADE_ENQUETE_MS, type AcaoPendente } from "./confirmar-regras";
import type { Escolha } from "./mensagem";

/**
 * Confirmar pelo WhatsApp (PLANO-WHATSAPP §5, por enquete desde 25/10/2026): a ação que a SARA preparou numa conversa
 * do WhatsApp vira uma enquete "Sim / Não" quando a área dona da ação liberou (sara_whatsapp_confirmar) e a pessoa
 * está dentro do limite do dia. Só o PRIMEIRO voto vale: a enquete sai de 'aberta' uma vez só e é apagada para todos;
 * voto trocado, retirado ou repetido é ignorado em silêncio. "Sim" faz o mesmo que o Permitir da tela, com a sessão
 * da pessoa (o banco confere a permissão de novo). Fora disso, segue o link para o Permitir.
 */

type Canal = { id: string; organization_id: string; instancia: string };
type DepsEnquete = { enviarInterativo: typeof enviarInterativo; enviarTexto: typeof enviarTexto; apagarMensagem: typeof apagarMensagem };

/**
 * Das ações pendentes da resposta, a que vai virar enquete (só quando é UMA, para a pessoa saber o que confirma).
 * Nula: segue o link para o Permitir.
 */
export async function avaliarEnquete(admin: SupabaseClient, perfil: string, contato: string, ids: string[]): Promise<AcaoPendente | null> {
  if (ids.length !== 1) return null;
  const { data: a } = await admin.from("sara_acoes").select("id, organization_id, modulo, ferramenta, resumo, risco, situacao, expira_em, profile_id").eq("id", ids[0]).maybeSingle<AcaoPendente>();
  if (!a || !(PODE_PELO_WHATSAPP[a.ferramenta] || LIBERADAS_PELO_PROPRIETARIO[a.ferramenta])) return null;
  const [{ data: liberada }, { count }, { count: abertas }] = await Promise.all([
    admin.from("sara_whatsapp_confirmar").select("ate_por_dia").eq("organization_id", a.organization_id).eq("ferramenta", a.ferramenta).maybeSingle<{ ate_por_dia: number }>(),
    admin.from("whatsapp_enquetes").select("id", { count: "exact", head: true }).eq("profile_id", perfil).eq("ferramenta", a.ferramenta).eq("situacao", "respondida").eq("resposta", "Sim").gte("respondida_em", inicioDoDia()),
    admin.from("whatsapp_enquetes").select("id", { count: "exact", head: true }).eq("contato_id", contato).eq("situacao", "aberta").gt("expira_em", new Date().toISOString()),
  ]);
  const r = podeVirarEnquete(a, { perfil, liberada: liberada ?? null, usadasHoje: count ?? 0, temAberta: (abertas ?? 0) > 0 });
  return r.ok ? a : null;
}

/** Manda a enquete e registra (vale 15 minutos, ou menos se a proposta vencer antes). Devolve se saiu. */
export async function mandarEnquete(admin: SupabaseClient, d: Pick<DepsEnquete, "enviarInterativo">, canal: Canal, contato: string, perfil: string, numero: string, a: AcaoPendente): Promise<boolean> {
  try {
    const r = await d.enviarInterativo(canal.instancia, "enquete", numero, perguntaDaEnquete(a.resumo), OPCOES_ENQUETE);
    if (!r.id) return false;
    const expira = Math.min(Date.parse(a.expira_em), Date.now() + VALIDADE_ENQUETE_MS);
    const { error } = await admin.from("whatsapp_enquetes").insert({ organization_id: canal.organization_id, canal_id: canal.id, contato_id: contato, profile_id: perfil,
      acao_id: a.id, ferramenta: a.ferramenta, wa_id: r.id, opcoes: OPCOES_ENQUETE.map((o) => o.texto), expira_em: new Date(expira).toISOString() });
    if (error) { console.error("[whatsapp] enquete sem registro", error.message); return false; }
    return true;
  } catch (e) { console.error("[whatsapp] enquete", e instanceof Error ? e.message : e); return false; }
}

/** Registra a enquete do teste de Fundação › WhatsApp (sem ação): a mesma trava do primeiro voto. */
export async function registrarEnqueteDeTeste(admin: SupabaseClient, canal: Canal, numero: string, waId: string | null): Promise<void> {
  if (!waId) return;
  const { data: contato } = await admin.from("whatsapp_contatos").select("id, profile_id").eq("canal_id", canal.id).eq("numero", numero).maybeSingle<{ id: string; profile_id: string | null }>();
  const { error } = await admin.from("whatsapp_enquetes").insert({ organization_id: canal.organization_id, canal_id: canal.id, contato_id: contato?.id ?? null, profile_id: contato?.profile_id ?? null,
    wa_id: waId, opcoes: OPCOES_ENQUETE.map((o) => o.texto), expira_em: new Date(Date.now() + VALIDADE_ENQUETE_MS).toISOString() });
  if (error) console.error("[whatsapp] enquete de teste sem registro", error.message);
}

type Enquete = { id: string; contato_id: string | null; acao_id: string | null; situacao: string; expira_em: string };
export type ResultadoVoto = { situacao: "respondida" | "ignorada"; motivo: string; respostas: number };

/**
 * O voto numa enquete. Só o primeiro vale (update condicionado a 'aberta' — dois votos ao mesmo tempo não passam os
 * dois). Depois dele a enquete é apagada para todos e fica a mensagem com a resposta registrada.
 */
export async function receberVoto(admin: SupabaseClient, d: DepsEnquete, canal: Canal, contato: string, perfil: string, numero: string, jidChat: string, e: Escolha): Promise<ResultadoVoto> {
  const ignorar = (motivo: string): ResultadoVoto => ({ situacao: "ignorada", motivo, respostas: 0 });
  if (!e.enquete) return ignorar("enquete_sem_id");
  // Voto retirado (desmarcou tudo): não é resposta.
  if (!e.texto) return ignorar("voto_retirado");
  const agora = new Date().toISOString();
  const { data: ganhou } = await admin.from("whatsapp_enquetes").update({ situacao: "respondida", resposta: e.texto.slice(0, 100), respondida_em: agora })
    .eq("canal_id", canal.id).eq("wa_id", e.enquete.waId).eq("contato_id", contato).eq("situacao", "aberta").gt("expira_em", agora)
    .select("id, contato_id, acao_id, situacao, expira_em").maybeSingle<Enquete>();
  const apagar = () => d.apagarMensagem(canal.instancia, e.enquete?.jid || jidChat, e.enquete!.waId);
  const responder = async (texto: string) => { await d.enviarTexto(canal.instancia, numero, texto); return 1; };

  if (!ganhou) {
    const { data: x } = await admin.from("whatsapp_enquetes").select("id, contato_id, acao_id, situacao, expira_em").eq("canal_id", canal.id).eq("wa_id", e.enquete.waId).maybeSingle<Enquete>();
    if (!x) return ignorar("enquete_desconhecida");
    if (x.contato_id !== contato) return ignorar("enquete_de_outro");
    if (x.situacao !== "aberta") return ignorar("voto_repetido");
    // Venceu: avisa uma vez (a linha sai de 'aberta') e apaga a enquete.
    const { data: venceu } = await admin.from("whatsapp_enquetes").update({ situacao: "vencida" }).eq("id", x.id).eq("situacao", "aberta").select("id").maybeSingle();
    if (!venceu) return ignorar("voto_repetido");
    await apagar();
    return { situacao: "respondida", motivo: "enquete_vencida", respostas: await responder("Essa confirmação venceu (vale 15 minutos) e nada foi feito. Se ainda precisar, peça de novo.") };
  }

  await apagar();
  if (!ganhou.acao_id) return { situacao: "respondida", motivo: "enquete_teste", respostas: await responder(`Resposta registrada: "${e.texto}". Era só teste: nada foi feito.`) };

  const { data: acao } = await admin.from("sara_acoes").select("modulo, resumo").eq("id", ganhou.acao_id).maybeSingle<{ modulo: string; resumo: string }>();
  const sim = e.texto === "Sim";
  const s = await sessaoComo(admin, perfil);
  if ("erro" in s) return { situacao: "respondida", motivo: "sem_sessao", respostas: await responder("Não consegui confirmar agora: o seu acesso à plataforma não está ativo.") };
  try {
    const titulo = `${sim ? "✅" : "✖️"} ${acao?.resumo ?? "Ação"} (${e.texto})`;
    const p = acao ? await prepararCom(s.sb, acao.modulo) : null;
    if (!p || "erro" in p) return { situacao: "respondida", motivo: "sem_permissao", respostas: await responder(`${titulo}\nNão foi feito: você não tem mais acesso a essa SARA.`) };
    const r = await executarAcao(s.sb, p, ganhou.acao_id, sim);
    const motivo = { executada: "executada", falhou: "falhou", expirada: "acao_expirada", recusada: "recusada", ja_decidida: "ja_decidida" }[r.situacao];
    return { situacao: "respondida", motivo, respostas: await responder(`${titulo}\n${r.texto}`) };
  } finally { await s.sair(); }
}

type Preparada = Exclude<Awaited<ReturnType<typeof prepararCom>>, { erro: unknown }>;
export type Execucao = { situacao: "executada" | "falhou" | "expirada" | "recusada" | "ja_decidida"; texto: string };

/**
 * Decide uma ação preparada, como o Permitir da tela (app/api/sara/[modulo]/acoes/[id]): sara_acao_decidir confere de
 * novo a permissão, a ferramenta roda com a sessão da pessoa e o resultado fica no histórico. Usada pelo voto da
 * enquete e pela entrega direta do que é para a própria pessoa.
 */
export async function executarAcao(sb: SupabaseClient, p: Preparada, acaoId: string, permitir: boolean): Promise<Execucao> {
  const { data, error } = await sb.rpc("sara_acao_decidir", { p_id: acaoId, p_permitir: permitir });
  if (error) return { situacao: "ja_decidida", texto: `Nada mudou: ${error.message}` };
  const dd = data as { situacao: string; ferramenta?: string; entrada?: Record<string, unknown> };
  if (dd.situacao === "expirada") return { situacao: "expirada", texto: "Esta proposta venceu e nada foi feito. Peça de novo à SARA." };
  if (dd.situacao === "recusada") return { situacao: "recusada", texto: "Tudo bem: nada foi feito." };
  // Permitida: executa com a sessão da pessoa. Sem a ferramenta (a permissão mudou), não executa.
  const f = p.ferramentas.find((x) => x.nome === dd.ferramenta && x.acao);
  let ok = false, resultado: Record<string, unknown> | null = null, erro: string | null = null;
  if (!f) erro = "Você não tem mais permissão para esta ação.";
  else {
    try { const r = await f.rodar(sb, dd.entrada ?? {}); ok = true; resultado = (r.dados ?? null) as Record<string, unknown> | null; }
    catch (err) { erro = err instanceof Error ? err.message.slice(0, 300) : "Falhou."; }
  }
  const { error: e2 } = await sb.rpc("sara_acao_concluir", { p_id: acaoId, p_ok: ok, p_resultado: resultado, p_erro: erro });
  if (e2) console.error("[whatsapp] não registrou o resultado da ação", e2.message);
  return ok ? { situacao: "executada", texto: String(resultado?.feito ?? "Feito.") } : { situacao: "falhou", texto: `Não foi feito: ${erro}` };
}
