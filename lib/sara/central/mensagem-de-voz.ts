import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../../supabase/admin";
import type { Ferramenta } from "../base";
import { paraVoz } from "../personalidade";
import { IDIOMA, vozDaSara } from "./voz-ao-vivo";
import { BUCKET_DOCUMENTOS, type ContextoDocumentos } from "./documentos";
import { conferirNumeros } from "./verificador";

/**
 * Mensagem de voz da SARA central para WhatsApp (proprietário, 23/10/2026): é o ÚNICO uso da API de texto
 * para fala do Grok (`/v1/tts`), com a mesma voz da SARA ("luna", pt-BR). A voz da SARA na plataforma e,
 * depois, nas ligações telefônicas é a sessão Realtime; a mensagem gravada para mandar a alguém é esta.
 *   - O texto é conferido como os documentos: todo número tem de estar no que as áreas devolveram.
 *   - As expressões da personalidade (*suspira*, *pausa breve*…) viram as tags do motor (nunca lidas).
 *   - O áudio (MP3) fica no bucket privado dos documentos, como um documento do tipo mensagem_voz.
 *   - O ENVIO pelo WhatsApp depende do número dedicado (B-04): até lá, a mensagem fica pronta para ouvir e baixar.
 */

export const URL_TTS = "https://api.x.ai/v1/tts";
export const MAX_MENSAGEM = 1500;

/** O pedido para a API de texto para fala: a voz da SARA, em pt-BR, MP3. */
export function pedidoDeMensagem(texto: string) {
  return { text: paraVoz(texto).replace(/\s+/g, " ").trim().slice(0, MAX_MENSAGEM), voice_id: vozDaSara(), language: IDIOMA, output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 64000 } };
}

/** Grava a mensagem na voz da SARA. A chave (XAI_API_KEY) fica só no servidor. */
export async function gravarMensagemDeVoz(texto: string, buscar: typeof fetch = fetch): Promise<Uint8Array> {
  const chave = process.env.XAI_API_KEY?.trim();
  if (!chave) throw new Error("A voz da SARA não está configurada (falta a chave da xAI).");
  const r = await buscar(URL_TTS, { method: "POST", signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${chave}`, "content-type": "application/json" }, body: JSON.stringify(pedidoDeMensagem(texto)) });
  if (!r.ok) throw new Error(`A gravação da voz falhou (${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}

export function ferramentaCriarMensagemDeVoz(ctx: ContextoDocumentos): Ferramenta {
  return {
    nome: "criar_mensagem_de_voz", rotulo: "gravou uma mensagem de voz", exige: [],
    descricao: "Grava uma MENSAGEM DE VOZ na voz da SARA, para ser mandada por WhatsApp a alguém (colaborador, cliente, fornecedor). Use SÓ quando pedirem uma mensagem de voz ou um áudio para mandar. Faça antes o levantamento com perguntar_a_sara: todo número da mensagem é conferido com o que as áreas devolveram. Escreva como se fala (curto, até 1 minuto), com o tratamento certo para quem recebe. O envio pelo WhatsApp ainda depende do número dedicado da empresa: diga que a mensagem ficou pronta para ouvir e baixar.",
    esquema: {
      type: "object",
      properties: {
        para: { type: "string", description: "A quem se destina (nome e, se houver, a empresa)." },
        titulo: { type: "string", description: "Do que se trata, em poucas palavras." },
        texto: { type: "string", description: "O que a SARA vai falar, até 1.500 caracteres." },
        areas: { type: "array", items: { type: "string" }, description: "Módulos de onde vieram os dados." },
      },
      required: ["para", "titulo", "texto"],
    },
    rodar: async (sb: SupabaseClient, e) => {
      const texto = String(e.texto ?? "").trim();
      const titulo = String(e.titulo ?? "").trim().slice(0, 140) || "Mensagem de voz";
      const para = String(e.para ?? "").trim().slice(0, 120);
      if (texto.length < 5 || !para) return { dados: { erro: "Diga para quem é e o que a mensagem fala." }, fontes: [] };
      if (texto.length > MAX_MENSAGEM) return { dados: { erro: `A mensagem passou de ${MAX_MENSAGEM} caracteres: encurte (o ideal é até 1 minuto).` }, fontes: [] };
      const c = conferirNumeros(texto, ctx.fontes);
      if (c.semFonte.length) return { dados: { erro: `Estes números não estão no que as áreas devolveram nesta conversa: ${c.semFonte.join(", ")}. Confirme com perguntar_a_sara e grave de novo; não estime.` }, fontes: [] };
      const { data: reg, error } = await sb.rpc("sara_documento_registrar", { p_tipo: "mensagem_voz", p_titulo: `${titulo} (para ${para})`.slice(0, 160),
        p_conteudo: { para, texto }, p_areas: (Array.isArray(e.areas) ? e.areas : []).map(String), p_conversa: ctx.conversa });
      if (error || !reg) return { dados: { erro: `Não registrou a mensagem: ${error?.message ?? "sem resposta"}` }, fontes: [] };
      const { id, numero } = reg as { id: string; numero: string };
      let audio: Uint8Array;
      try { audio = await gravarMensagemDeVoz(texto); }
      catch (err) { return { dados: { erro: err instanceof Error ? err.message : "A gravação falhou." }, fontes: [] }; }
      const { data: org } = await sb.rpc("current_organization_id");
      const caminho = `${org}/${id}/${numero} mensagem de voz.mp3`;
      const { error: eUp } = await createSupabaseAdminClient().storage.from(BUCKET_DOCUMENTOS).upload(caminho, audio, { contentType: "audio/mpeg", upsert: false });
      if (eUp) return { dados: { erro: `Não guardou o áudio: ${eUp.message}` }, fontes: [] };
      const { error: eArq } = await sb.rpc("sara_documento_arquivo", { p_documento: id, p_caminho: caminho, p_paginas: null, p_bytes: audio.length });
      if (eArq) return { dados: { erro: `Não ligou o áudio: ${eArq.message}` }, fontes: [] };
      ctx.criados.push({ id, numero, titulo: `${titulo} (para ${para})`, tipo: "mensagem_voz", paginas: 0 });
      return { dados: { gravada: true, id, numero, observacao: "A mensagem aparece na tela para ouvir e baixar. O envio pelo WhatsApp ainda depende do número dedicado da empresa." },
        fontes: [{ rotulo: `Mensagem de voz ${numero}`, link: `/api/sara/documentos/${id}/arquivo` }] };
    },
  };
}
