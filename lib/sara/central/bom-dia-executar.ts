import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSessionAccess } from "../../auth/session-access";
import { NOVIDADES, novidadesPara } from "../../novidades";
import { alertasDo } from "../alertas";
import { sessaoComo } from "../guias-executar";
import { SARAS } from "../modulos";
import { agoraSP, primeiroNome } from "../tempo";
import { BOM_DIA, DIAS_DA_SEMANA, escreverBomDia, janelaDoBomDia, moduloDoBomDia, ordenarItens, resumoDoBomDia, type ItemBomDia } from "./bom-dia";

/**
 * Execução do Bom dia (J2). A mesma tarefa de 10 em 10 minutos chama /api/sara/bom-dia/rodar: na janela
 * (7h às 11h, segunda a sábado), põe na fila quem tem a SARA liberada e ainda não recebeu hoje e roda a
 * fila aos poucos. Cada Bom dia é montado COMO a pessoa (sessão aberta pelo servidor, como nas guias),
 * então o RLS e as permissões dela valem em tudo. Sem nada para hoje, não manda nada (sem ruído).
 */

type Linha = { id: string; organization_id: string; profile_id: string; dia: string };
export type RelatorioBomDia = { enfileirados: number; rodados: string[]; erro?: string };

const ha = (agora: Date, min: number) => new Date(agora.getTime() - min * 60_000).toISOString();

/** Quem recebe: perfil ativo, com login, e a SARA de algum módulo liberada (ou o proprietário). */
async function quemRecebe(admin: SupabaseClient, agora: Date, somente?: string[]): Promise<{ id: string; organization_id: string }[]> {
  let q = admin.from("profiles").select("id, organization_id, is_owner, access_expires_at").eq("status", "active").not("user_id", "is", null);
  if (somente) q = q.in("id", somente);
  const [{ data: perfis }, { data: grants }] = await Promise.all([
    q.limit(1000),
    admin.from("user_feature_grants").select("profile_id").like("feature_code", "%.sara").limit(5000),
  ]);
  const comSara = new Set(((grants ?? []) as { profile_id: string }[]).map((g) => g.profile_id));
  return ((perfis ?? []) as { id: string; organization_id: string; is_owner: boolean; access_expires_at: string | null }[])
    .filter((p) => (!p.access_expires_at || Date.parse(p.access_expires_at) > agora.getTime()) && (p.is_owner || comSara.has(p.id)))
    .map((p) => ({ id: p.id, organization_id: p.organization_id }));
}

async function terminar(admin: SupabaseClient, id: string, campos: Record<string, unknown>) {
  await admin.from("sara_bom_dia").update({ ...campos, terminada_em: new Date().toISOString() }).eq("id", id);
}

