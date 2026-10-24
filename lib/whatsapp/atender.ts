import type { SupabaseClient } from "@supabase/supabase-js";
import { gravarMensagemDeVoz } from "../sara/central/mensagem-de-voz";
import { resumoFalado } from "../sara/central/fala";
import { sessaoComo } from "../sara/guias-executar";
import { paraVoz, semExpressoes, semTags } from "../sara/personalidade";
import { responder } from "../sara/responder";
import { prepararCom } from "../sara/sessao";
import { transcrever } from "../sara/voz";
import { createSupabaseAdminClient } from "../supabase/admin";
import { baixarMidia, enviarAudio, enviarTexto, marcarLida, presenca } from "./evolution";
import { complementoEscrito, dividir, lerMensagem, paraWhatsApp, type Recebida } from "./mensagem";
import { SARA_OPCOES } from "./saras";

/**
 * WhatsApp W3 (PLANO-WHATSAPP §2–§4): atende uma mensagem que chegou a um número da plataforma.
 *
 * - Número fora da lista interna daquele número: ignorado em silêncio (sem resposta, sem "lida", sem "digitando");
 *   fica só o registro com os 4 últimos dígitos. Lista externa: fica para a W5 (API oficial), também em silêncio.
 * - Na lista: a SARA responsável pelo número responde com a SESSÃO da pessoa (as permissões dela), pela mesma
 *   função da tela (lib/sara/responder.ts). Texto vira texto; áudio vira nota de voz (Whisper → SARA → voz luna).
 *   O que não dá para ouvir (link do Permitir, gráfico) vai junto, por escrito.
 * - Ação que grava não acontece pelo WhatsApp: fica pendente, com o link para o Permitir da plataforma.
 * As chamadas à Evolution e à voz são trocáveis (`Deps`), para testar o caminho inteiro sem o chip.
 */

export type Deps = {
  enviarTexto: typeof enviarTexto; enviarAudio: typeof enviarAudio; marcarLida: typeof marcarLida; presenca: typeof presenca;
  baixarMidia: typeof baixarMidia; transcrever: typeof transcrever; gravarVoz: typeof gravarMensagemDeVoz;
};
const PADRAO: Deps = { enviarTexto, enviarAudio, marcarLida, presenca, baixarMidia, transcrever, gravarVoz: gravarMensagemDeVoz };

export type Resultado = { situacao: "descartada" | "repetida" | "ignorada" | "respondida" | "falhou"; motivo?: string; conversa?: string | null; respostas?: number };

/** Uma conversa do WhatsApp continua a mesma conversa da SARA por até 12 h sem mensagem. */
const CONTINUA_MS = 12 * 3600_000;
const base = () => (process.env.PLATAFORMA_URL?.trim() || "https://home.pecsil.com.br").replace(/\/+$/, "");

type Canal = { id: string; organization_id: string; instancia: string; nome: string; sara_modulo: string | null; conexao: string; ativo: boolean };
type Contato = { id: string; lista: string; profile_id: string | null; ativo: boolean };

