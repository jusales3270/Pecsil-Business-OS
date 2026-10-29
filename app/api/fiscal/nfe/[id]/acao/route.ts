import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import type { NotaNfe } from "../../../../../../lib/fiscal/emissao/tipos";
import { respostaDoErro } from "../../../../../../lib/fiscal/rotas";
import { ambienteLiberado, auditar, autorDaSessao, protocoloDeTreino, validarEGravar, xmlAutorizadoDeTreino } from "../../../../../../lib/fiscal/emissao/servidor";
import { AUTORIZADA, EVENTO_ACEITO, credenciaisDaEmissao, motivoLimpo, naSefaz, situacaoDaConsulta, tipoDoErro } from "../../../../../../lib/fiscal/emissao/sefaz";
import { obterTransmissor } from "../../../../../../lib/fiscal/transmissor";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Contexto = { params: Promise<{ id: string }> };

/**
 * Quem opera monta, valida e envia; quem aprova transmite, devolve, cancela, corrige e consulta.
 * Treino: nada sai para a SEFAZ (protocolo fictício). Homologação: transmite de verdade para a SEFAZ de teste
 * (sem valor fiscal), pelo transmissor, com o certificado do cofre. Produção ainda não está liberada.
 */
const NIVEL = { validar: "operar", enviar: "operar", devolver: "aprovar", transmitir: "aprovar", consultar: "aprovar", cancelar: "aprovar", carta: "aprovar" } as const;
type Acao = keyof typeof NIVEL;

const PRAZO_CANCELAMENTO_H = 24;
const MAX_CARTAS = 20;

