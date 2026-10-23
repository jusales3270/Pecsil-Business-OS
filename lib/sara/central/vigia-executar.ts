import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSessionAccess } from "../../auth/session-access";
import { alertasDo } from "../alertas";
import { sessaoComo } from "../guias-executar";
import { SARAS } from "../modulos";
import { agoraSP } from "../tempo";
import { janelaDoBomDia } from "./bom-dia";
import {
  VIGIA, achadosDaPlataforma, analisarSinais, decisaoDoAchado, mesmoProblema, ordenarPorImpacto, precisaCobrar, sinaisDe, situacaoPelasRespostas,
  tipoDaChave, tipoDoAchado, validarAchados, type Achado, type AchadoAberto, type Envio, type Parado, type Sinal,
} from "./vigia";

/**
 * Execução da vigia (J3). A tarefa de 10 em 10 minutos chama /api/sara/vigia/rodar: na janela (6h30 às 10h,
 * segunda a sábado) roda uma vez por dia, antes do Bom dia (os achados entregues já entram no Bom dia de quem
 * recebe, como decisão). O proprietário também pode rodar na War Room.
 *   1. Sinais da empresa com a sessão da VISÃO (o proprietário, W1).
 *   2. Achados abertos: atualiza as respostas, cobra quem não respondeu e registra o efeito do que saiu dos sinais.
 *   3. Análise do dia (Sonnet), conferida número a número; sem o modelo, os urgentes viram achados da plataforma.
 *   4. Cada achado novo vai a quem decide na área (sara_responsaveis), como "Decisão para você", só se essa
 *      pessoa também enxerga os sinais dele com a sessão dela.
 */

const ATIVOS = ["aberto", "enviado", "tratando", "ajuda", "sem_responsavel", "silenciado"];
const rotulo = (m: string) => SARAS[m]?.rotulo ?? m;
type Linha = { id: string; tipo: string; modulo: string; titulo: string; sinais: string[]; situacao: string; envios: Envio[]; created_at: string; updated_at: string };
export type RelatorioVigia = { rodada?: string; sinais: number; novos: number; enviados: number; resolvidos: number; cobrados: number; descartados: string[]; jaRodou?: boolean; erro?: string };
export type OpcoesVigia = {
  agora?: Date; disparo?: "agenda" | "manual";
  /** Sessão da visão (o proprietário pedindo na War Room). Sem ela, o servidor abre a do proprietário. */
  visao?: { sb: SupabaseClient; profileId: string };
  /** Teste: quem decide em cada área no lugar do cadastro (nunca manda achado de teste a quem trabalha). */
  responsaveis?: Record<string, string[]>;
};

async function sinaisDa(sb: SupabaseClient, profileId: string, hoje: string, modulo?: string): Promise<Sinal[]> {
  const access = await readSessionAccess(sb, profileId);
  const areas = Object.values(SARAS).filter((s) => !s.central && access.canModule(s.feature) && (!modulo || s.modulo === modulo));
  const avisos = await Promise.all(areas.map(async (s) => ({ modulo: s.modulo, area: s.rotulo, avisos: await alertasDo(s.modulo, sb, { pode: (f) => access.can(f, "ver"), hoje }) })));
  const { data: parados } = await sb.rpc("parados_listar");
  const doModulo = ((parados ?? []) as Parado[]);
  return sinaisDe(avisos, doModulo).filter((s) => !modulo || s.modulo === modulo);
}

