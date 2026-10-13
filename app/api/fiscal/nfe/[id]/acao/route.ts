import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import type { NotaNfe } from "../../../../../../lib/fiscal/emissao/tipos";
import { respostaDoErro } from "../../../../../../lib/fiscal/rotas";
import { ambienteLiberado, auditar, autorDaSessao, protocoloDeTreino, validarEGravar, xmlAutorizadoDeTreino } from "../../../../../../lib/fiscal/emissao/servidor";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Contexto = { params: Promise<{ id: string }> };

/** Quem opera monta, valida e envia; quem aprova transmite, devolve, cancela e corrige. */
const NIVEL = { validar: "operar", enviar: "operar", devolver: "aprovar", transmitir: "aprovar", cancelar: "aprovar", carta: "aprovar" } as const;
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
    .select("id, ambiente, situacao, serie, numero, codigo_numerico, chave, nota, valor_total, destinatario_nome, xml, autorizada_em, montada_por")
    .eq("id", id).eq("organization_id", autor.org).maybeSingle();
  if (!n) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  // Só o treino por enquanto: nada sai para a SEFAZ.
  if (!ambienteLiberado(n.ambiente)) return NextResponse.json({ error: "Ambiente ainda não liberado." }, { status: 400 });

  const texto = String(corpo?.texto ?? "").trim();
  const agora = new Date();
  const conflito = (msg: string) => NextResponse.json({ error: msg }, { status: 409 });
  const registro = { id: n.id, ambiente: n.ambiente, serie: n.serie, numero: n.numero, codigo_numerico: n.codigo_numerico, nota: n.nota as NotaNfe };

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
          p_title: `${n.ambiente === "treino" ? "[Treino] " : ""}NF-e para aprovar · nº ${n.numero}`,
          p_body: `${autor.nome} montou a nota para ${n.destinatario_nome ?? "o destinatário"} (R$ ${Number(n.valor_total).toFixed(2).replace(".", ",")}).`,
          p_action_url: "/?module=fiscal&secao=Notas%20emitidas", p_except_profile: autor.profileId,
        });
        await auditar(admin, { ...autor, evento: "enviada", nfeId: id, dados: { numero: n.numero } });
        return NextResponse.json({ ok: true });
      }
      case "devolver": {
        if (n.situacao !== "aguardando_aprovacao") return conflito("A nota não está aguardando aprovação.");
        if (texto.length < 5) return NextResponse.json({ error: "Diga o que precisa ser corrigido." }, { status: 400 });
        await admin.from("fiscal_nfe").update({ situacao: "rascunho", motivo: `Devolvida por ${autor.nome}: ${texto}`.slice(0, 600), updated_at: agora.toISOString() }).eq("id", id);
        await auditar(admin, { ...autor, evento: "devolvida", nfeId: id, dados: { motivo: texto.slice(0, 300) } });
        return NextResponse.json({ ok: true });
      }
      case "transmitir": {
        if (n.situacao !== "aguardando_aprovacao") return conflito("Só nota enviada para aprovação pode ser transmitida.");
        // Confere de novo e gera o XML com a data de agora (como na transmissão de verdade).
        const r = await validarEGravar(admin, autor.org, registro);
        if (!r.ok) {
          // Como na rejeição da SEFAZ: volta para edição com o motivo.
          await admin.from("fiscal_nfe").update({ situacao: "rascunho", motivo: "Rejeitada na conferência final: corrija e valide de novo." }).eq("id", id);
          return NextResponse.json({ error: "A nota não passou na conferência final.", validacao: r }, { status: 422 });
        }
        const { data: v } = await admin.from("fiscal_nfe").select("xml, chave").eq("id", id).single();
        const protocolo = protocoloDeTreino();
        const xmlAutorizado = xmlAutorizadoDeTreino(v!.xml, v!.chave, protocolo, agora);
        await admin.from("fiscal_nfe").update({
          situacao: "autorizada", protocolo, xml_autorizado: xmlAutorizado, autorizada_em: agora.toISOString(), motivo: null,
          aprovada_por: autor.profileId, aprovada_por_nome: autor.nome, updated_at: agora.toISOString(),
        }).eq("id", id);
        await auditar(admin, { ...autor, evento: "autorizada_treino", nfeId: id, dados: { numero: n.numero, protocolo } });
        return NextResponse.json({ ok: true, protocolo });
      }
      case "cancelar": {
        if (n.situacao !== "autorizada") return conflito("Só nota autorizada pode ser cancelada.");
        if (texto.length < 15) return NextResponse.json({ error: "A justificativa precisa ter ao menos 15 caracteres (regra da SEFAZ)." }, { status: 400 });
        const horas = (agora.getTime() - new Date(n.autorizada_em).getTime()) / 3_600_000;
        if (horas > PRAZO_CANCELAMENTO_H) {
          return conflito(`Passou o prazo de ${PRAZO_CANCELAMENTO_H} horas para cancelar. Na vida real, o caminho seria uma nota de entrada/devolução (fale com o escritório).`);
        }
        const protocolo = protocoloDeTreino();
        const { error } = await admin.from("fiscal_nfe_eventos").insert({
          organization_id: autor.org, nfe_id: id, ambiente: n.ambiente, tipo: "cancelamento", sequencia: 1, texto: texto.slice(0, 255), protocolo,
          created_by: autor.profileId, created_by_name: autor.nome,
        });
        if (error) return NextResponse.json({ error: "Não foi possível registrar o cancelamento." }, { status: 400 });
        await admin.from("fiscal_nfe").update({ situacao: "cancelada", cancelada_em: agora.toISOString(), updated_at: agora.toISOString() }).eq("id", id);
        await auditar(admin, { ...autor, evento: "cancelada", nfeId: id, dados: { numero: n.numero, protocolo } });
        return NextResponse.json({ ok: true, protocolo });
      }
      case "carta": {
        if (n.situacao !== "autorizada") return conflito("Carta de correção só em nota autorizada.");
        if (texto.length < 15) return NextResponse.json({ error: "A correção precisa ter ao menos 15 caracteres." }, { status: 400 });
        const { count } = await admin.from("fiscal_nfe_eventos").select("id", { count: "exact", head: true }).eq("nfe_id", id).eq("tipo", "carta");
        if ((count ?? 0) >= MAX_CARTAS) return conflito(`Limite de ${MAX_CARTAS} cartas de correção por nota.`);
        const protocolo = protocoloDeTreino();
        const { error } = await admin.from("fiscal_nfe_eventos").insert({
          organization_id: autor.org, nfe_id: id, ambiente: n.ambiente, tipo: "carta", sequencia: (count ?? 0) + 1, texto: texto.slice(0, 1000), protocolo,
          created_by: autor.profileId, created_by_name: autor.nome,
        });
        if (error) return NextResponse.json({ error: "Não foi possível registrar a carta de correção." }, { status: 400 });
        await auditar(admin, { ...autor, evento: "carta", nfeId: id, dados: { numero: n.numero, sequencia: (count ?? 0) + 1 } });
        return NextResponse.json({ ok: true, protocolo, sequencia: (count ?? 0) + 1 });
      }
    }
  } catch (e) {
    return respostaDoErro(e, `Falha na ação ${acao} da NF-e`);
  }
}
