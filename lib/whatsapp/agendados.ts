import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET_DOCUMENTOS } from "../sara/central/documentos";
import { MAX_TENTATIVAS, proximaTentativa, proximoHorarioPermitido, silencioso } from "./agendados-regras";
import { enviarAudio, enviarDocumento, enviarTexto } from "./evolution";
import { arquivoDoTipo, nomeDoArquivo } from "../sara/documentos/documento";

/**
 * Envios agendados pelo WhatsApp (migração 202610250005): a tarefa de 10 em 10 minutos manda o que venceu. Cada envio
 * é travado antes (sai de 'agendado' uma vez só: duas rodadas ao mesmo tempo não mandam duas vezes). Primeiro os
 * documentos, na ordem (mensagem de voz como áudio gravado, o resto como arquivo: PDF ou planilha), depois o texto. Falha: tenta de novo
 * em 10 minutos, até 3 vezes. Horário silencioso: espera o próximo horário permitido.
 */
type Deps = { enviarTexto: typeof enviarTexto; enviarAudio: typeof enviarAudio; enviarDocumento: typeof enviarDocumento };
const PADRAO: Deps = { enviarTexto, enviarAudio, enviarDocumento };
type Agendado = { id: string; organization_id: string; canal_id: string; contato_id: string | null; para_nome: string; texto: string | null; documentos: string[]; tentativas: number };
export type Rodada = { enviados: number; falhas: number; adiados: number };

export async function rodarAgendados(admin: SupabaseClient, deps: Partial<Deps> = {}, agora: Date = new Date()): Promise<Rodada> {
  const d = { ...PADRAO, ...deps };
  const r: Rodada = { enviados: 0, falhas: 0, adiados: 0 };
  const { data: vencidos, error } = await admin.from("whatsapp_agendados").select("id").eq("situacao", "agendado").lte("quando", agora.toISOString()).order("quando").limit(20);
  if (error) throw new Error(error.message);
  for (const { id } of (vencidos ?? []) as { id: string }[]) {
    if (silencioso(agora)) {
      await admin.from("whatsapp_agendados").update({ quando: proximoHorarioPermitido(agora).toISOString() }).eq("id", id).eq("situacao", "agendado");
      r.adiados++; continue;
    }
    // Trava: só uma rodada pega cada envio.
    const { data: a } = await admin.rpc("whatsapp_agendado_pegar", { p_id: id }).maybeSingle<Agendado>();
    if (!a) continue;
    try {
      const [{ data: canal }, { data: contato }] = await Promise.all([
        admin.from("whatsapp_canais").select("id, instancia, ativo, conexao").eq("id", a.canal_id).maybeSingle<{ id: string; instancia: string; ativo: boolean; conexao: string }>(),
        a.contato_id ? admin.from("whatsapp_contatos").select("id, numero, ativo, profile_id").eq("id", a.contato_id).maybeSingle<{ id: string; numero: string; ativo: boolean; profile_id: string | null }>() : Promise.resolve({ data: null }),
      ]);
      if (!canal?.ativo || canal.conexao !== "whatsapp_web") throw new Error("O número da plataforma está desativado.");
      if (!contato?.ativo) throw new Error("A pessoa não está mais ativa na allowlist.");
      const registrar = (waId: string | null, tipo: "texto" | "audio" | "documento") => admin.from("whatsapp_mensagens").insert({ organization_id: a.organization_id, canal_id: canal.id,
        contato_id: contato.id, profile_id: contato.profile_id, direcao: "saida", wa_id: waId, numero_final: contato.numero.slice(-4), tipo, situacao: "enviada", motivo: "agendado" });
      if (a.documentos.length) {
        const { data: docs } = await admin.from("sara_documentos").select("id, numero, tipo, titulo, caminho").in("id", a.documentos);
        const porId = new Map(((docs ?? []) as { id: string; numero: string; tipo: string; titulo: string; caminho: string | null }[]).map((x) => [x.id, x]));
        for (const docId of a.documentos) {
          const doc = porId.get(docId);
          if (!doc?.caminho) throw new Error("Documento agendado sem arquivo.");
          const { data: arq, error: eArq } = await admin.storage.from(BUCKET_DOCUMENTOS).download(doc.caminho);
          if (eArq || !arq) throw new Error(`Não consegui ler ${doc.numero}.`);
          const base64 = Buffer.from(await arq.arrayBuffer()).toString("base64");
          if (doc.tipo === "mensagem_voz") await registrar((await d.enviarAudio(canal.instancia, contato.numero, base64)).id, "audio");
          else await registrar((await d.enviarDocumento(canal.instancia, contato.numero, base64, nomeDoArquivo(doc.numero, doc.titulo, doc.tipo), doc.titulo, arquivoDoTipo(doc.tipo).mime)).id, "documento");
        }
      }
      if (a.texto) await registrar((await d.enviarTexto(canal.instancia, contato.numero, a.texto)).id, "texto");
      await admin.from("whatsapp_agendados").update({ situacao: "enviado", enviado_em: new Date().toISOString(), erro: null }).eq("id", a.id);
      r.enviados++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : "Falhou.").slice(0, 500);
      const desiste = a.tentativas >= MAX_TENTATIVAS;
      await admin.from("whatsapp_agendados").update(desiste ? { situacao: "falhou", erro: msg } : { situacao: "agendado", erro: msg, quando: proximaTentativa(agora).toISOString() }).eq("id", a.id);
      console.error("[whatsapp] agendado", a.id, msg);
      r.falhas++;
    }
  }
  return r;
}