export async function atender(payload: unknown, deps: Partial<Deps> = {}, admin: SupabaseClient = createSupabaseAdminClient()): Promise<Resultado> {
  const d = { ...PADRAO, ...deps };
  const m = lerMensagem(payload);
  if ("descartar" in m) return { situacao: "descartada", motivo: m.descartar };

  const { data: canal } = await admin.from("whatsapp_canais").select("id, organization_id, instancia, nome, sara_modulo, conexao, ativo").eq("instancia", m.instancia).maybeSingle<Canal>();
  if (!canal) return { situacao: "descartada", motivo: "instancia_desconhecida" };

  // Registro da entrada (o mesmo aviso repetido pela Evolution não passa daqui).
  const { data: entrada, error: eDup } = await admin.from("whatsapp_mensagens").insert({ organization_id: canal.organization_id, canal_id: canal.id, direcao: "entrada", wa_id: m.waId,
    numero_final: m.numero.slice(-4), tipo: m.tipo, situacao: "recebida" }).select("id").single();
  if (eDup) return eDup.code === "23505" ? { situacao: "repetida" } : { situacao: "falhou", motivo: eDup.message.slice(0, 120) };
  const marcar = (campos: Record<string, unknown>) => admin.from("whatsapp_mensagens").update(campos).eq("id", entrada.id);
  const ignorar = async (motivo: string, extra: Record<string, unknown> = {}) => { await marcar({ situacao: "ignorada", motivo, ...extra }); return { situacao: "ignorada" as const, motivo }; };

  if (!canal.ativo || canal.conexao !== "whatsapp_web") return ignorar("canal_inativo");
  const { data: contato } = await admin.from("whatsapp_contatos").select("id, lista, profile_id, ativo").eq("canal_id", canal.id).eq("numero", m.numero).maybeSingle<Contato>();
  // Silêncio total para quem não está na lista (nem "lida", nem "digitando").
  if (!contato || !contato.ativo) return ignorar("fora_da_lista");
  if (contato.lista !== "interna" || !contato.profile_id) return ignorar("externa", { contato_id: contato.id });
  if (!canal.sara_modulo) return ignorar("sem_sara", { contato_id: contato.id, profile_id: contato.profile_id });
  const { data: perfil } = await admin.from("profiles").select("id, status, access_expires_at").eq("id", contato.profile_id).maybeSingle<{ id: string; status: string; access_expires_at: string | null }>();
  if (!perfil || perfil.status !== "active" || (perfil.access_expires_at && Date.parse(perfil.access_expires_at) < Date.now())) return ignorar("usuario_inativo", { contato_id: contato.id, profile_id: contato.profile_id });
  await marcar({ contato_id: contato.id, profile_id: perfil.id });

  // A partir daqui é alguém da lista: "lida" e "digitando" (ou "gravando", se veio áudio).
  const audio = m.tipo === "audio";
  await d.marcarLida(canal.instancia, m.jid, m.waId);
  await d.presenca(canal.instancia, m.numero, audio ? "recording" : "composing");
  const responderTexto = async (texto: string) => {
    let n = 0;
    for (const parte of dividir(texto)) { const r = await d.enviarTexto(canal.instancia, m.numero, parte); n++; await registrarSaida(admin, canal, contato.id, perfil.id, r.id, "texto"); }
    return n;
  };

  try {
    // O que a pessoa disse: o texto, a transcrição do áudio ou a foto.
    let pergunta = m.texto;
    let imagem: { tipo: string; dados: string } | null = null;
    if (audio) {
      const midia = m.base64 ? { base64: m.base64 } : await d.baixarMidia(canal.instancia, m.waId);
      if (!midia) throw new Error("não consegui baixar o áudio");
      const bytes = Buffer.from(midia.base64, "base64");
      const t = await d.transcrever(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      if ("erro" in t || !t.texto.trim()) {
        const n = await responderTexto("Não consegui entender o áudio. Pode mandar de novo, ou por texto?");
        await marcar({ situacao: "respondida", erro: "erro" in t ? t.erro.slice(0, 300) : "transcrição vazia" });
        return { situacao: "respondida", respostas: n };
      }
      pergunta = t.texto.trim();
    } else if (m.tipo === "imagem") {
      const midia = m.base64 ? { base64: m.base64, mimetype: m.mimetype } : await d.baixarMidia(canal.instancia, m.waId);
      const tipo = (midia?.mimetype ?? m.mimetype ?? "image/jpeg").split(";")[0];
      if (midia && ["image/jpeg", "image/png", "image/webp"].includes(tipo) && midia.base64.length <= 5_400_000) imagem = { tipo, dados: midia.base64 };
    } else if (m.tipo !== "texto") {
      const n = await responderTexto("Por enquanto eu leio texto, áudio e foto por aqui. Documentos ficam para uma próxima etapa: mande pela plataforma.");
      await marcar({ situacao: "respondida", motivo: "tipo_nao_suportado" });
      return { situacao: "respondida", respostas: n };
    }

    // A conversa continua a mesma da SARA se a última mensagem foi há menos de 12 h.
    const { data: anterior } = await admin.from("whatsapp_mensagens").select("conversa_id, created_at").eq("contato_id", contato.id).eq("direcao", "entrada")
      .not("conversa_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle<{ conversa_id: string; created_at: string }>();
    const conversa = anterior && Date.now() - Date.parse(anterior.created_at) < CONTINUA_MS ? anterior.conversa_id : null;

    // A SARA do número, com a sessão da pessoa (as permissões dela valem em tudo).
    const s = await sessaoComo(admin, perfil.id);
    if ("erro" in s) throw new Error(s.erro);
    try {
      const p = await prepararCom(s.sb, canal.sara_modulo);
      const rotulo = SARA_OPCOES.find((x) => x.modulo === canal.sara_modulo)?.rotulo ?? "SARA";
      if ("erro" in p) {
        const n = await responderTexto(`Seu acesso à ${rotulo} não está liberado na plataforma. Fale com o proprietário.`);
        await marcar({ situacao: "respondida", motivo: "sem_permissao" });
        return { situacao: "respondida", respostas: n };
      }
      const resposta = await responder(p, canal.sara_modulo, { pergunta: pergunta || (imagem ? "" : "Oi"), conversa, voz: audio, imagem, canal: "whatsapp" });
      const corpo = (await resposta.json().catch(() => null)) as { texto?: string; conversa?: string; acoes?: { situacao: string }[]; visuais?: unknown[]; error?: string } | null;
      if (!resposta.ok || !corpo?.texto) {
        const n = await responderTexto(corpo?.error ?? "A SARA está indisponível agora. Tente de novo em instantes.");
        await marcar({ situacao: "falhou", erro: (corpo?.error ?? `status ${resposta.status}`).slice(0, 300) });
        return { situacao: "falhou", respostas: n };
      }
      const linkSara = `${base()}/?module=${canal.sara_modulo}&sara=1`;
      const extra = complementoEscrito({ acoesPendentes: (corpo.acoes ?? []).filter((a) => a.situacao === "pendente").length, visuais: (corpo.visuais ?? []).length, linkSara });
      let n = 0;
      if (audio) {
        // Áudio com áudio: a parte falada é a resposta direta; o resto que não dá para ouvir vai por escrito.
        try {
          const falado = resumoFalado(semTags(corpo.texto), 420, { detalhe: "O detalhe está na plataforma.", semTexto: "Mandei a resposta para a plataforma: abra a SARA para ver." });
          const mp3 = await d.gravarVoz(paraVoz(falado));
          const r = await d.enviarAudio(canal.instancia, m.numero, Buffer.from(mp3).toString("base64"));
          n++; await registrarSaida(admin, canal, contato.id, perfil.id, r.id, "audio");
          if (extra) n += await responderTexto(extra);
        } catch (e) {
          console.error("[whatsapp] voz", e instanceof Error ? e.message : e);
          n += await responderTexto(`(Respondi por escrito: a voz não está disponível agora.)\n\n${paraWhatsApp(semExpressoes(semTags(corpo.texto)), base())}${extra ? `\n\n${extra}` : ""}`);
        }
      } else {
        n += await responderTexto(`${paraWhatsApp(semExpressoes(semTags(corpo.texto)), base())}${extra ? `\n\n${extra}` : ""}`);
      }
      await marcar({ situacao: "respondida", conversa_id: corpo.conversa ?? conversa });
      return { situacao: "respondida", conversa: corpo.conversa ?? conversa, respostas: n };
    } finally { await s.sair(); }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    console.error("[whatsapp] atender", msg);
    await marcar({ situacao: "falhou", erro: msg.slice(0, 300) });
    await d.enviarTexto(canal.instancia, m.numero, "Não consegui responder agora. Tente de novo em instantes.").catch(() => null);
    return { situacao: "falhou", motivo: msg.slice(0, 120) };
  }
}

async function registrarSaida(admin: SupabaseClient, canal: Canal, contato: string, perfil: string, waId: string | null, tipo: "texto" | "audio") {
  await admin.from("whatsapp_mensagens").insert({ organization_id: canal.organization_id, canal_id: canal.id, contato_id: contato, profile_id: perfil, direcao: "saida",
    wa_id: waId, tipo, situacao: "enviada" }).then(({ error }) => { if (error) console.error("[whatsapp] registro da saída", error.message); });
}

export type { Recebida };