/** O que importa hoje para a pessoa, colhido com a sessão dela. */
async function colher(admin: SupabaseClient, sb: SupabaseClient, eu: string, hoje: string) {
  const access = await readSessionAccess(sb, eu);
  const areas = Object.values(SARAS).filter((s) => !s.central && access.canModule(s.feature) && access.can(s.permissao, "ver"));
  const rotulo = (m: string | null | undefined) => (m && SARAS[m]?.rotulo) || "Plataforma";
  const novidades = novidadesPara(NOVIDADES, { isOwner: access.isOwner, grants: access.grants });
  const [avisos, decisoes, acoes, guias] = await Promise.all([
    Promise.all(areas.map(async (s) => (await alertasDo(s.modulo, sb, {
      pode: (f) => access.can(f, "ver"), hoje,
      novidades: novidades.filter((n) => n.modulos?.includes(s.modulo)).map((n) => ({ id: n.id, data: n.data, titulo: n.titulo })),
    })).map((a): ItemBomDia => ({ tipo: a.chave.includes(".novidades:") ? "novidade" : "aviso", nivel: a.nivel, modulo: s.modulo, area: s.rotulo, titulo: a.titulo, detalhe: a.detalhe }))))
      .then((x) => x.flat()),
    sb.rpc("decisoes_minhas").then((r) => ((r.data ?? []) as { assunto: string; modulo: string | null; resposta: string | null; pedida_por: string | null }[])
      .filter((d) => !d.resposta).map((d): ItemBomDia => ({ tipo: "decisao", nivel: "aviso", modulo: d.modulo ?? "", area: rotulo(d.modulo), titulo: `Decisão para você: ${d.assunto}`,
        detalhe: "Responda em Decisões para você (menu da sua conta)." }))),
    sb.from("sara_acoes").select("modulo, resumo").eq("profile_id", eu).eq("situacao", "pendente").gt("expira_em", new Date().toISOString()).order("created_at").limit(20)
      .then((r) => ((r.data ?? []) as { modulo: string; resumo: string }[]).map((a): ItemBomDia => ({ tipo: "acao", nivel: "aviso", modulo: a.modulo, area: rotulo(a.modulo),
        titulo: `Esperando o seu Permitir: ${a.resumo}` }))),
    // As guias da pessoa nas últimas 24 h (a tabela das guias só o servidor lê junto com a execução).
    admin.from("sara_guia_execucoes").select("situacao, resumo, erro, sara_habilidades!inner(nome, modulo, responsavel_id)")
      .eq("sara_habilidades.responsavel_id", eu).in("situacao", ["feita", "falhou", "sem_permissao"]).gt("terminada_em", ha(new Date(), 24 * 60)).order("terminada_em").limit(10)
      .then((r) => ((r.data ?? []) as unknown as { situacao: string; resumo: string | null; erro: string | null; sara_habilidades: { nome: string; modulo: string } }[])
        .map((g): ItemBomDia => ({ tipo: "guia", nivel: "aviso", modulo: g.sara_habilidades.modulo, area: rotulo(g.sara_habilidades.modulo),
          titulo: g.situacao === "feita" ? `A guia «${g.sara_habilidades.nome}» rodou` : `A guia «${g.sara_habilidades.nome}» não rodou`,
          detalhe: (g.situacao === "feita" ? g.resumo : g.erro)?.slice(0, 240) ?? undefined }))),
  ]);
  return { areas: areas.map((s) => s.modulo), itens: [...avisos, ...decisoes, ...acoes, ...guias] };
}

async function rodarUm(admin: SupabaseClient, l: Linha): Promise<string> {
  const s = await sessaoComo(admin, l.profile_id);
  if ("erro" in s) { await terminar(admin, l.id, { situacao: "falhou", erro: s.erro.slice(0, 500) }); return "falhou"; }
  try {
    const { areas, itens: todos } = await colher(admin, s.sb, l.profile_id, l.dia);
    if (!areas.length) { await terminar(admin, l.id, { situacao: "sem_sara" }); return "sem_sara"; }
    if (!todos.length) { await terminar(admin, l.id, { situacao: "vazia" }); return "vazia"; }
    const { itens, restantes } = ordenarItens(todos);
    const modulo = moduloDoBomDia(itens, areas) as string;
    const [{ data: me }, { data: cfg }, { data: uso }] = await Promise.all([
      s.sb.from("profiles").select("full_name").eq("id", l.profile_id).maybeSingle(),
      s.sb.from("sara_modulos").select("teto_tokens_mes").eq("modulo", modulo).maybeSingle(),
      s.sb.rpc("sara_uso_mes", { p_modulo: modulo }),
    ]);
    const nome = primeiroNome(me?.full_name);
    const agora = agoraSP(new Date(`${l.dia}T12:00:00-03:00`));
    const semana = DIAS_DA_SEMANA[new Date(`${l.dia}T12:00:00-03:00`).getUTCDay()];
    // Passou do teto do mês do módulo: sai o texto da plataforma (sem custo de modelo).
    const semModelo = Number(uso ?? 0) >= Number(cfg?.teto_tokens_mes ?? 2_000_000);
    const e = await escreverBomDia({ chave: semModelo ? "" : process.env.ANTHROPIC_API_KEY?.trim() ?? "", nome, data: agora.data.slice(0, 5), semana, itens, restantes });
    const urgentes = itens.filter((i) => i.nivel === "urgente").length;
    const { data: reg, error } = await s.sb.rpc("sara_registrar", {
      p_conversa: null, p_modulo: modulo, p_pergunta: `☀️ Bom dia · ${semana}, ${agora.data.slice(0, 5)}`, p_resposta: e.texto,
      p_ferramentas: { usadas: [], fontes: [], bom_dia: { dia: l.dia, itens: itens.length, restantes, urgentes, texto_da_plataforma: e.daPlataforma, sem_fonte: e.semFonte, teto: semModelo } },
      p_modelo: e.modelo, p_tokens_entrada: e.tokensEntrada, p_tokens_saida: e.tokensSaida,
    });
    if (error) throw new Error(`não registrou a conversa: ${error.message}`);
    const ids = reg as { conversa: string; mensagem: string };
    const resumo = resumoDoBomDia(itens);
    await admin.from("notifications").insert({ organization_id: l.organization_id, recipient_profile_id: l.profile_id, module_code: modulo, severity: urgentes ? "attention" : "info",
      title: `☀️ Bom dia${nome ? `, ${nome}` : ""}: ${urgentes ? `${urgentes} ${urgentes === 1 ? "assunto urgente" : "assuntos urgentes"} hoje` : "o resumo de hoje"}`.slice(0, 200),
      body: `${resumo}. Toque para ver na SARA.`.slice(0, 600), action_url: `/?module=${modulo}&sara=1` });
    await terminar(admin, l.id, { situacao: "feita", modulo, conversa_id: ids.conversa, mensagem_id: ids.mensagem, itens: itens.length + restantes, urgentes, resumo: resumo.slice(0, 600) });
    return "feita";
  } catch (err) {
    const m = err instanceof Error ? err.message.slice(0, 300) : "Falhou.";
    console.error("[sara] bom dia falhou", l.id, m);
    await terminar(admin, l.id, { situacao: "falhou", erro: m });
    return "falhou";
  } finally {
    await s.sair();
  }
}