export async function POST(request: Request, context: Contexto) {
  const { id } = await context.params;
  const corpo = (await request.json().catch(() => null)) as { acao?: string; texto?: string } | null;
  const acao = corpo?.acao as Acao;
  if (!acao || !(acao in NIVEL)) return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  const guard = await requireFeature("fiscal.nfe", NIVEL[acao]);
  if ("error" in guard) return guard.error;
  // A sessão precisa enxergar a nota (RLS) antes de o servidor agir por ela.
  const { data: visivel } = await guard.supabase.from("fiscal_nfe").select("id").eq("id", id).maybeSingle();
  if (!visivel) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: n } = await admin.from("fiscal_nfe")
    .select("id, ambiente, situacao, serie, numero, codigo_numerico, chave, nota, valor_total, destinatario_nome, xml, protocolo, autorizada_em, montada_por")
    .eq("id", id).eq("organization_id", autor.org).maybeSingle();
  if (!n) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  if (!ambienteLiberado(n.ambiente)) return NextResponse.json({ error: "Ambiente ainda não liberado." }, { status: 400 });

  const texto = String(corpo?.texto ?? "").trim();
  const agora = new Date();
  const conflito = (msg: string) => NextResponse.json({ error: msg }, { status: 409 });
  const registro = { id: n.id, ambiente: n.ambiente, serie: n.serie, numero: n.numero, codigo_numerico: n.codigo_numerico, nota: n.nota as NotaNfe };
  const sefaz = naSefaz(n.ambiente);
  const atualizar = (campos: Record<string, unknown>) => admin.from("fiscal_nfe").update({ ...campos, updated_at: new Date().toISOString() }).eq("id", id);

  try {
    switch (acao) {
      case "validar": {
        if (!["rascunho", "validada"].includes(n.situacao)) return conflito("Esta nota não está em edição.");
        const r = await validarEGravar(admin, autor.org, registro);
        await auditar(admin, { ...autor, evento: "validada", nfeId: id, dados: { ok: r.ok, erros: r.erros.length, esquema: r.esquema.erros.length } });
        return NextResponse.json({ validacao: r });
      }
      case "enviar": {
        if (n.situacao !== "validada") return conflito("Valide a nota antes de enviar para aprovação.");
        await admin.from("fiscal_nfe").update({ situacao: "aguardando_aprovacao", updated_at: agora.toISOString() }).eq("id", id).eq("situacao", "validada");
        await admin.rpc("notify_feature", {
          p_org: autor.org, p_feature: "fiscal.nfe", p_level: "aprovar", p_module: "fiscal", p_severity: "approval",
          p_title: `${n.ambiente === "treino" ? "[Treino] " : n.ambiente === "homologacao" ? "[Homologação] " : ""}NF-e para aprovar · nº ${n.numero}`,
          p_body: `${autor.nome} montou a nota para ${n.destinatario_nome ?? "o destinatário"} (R$ ${Number(n.valor_total).toFixed(2).replace(".", ",")}).`,
          p_action_url: "/?module=fiscal&secao=Notas%20emitidas", p_except_profile: autor.profileId,
        });
        await auditar(admin, { ...autor, evento: "enviada", nfeId: id, dados: { numero: n.numero } });
        return NextResponse.json({ ok: true });
      }
      case "devolver": {
        if (n.situacao !== "aguardando_aprovacao") return conflito("A nota não está aguardando aprovação.");
        if (texto.length < 5) return NextResponse.json({ error: "Diga o que precisa ser corrigido." }, { status: 400 });
        await atualizar({ situacao: "rascunho", motivo: `Devolvida por ${autor.nome}: ${texto}`.slice(0, 600) });
        await auditar(admin, { ...autor, evento: "devolvida", nfeId: id, dados: { motivo: texto.slice(0, 300) } });
        return NextResponse.json({ ok: true });
      }
      case "transmitir": {
        if (n.situacao !== "aguardando_aprovacao") return conflito(n.situacao === "transmitindo" ? "A nota já foi à SEFAZ e está sem resposta: use Consultar na SEFAZ." : "Só nota enviada para aprovação pode ser transmitida.");
        // Antes de gerar o XML: sem certificado ou com a Configuração em outro ambiente, nada é feito.
        const cred = sefaz ? await credenciaisDaEmissao(admin, autor.org, n.ambiente) : null;
        const transmissor = sefaz ? obterTransmissor() : null;
        // Confere de novo e gera o XML com a data de agora.
        const r = await validarEGravar(admin, autor.org, registro);
        if (!r.ok) {
          await atualizar({ situacao: "rascunho", motivo: "Rejeitada na conferência final: corrija e valide de novo." });
          return NextResponse.json({ error: "A nota não passou na conferência final.", validacao: r }, { status: 422 });
        }
        const { data: v } = await admin.from("fiscal_nfe").select("xml, chave").eq("id", id).single();
        if (!sefaz) {
          const protocolo = protocoloDeTreino();
          const xmlAutorizado = xmlAutorizadoDeTreino(v!.xml, v!.chave, protocolo, agora);
          await atualizar({ situacao: "autorizada", protocolo, xml_autorizado: xmlAutorizado, autorizada_em: agora.toISOString(), motivo: null, aprovada_por: autor.profileId, aprovada_por_nome: autor.nome });
          await auditar(admin, { ...autor, evento: "autorizada_treino", nfeId: id, dados: { numero: n.numero, protocolo } });
          return NextResponse.json({ ok: true, protocolo });
        }
        // Trava: só um clique vai à SEFAZ (a validação deixou a nota "validada").
        const { data: trava } = await admin.from("fiscal_nfe").update({ situacao: "transmitindo", transmitida_em: agora.toISOString(), motivo: "Na SEFAZ…", updated_at: agora.toISOString() })
          .eq("id", id).eq("situacao", "validada").select("id");
        if (!trava?.length) return conflito("A nota já está sendo transmitida.");
        try {
          const res = await transmissor!.autorizar(cred!, v!.xml);
          if (res.cStat && AUTORIZADA.has(res.cStat) && res.xmlAutorizado) {
            await atualizar({
              situacao: "autorizada", protocolo: res.protocolo ?? null, xml_autorizado: res.xmlAutorizado, autorizada_em: res.recebidoEm ?? agora.toISOString(),
              sefaz_cstat: res.cStat, motivo: null, aprovada_por: autor.profileId, aprovada_por_nome: autor.nome,
            });
            await auditar(admin, { ...autor, evento: "autorizada", nfeId: id, dados: { ambiente: n.ambiente, numero: n.numero, protocolo: res.protocolo, cStat: res.cStat } });
            return NextResponse.json({ ok: true, protocolo: res.protocolo, cStat: res.cStat });
          }
          // Resposta sem a autorização (lote em processamento, código inesperado): consultar antes de reenviar.
          await atualizar({ sefaz_cstat: res.cStat, motivo: `A SEFAZ respondeu ${res.cStat ?? "sem código"}${res.motivo ? ` · ${motivoLimpo(res.motivo)}` : ""}. Consulte na SEFAZ antes de transmitir de novo.` });
          await auditar(admin, { ...autor, evento: "transmitida_sem_resposta", nfeId: id, dados: { numero: n.numero, cStat: res.cStat } });
          return NextResponse.json({ pendente: true, cStat: res.cStat, mensagem: "A SEFAZ ainda não confirmou a autorização. Use Consultar na SEFAZ." }, { status: 202 });
        } catch (e) {
          const tipo = tipoDoErro(e);
          const mensagem = motivoLimpo(e instanceof Error ? e.message : "");
          if (tipo === "rejeitada") {
            await atualizar({ situacao: "rejeitada", motivo: `Rejeitada pela SEFAZ: ${mensagem}`.slice(0, 600), sefaz_cstat: null });
            await auditar(admin, { ...autor, evento: "rejeitada", nfeId: id, dados: { numero: n.numero, motivo: mensagem.slice(0, 300) } });
            return NextResponse.json({ error: `Rejeitada pela SEFAZ: ${mensagem}`, rejeitada: true }, { status: 422 });
          }
          if (tipo === "nao_enviou") {
            await atualizar({ situacao: "aguardando_aprovacao", motivo: `Não foi enviada: ${mensagem}`.slice(0, 600) });
            return NextResponse.json({ error: `Não foi enviada à SEFAZ: ${mensagem}` }, { status: 400 });
          }
          await atualizar({ motivo: `Sem resposta da SEFAZ (${mensagem || "falha de comunicação"}). Consulte na SEFAZ antes de transmitir de novo.`.slice(0, 600) });
          await auditar(admin, { ...autor, evento: "transmitida_sem_resposta", nfeId: id, dados: { numero: n.numero, erro: mensagem.slice(0, 200) } });
          return NextResponse.json({ pendente: true, mensagem: "Sem resposta da SEFAZ. A nota ficou aguardando a consulta: use Consultar na SEFAZ." }, { status: 202 });
        }
      }
      case "consultar": {
        if (!sefaz) return conflito("No treino não há o que consultar na SEFAZ.");
        if (!n.chave) return conflito("A nota ainda não tem chave de acesso.");
        if (!["transmitindo", "autorizada", "cancelada"].includes(n.situacao)) return conflito("Só nota que já foi à SEFAZ pode ser consultada.");
        const cred = await credenciaisDaEmissao(admin, autor.org, n.ambiente);
        // "Não consta" (217) pode voltar como rejeição da biblioteca: é a resposta, não uma falha.
        const res = await obterTransmissor().consultar(cred, n.chave).catch((e) => {
          if (tipoDoErro(e) === "rejeitada" && /n[aã]o consta/i.test(e instanceof Error ? e.message : "")) return { cStat: "217", motivo: motivoLimpo(e.message), protocolo: null, recebidoEm: null, bruto: null };
          throw e;
        });
        const situacao = situacaoDaConsulta(res.cStat);
        await auditar(admin, { ...autor, evento: "consultada", nfeId: id, dados: { numero: n.numero, cStat: res.cStat, situacao } });
        if (n.situacao === "transmitindo") {
          if (situacao === "autorizada") {
            // Autorizada, mas o XML autorizado não voltou na transmissão: o protocolo fica, o XML se pede à SEFAZ.
            await atualizar({ situacao: "autorizada", protocolo: res.protocolo ?? null, autorizada_em: res.recebidoEm ?? agora.toISOString(), sefaz_cstat: res.cStat,
              motivo: "Autorizada (confirmada na consulta à SEFAZ). O XML autorizado não voltou na transmissão.", aprovada_por: autor.profileId, aprovada_por_nome: autor.nome });
          } else if (situacao === "nao_consta") {
            await atualizar({ situacao: "aguardando_aprovacao", sefaz_cstat: res.cStat, motivo: "A SEFAZ não recebeu a nota: pode transmitir de novo." });
          } else if (situacao === "cancelada") {
            await atualizar({ situacao: "cancelada", cancelada_em: agora.toISOString(), sefaz_cstat: res.cStat, motivo: "Cancelada na SEFAZ (consulta)." });
          } else {
            await atualizar({ sefaz_cstat: res.cStat, motivo: `Consulta: ${res.cStat ?? "sem código"}${res.motivo ? ` · ${motivoLimpo(res.motivo)}` : ""}. Consulte de novo em alguns minutos.` });
          }
        }
        return NextResponse.json({ cStat: res.cStat, motivo: res.motivo, situacao, protocolo: res.protocolo ?? null });
      }
      case "cancelar": {
        if (n.situacao !== "autorizada") return conflito("Só nota autorizada pode ser cancelada.");
        if (texto.length < 15) return NextResponse.json({ error: "A justificativa precisa ter ao menos 15 caracteres (regra da SEFAZ)." }, { status: 400 });
        const horas = (agora.getTime() - new Date(n.autorizada_em).getTime()) / 3_600_000;
        if (horas > PRAZO_CANCELAMENTO_H) {
          return conflito(`Passou o prazo de ${PRAZO_CANCELAMENTO_H} horas para cancelar. O caminho agora é uma nota de entrada/devolução (fale com o escritório).`);
        }
        let protocolo = protocoloDeTreino();
        if (sefaz) {
          if (!n.chave || !n.protocolo) return conflito("A nota não tem o protocolo de autorização: consulte na SEFAZ antes de cancelar.");
          const cred = await credenciaisDaEmissao(admin, autor.org, n.ambiente);
          try {
            const res = await obterTransmissor().evento(cred, { tipo: "cancelamento", chave: n.chave, protocolo: n.protocolo, justificativa: texto.slice(0, 255) });
            if (!res.cStat || !EVENTO_ACEITO.has(res.cStat)) return NextResponse.json({ error: `A SEFAZ não confirmou o cancelamento (${res.cStat ?? "sem código"}${res.motivo ? ` · ${motivoLimpo(res.motivo)}` : ""}).` }, { status: 502 });
            protocolo = res.protocolo ?? "";
          } catch (e) {
            const mensagem = motivoLimpo(e instanceof Error ? e.message : "");
            if (tipoDoErro(e) === "rejeitada") return NextResponse.json({ error: `Cancelamento recusado pela SEFAZ: ${mensagem}` }, { status: 422 });
            throw e;
          }
        }
        const { error } = await admin.from("fiscal_nfe_eventos").insert({
          organization_id: autor.org, nfe_id: id, ambiente: n.ambiente, tipo: "cancelamento", sequencia: 1, texto: texto.slice(0, 255), protocolo: protocolo || null,
          created_by: autor.profileId, created_by_name: autor.nome,
        });
        if (error) return NextResponse.json({ error: "Cancelada na SEFAZ, mas o registro aqui falhou: avise o suporte." }, { status: 500 });
        await atualizar({ situacao: "cancelada", cancelada_em: agora.toISOString() });
        await auditar(admin, { ...autor, evento: "cancelada", nfeId: id, dados: { ambiente: n.ambiente, numero: n.numero, protocolo } });
        return NextResponse.json({ ok: true, protocolo });
      }
      case "carta": {
        if (n.situacao !== "autorizada") return conflito("Carta de correção só em nota autorizada.");
        if (texto.length < 15) return NextResponse.json({ error: "A correção precisa ter ao menos 15 caracteres." }, { status: 400 });
        const { count } = await admin.from("fiscal_nfe_eventos").select("id", { count: "exact", head: true }).eq("nfe_id", id).eq("tipo", "carta");
        if ((count ?? 0) >= MAX_CARTAS) return conflito(`Limite de ${MAX_CARTAS} cartas de correção por nota.`);
        const sequencia = (count ?? 0) + 1;
        let protocolo = protocoloDeTreino();
        if (sefaz) {
          if (!n.chave) return conflito("A nota não tem chave de acesso.");
          const cred = await credenciaisDaEmissao(admin, autor.org, n.ambiente);
          try {
            const res = await obterTransmissor().evento(cred, { tipo: "carta", chave: n.chave, correcao: texto.slice(0, 1000), sequencia });
            if (!res.cStat || !EVENTO_ACEITO.has(res.cStat)) return NextResponse.json({ error: `A SEFAZ não confirmou a carta de correção (${res.cStat ?? "sem código"}${res.motivo ? ` · ${motivoLimpo(res.motivo)}` : ""}).` }, { status: 502 });
            protocolo = res.protocolo ?? "";
          } catch (e) {
            const mensagem = motivoLimpo(e instanceof Error ? e.message : "");
            if (tipoDoErro(e) === "rejeitada") return NextResponse.json({ error: `Carta de correção recusada pela SEFAZ: ${mensagem}` }, { status: 422 });
            throw e;
          }
        }
        const { error } = await admin.from("fiscal_nfe_eventos").insert({
          organization_id: autor.org, nfe_id: id, ambiente: n.ambiente, tipo: "carta", sequencia, texto: texto.slice(0, 1000), protocolo: protocolo || null,
          created_by: autor.profileId, created_by_name: autor.nome,
        });
        if (error) return NextResponse.json({ error: "Não foi possível registrar a carta de correção." }, { status: 400 });
        await auditar(admin, { ...autor, evento: "carta", nfeId: id, dados: { ambiente: n.ambiente, numero: n.numero, sequencia, protocolo } });
        return NextResponse.json({ ok: true, protocolo, sequencia });
      }
    }
  } catch (e) {
    return respostaDoErro(e, `Falha na ação ${acao} da NF-e`);
  }
}