export async function rodarVigia(admin: SupabaseClient, o: OpcoesVigia = {}): Promise<RelatorioVigia> {
  const agora = o.agora ?? new Date();
  const disparo = o.disparo ?? "agenda";
  const rel: RelatorioVigia = { sinais: 0, novos: 0, enviados: 0, resolvidos: 0, cobrados: 0, descartados: [] };
  const janela = janelaDoBomDia(agora, VIGIA);
  if (disparo === "agenda" && !janela) return rel;
  const hoje = janela?.dia ?? agoraSP(agora).dia;

  // A visão da empresa: quem pediu (War Room) ou o proprietário ativo.
  const { data: dono } = await admin.from("profiles").select("id, organization_id").eq("is_owner", true).eq("status", "active").order("created_at").limit(1).maybeSingle();
  if (!dono) return { ...rel, erro: "Sem proprietário ativo para a visão da empresa." };
  const { data: rodada, error: eR } = await admin.from("sara_vigia_rodadas").insert({ organization_id: dono.organization_id, dia: hoje, disparo }).select("id").single();
  if (eR) return eR.code === "23505" ? { ...rel, jaRodou: true } : { ...rel, erro: eR.message };
  rel.rodada = rodada.id;
  const aberta = o.visao ? null : await sessaoComo(admin, dono.id);
  if (aberta && "erro" in aberta) {
    await admin.from("sara_vigia_rodadas").update({ situacao: "falhou", erro: aberta.erro.slice(0, 500), terminada_em: new Date().toISOString() }).eq("id", rodada.id);
    return { ...rel, erro: aberta.erro };
  }
  const visao = o.visao ?? { sb: (aberta as { sb: SupabaseClient }).sb, profileId: dono.id };
  const sessoes = new Map<string, { sb: SupabaseClient; sair: () => Promise<void> } | null>();
  let tokens = { entrada: 0, saida: 0 }, modelo: string | null = null, resumo = "";
  try {
    const sinais = await sinaisDa(visao.sb, visao.profileId, hoje);
    rel.sinais = sinais.length;
    const tiposHoje = new Set(sinais.map((s) => s.tipo));

    // --- Achados abertos: respostas, cobrança e efeito ---------------------------------------------------
    const { data: abertosBrutos } = await admin.from("sara_achados").select("id, tipo, modulo, titulo, sinais, situacao, envios, created_at, updated_at")
      .eq("organization_id", dono.organization_id).in("situacao", [...ATIVOS, "nao_e_problema"]).order("created_at").limit(200);
    const abertos = (abertosBrutos ?? []) as Linha[];
    const decisoesIds = abertos.flatMap((a) => a.envios.map((e) => e.decisao_id)).filter(Boolean);
    const { data: respostas } = decisoesIds.length ? await admin.from("decisoes").select("id, resposta").in("id", decisoesIds) : { data: [] };
    const respostaDe = new Map(((respostas ?? []) as { id: string; resposta: string | null }[]).map((d) => [d.id, d.resposta]));
    for (const a of abertos) {
      // Efeito: nenhum dos sinais do achado aparece mais na empresa.
      const sumiu = a.sinais.length > 0 && !a.sinais.some((c) => tiposHoje.has(tipoDaChave(c)));
      const envios = a.envios.map((e) => ({ ...e, resposta: respostaDe.get(e.decisao_id) ?? e.resposta ?? null }));
      if (sumiu && a.situacao !== "nao_e_problema") {
        await admin.from("sara_achados").update({ situacao: "resolvido", envios, resolvido_em: agora.toISOString(), updated_at: agora.toISOString(),
          efeito: `A situação saiu dos avisos em ${agoraSP(agora).data.slice(0, 5)}${envios.some((e) => e.resposta === "Vou tratar") ? `, depois de "Vou tratar" de ${envios.filter((e) => e.resposta === "Vou tratar").map((e) => e.nome).join(", ")}` : ""}.` }).eq("id", a.id);
        rel.resolvidos++;
        continue;
      }
      if (!envios.length) continue;
      let cobrou = false;
      for (const e of envios) {
        if (!precisaCobrar(e, agora)) continue;
        await admin.from("notifications").insert({ organization_id: dono.organization_id, recipient_profile_id: e.profile_id, module_code: a.modulo, severity: "attention",
          title: `Lembrete da vigia: ${a.titulo}`.slice(0, 200), body: "Este gargalo ainda espera a sua resposta: Vou tratar, Não é problema ou Preciso de ajuda.", action_url: `/?decisoes=${e.decisao_id}` });
        e.cobrancas = (e.cobrancas ?? 0) + 1; e.cobrado_em = agora.toISOString(); cobrou = true; rel.cobrados++;
      }
      const situacao = a.situacao === "silenciado" || a.situacao === "sem_responsavel" ? a.situacao : situacaoPelasRespostas(envios);
      if (cobrou || situacao !== a.situacao || JSON.stringify(envios) !== JSON.stringify(a.envios))
        await admin.from("sara_achados").update({ situacao, envios, updated_at: agora.toISOString() }).eq("id", a.id);
      a.situacao = situacao;
    }
    const ativos: AchadoAberto[] = abertos.filter((a) => ATIVOS.includes(a.situacao)).map((a) => ({ id: a.id, tipo: a.tipo, modulo: a.modulo, titulo: a.titulo, sinais: a.sinais, situacao: a.situacao }));
    // "Não é problema" há menos de N dias: aquele tipo fica em silêncio para a área.
    const silencio = abertos.filter((a) => a.situacao === "nao_e_problema" && agora.getTime() - Date.parse(a.updated_at) < VIGIA.silencioDias * 86_400_000);

    // --- Análise do dia ----------------------------------------------------------------------------------
    const modulos = Object.values(SARAS).filter((s) => !s.central).map((s) => s.modulo);
    const { data: cfg } = await visao.sb.from("sara_modulos").select("teto_tokens_mes").eq("modulo", "warroom").maybeSingle();
    const { data: uso } = await visao.sb.rpc("sara_uso_mes", { p_modulo: "warroom" });
    const noTeto = Number(uso ?? 0) >= Number(cfg?.teto_tokens_mes ?? 60_000_000);
    const analise = noTeto ? null : await analisarSinais({ chave: process.env.ANTHROPIC_API_KEY?.trim() ?? "", hoje: agoraSP(agora).data, sinais, abertos: ativos });
    let achados: Achado[];
    if (analise) {
      tokens = { entrada: analise.tokensEntrada, saida: analise.tokensSaida }; modelo = analise.modelo; resumo = analise.resumo;
      const v = validarAchados(analise.bruto, sinais, modulos, rotulo);
      achados = v.achados; rel.descartados = v.descartados;
    } else {
      achados = achadosDaPlataforma(sinais); modelo = "plataforma";
      resumo = `${sinais.filter((s) => s.nivel === "urgente").length} sinais urgentes em ${new Set(sinais.map((s) => s.modulo)).size} áreas.`;
    }
    achados = ordenarPorImpacto(achados, sinais);

    // --- Achados novos (ou atualização dos que já estão abertos) ---------------------------------------------
    const novos: { id: string; a: Achado }[] = [];
    for (const a of achados) {
      const ss = a.sinais.map((id) => sinais.find((s) => s.id === id)!).filter(Boolean);
      const tipos = [...new Set(ss.map((s) => s.tipo))];
      const igual = ativos.find((x) => x.id === a.mesmo_que && x.modulo === a.modulo) ?? ativos.find((x) => mesmoProblema({ modulo: a.modulo, tipos }, x));
      const evidencias = ss.map((s) => ({ area: s.area, titulo: s.titulo, detalhe: s.detalhe ?? null, nivel: s.nivel }));
      if (igual) {
        // O mesmo problema de um achado aberto: atualiza a evidência, sem mandar de novo.
        await admin.from("sara_achados").update({ sinais: ss.map((s) => s.chave), evidencias, por_que: a.por_que, updated_at: agora.toISOString() }).eq("id", igual.id);
        continue;
      }
      if (novos.length >= VIGIA.maxAchados) break;
      const tipo = tipoDoAchado(a.modulo, ss);
      const calado = silencio.some((x) => mesmoProblema({ modulo: a.modulo, tipos }, { id: x.id, tipo: x.tipo, modulo: x.modulo, titulo: x.titulo, sinais: x.sinais, situacao: x.situacao }));
      const { data: criado } = await admin.from("sara_achados").upsert({
        organization_id: dono.organization_id, rodada_id: rodada.id, chave: `${tipo}:${hoje}`.slice(0, 200), tipo, modulo: a.modulo, area: a.area, titulo: a.titulo, por_que: a.por_que,
        evidencias, sinais: ss.map((s) => s.chave), impacto: a.impacto, ligacoes: a.ligacoes, contencao: a.contencao, confianca: a.confianca, origem: a.origem,
        situacao: calado ? "silenciado" : "aberto",
      }, { onConflict: "organization_id,chave", ignoreDuplicates: true }).select("id");
      if (!criado?.length) continue;
      rel.novos++;
      if (!calado) novos.push({ id: criado[0].id, a });
    }

    // --- Entrega a quem decide ---------------------------------------------------------------------------
    // Também os que ficaram "aberto" numa rodada anterior (limite do dia).
    const { data: pendentes } = await admin.from("sara_achados").select("id, modulo, area, titulo, por_que, sinais, impacto, ligacoes, contencao, confianca, origem, evidencias")
      .eq("organization_id", dono.organization_id).eq("situacao", "aberto").order("created_at").limit(20);
    const { data: cadastro } = await admin.from("sara_responsaveis").select("modulo, profile_id").eq("organization_id", dono.organization_id);
    const quem = (m: string) => o.responsaveis ? (o.responsaveis[m] ?? []) : ((cadastro ?? []) as { modulo: string; profile_id: string }[]).filter((r) => r.modulo === m).map((r) => r.profile_id);
    const inicioDoDia = new Date(Date.parse(`${hoje}T00:00:00-03:00`)).toISOString();
    for (const p of (pendentes ?? []) as (Achado & { id: string; sinais: string[]; evidencias: { area: string; titulo: string; detalhe: string | null }[] })[]) {
      const pessoas = quem(p.modulo);
      if (!pessoas.length) { await admin.from("sara_achados").update({ situacao: "sem_responsavel", updated_at: agora.toISOString() }).eq("id", p.id); continue; }
      const envios: Envio[] = [];
      let noLimite = false;
      for (const pid of pessoas) {
        const { count } = await admin.from("decisoes").select("id", { count: "exact", head: true }).eq("para_profile_id", pid).eq("origem", "sara.vigia").gte("created_at", inicioDoDia);
        if ((count ?? 0) >= VIGIA.maxPorPessoaDia) { noLimite = true; continue; }
        // A pessoa enxerga os sinais deste achado com a sessão dela? Sem isso, não vai para ela.
        if (!sessoes.has(pid)) { const s = await sessaoComo(admin, pid); sessoes.set(pid, "erro" in s ? null : s); }
        const s = sessoes.get(pid);
        if (!s) continue;
        const dela = new Set((await sinaisDa(s.sb, pid, hoje, p.modulo)).map((x) => x.tipo));
        if (!p.sinais.every((c) => dela.has(tipoDaChave(c)))) continue;
        const { data: perfil } = await admin.from("profiles").select("full_name").eq("id", pid).maybeSingle();
        const ev: Sinal[] = p.evidencias.map((x, i) => ({ id: `e${i}`, chave: p.sinais[i] ?? "", tipo: "", modulo: p.modulo, area: x.area, nivel: "aviso", titulo: x.titulo, detalhe: x.detalhe ?? undefined, origem: "aviso" }));
        const d = decisaoDoAchado({ ...p, sinais: ev.map((x) => x.id) }, ev, rotulo);
        const { data: dec, error: eD } = await admin.from("decisoes").insert({ organization_id: dono.organization_id, chave: `vigia.${p.id}`, origem: "sara.vigia", modulo: p.modulo,
          assunto: d.assunto, pergunta: d.pergunta, detalhes: d.detalhes, opcoes: [...VIGIA.opcoes], para_profile_id: pid, para_nome: perfil?.full_name ?? null, criada_por_nome: "SARA central (vigia)" }).select("id").single();
        if (eD || !dec) { console.error("[vigia] não criou a decisão", eD?.message); continue; }
        envios.push({ profile_id: pid, nome: perfil?.full_name ?? "", decisao_id: dec.id, enviado_em: agora.toISOString(), resposta: null, cobrancas: 0, cobrado_em: null });
      }
      if (envios.length) { await admin.from("sara_achados").update({ situacao: "enviado", envios, updated_at: agora.toISOString() }).eq("id", p.id); rel.enviados++; }
      // Ninguém da área enxerga estes dados (e não foi o limite do dia): fica no quadro da War Room.
      else if (!noLimite) await admin.from("sara_achados").update({ situacao: "sem_responsavel", efeito: "Quem decide nesta área não tem acesso a estes dados.", updated_at: agora.toISOString() }).eq("id", p.id);
    }

    await admin.from("sara_vigia_rodadas").update({ situacao: "feita", sinais: rel.sinais, achados_novos: rel.novos, enviados: rel.enviados, modelo,
      tokens_entrada: tokens.entrada, tokens_saida: tokens.saida, resumo: [resumo, rel.descartados.length ? `Descartados pelo verificador: ${rel.descartados.join("; ")}` : ""].filter(Boolean).join(" ").slice(0, 2000),
      terminada_em: new Date().toISOString() }).eq("id", rodada.id);
    return rel;
  } catch (err) {
    const m = err instanceof Error ? err.message.slice(0, 300) : "Falhou.";
    console.error("[vigia] falhou", m);
    await admin.from("sara_vigia_rodadas").update({ situacao: "falhou", erro: m, modelo, tokens_entrada: tokens.entrada, tokens_saida: tokens.saida, terminada_em: new Date().toISOString() }).eq("id", rodada.id);
    return { ...rel, erro: m };
  } finally {
    for (const s of sessoes.values()) await s?.sair();
    if (aberta && !("erro" in aberta)) await aberta.sair();
  }
}