/**
 * Na janela do Bom dia: põe na fila quem ainda não tem o de hoje e roda até `max` (de `paralelo` em
 * `paralelo`). Fora da janela, o que ficou na fila não sai mais. `somente` restringe a quem recebe (teste).
 */
export async function rodarBomDia(admin: SupabaseClient, { agora = new Date(), max = 9, paralelo = 3, somente }: { agora?: Date; max?: number; paralelo?: number; somente?: string[] } = {}): Promise<RelatorioBomDia> {
  const janela = janelaDoBomDia(agora, BOM_DIA);
  // Rodando há mais de 20 min: o processo caiu.
  await admin.from("sara_bom_dia").update({ situacao: "falhou", erro: "Interrompido (o servidor reiniciou).", terminada_em: agora.toISOString() })
    .eq("situacao", "rodando").lt("iniciada_em", ha(agora, 20));
  // Fora da janela (ou de outro dia), a fila não sai mais.
  let velha = admin.from("sara_bom_dia").update({ situacao: "falhou", erro: "Passou da hora do Bom dia.", terminada_em: agora.toISOString() }).eq("situacao", "na_fila");
  if (janela) velha = velha.lt("dia", janela.dia);
  await velha;
  if (!janela) return { enfileirados: 0, rodados: [] };
  const pessoas = await quemRecebe(admin, agora, somente);
  let enfileirados = 0;
  if (pessoas.length) {
    const { data, error } = await admin.from("sara_bom_dia").upsert(pessoas.map((p) => ({ organization_id: p.organization_id, profile_id: p.id, dia: janela.dia })),
      { onConflict: "profile_id,dia", ignoreDuplicates: true }).select("id");
    if (error) return { enfileirados: 0, rodados: [], erro: error.message };
    enfileirados = data?.length ?? 0;
  }
  let fila = admin.from("sara_bom_dia").select("id, organization_id, profile_id, dia").eq("situacao", "na_fila").eq("dia", janela.dia).order("created_at").limit(max);
  if (somente) fila = fila.in("profile_id", somente);
  const { data: linhas } = await fila;
  const rodados: string[] = [];
  const lista = (linhas ?? []) as Linha[];
  for (let i = 0; i < lista.length; i += paralelo) {
    rodados.push(...await Promise.all(lista.slice(i, i + paralelo).map(async (l) => {
      // Pega a linha (só uma tarefa por vez fica com ela).
      const { data: peguei } = await admin.from("sara_bom_dia").update({ situacao: "rodando", iniciada_em: new Date().toISOString() }).eq("id", l.id).eq("situacao", "na_fila").select("id");
      return peguei?.length ? rodarUm(admin, l) : "ocupado";
    })));
  }
  return { enfileirados, rodados };
}
