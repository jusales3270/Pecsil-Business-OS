import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../supabase/admin";
import type { Ferramenta } from "../sara/base";
import { BUCKET_DOCUMENTOS } from "../sara/central/documentos";
import { acharPessoa } from "../sara/documentos/documento";
import { enviarAudio, enviarDocumento, enviarTexto, numeroLegivel } from "./evolution";

/**
 * W4 (PLANO-WHATSAPP): a SARA central envia pelo WhatsApp — documentos em PDF, mensagens de voz e texto — a quem
 * está nas listas de um número da plataforma (interna: pessoas da Pecsil; externa: fornecedores, clientes e
 * outros). Sempre com o Permitir de quem pediu, e por enquanto só o proprietário (como a própria central).
 * Sai pelo número em cuja lista o destinatário está (o da SARA central primeiro). Tudo fica registrado.
 */

type Destino = { contato: string; canal: string; instancia: string; canalNome: string; numero: string; nome: string; lista: "interna" | "externa"; organizacao: string; perfil: string | null };
type Doc = { id: string; numero: string; tipo: string; titulo: string; caminho: string | null };

/** Quem pode receber: os contatos ativos das listas dos números ativos (conectados pelo QR). */
async function destinos(): Promise<Destino[]> {
  const admin = createSupabaseAdminClient();
  // O usuário de cada contato vem numa consulta à parte: whatsapp_contatos liga a profiles duas vezes (o usuário e
  // quem cadastrou), e o embutido ficaria ambíguo.
  const { data, error } = await admin.from("whatsapp_contatos")
    .select("id, lista, numero, nome, profile_id, organization_id, whatsapp_canais!inner(id, instancia, nome, sara_modulo, conexao, ativo, created_at)")
    .eq("ativo", true).eq("whatsapp_canais.ativo", true).eq("whatsapp_canais.conexao", "whatsapp_web");
  if (error) throw new Error(`Não consegui ler as listas do WhatsApp: ${error.message}`);
  type L = { id: string; lista: "interna" | "externa"; numero: string; nome: string | null; profile_id: string | null; organization_id: string;
    whatsapp_canais: { id: string; instancia: string; nome: string; sara_modulo: string | null; created_at: string } };
  const linhas = (data ?? []) as unknown as L[];
  const ids = [...new Set(linhas.map((c) => c.profile_id).filter(Boolean))] as string[];
  const { data: perfis, error: eP } = ids.length ? await admin.from("profiles").select("id, full_name, status, access_expires_at").in("id", ids) : { data: [], error: null };
  if (eP) throw new Error(`Não consegui ler os usuários das listas: ${eP.message}`);
  const perfil = new Map(((perfis ?? []) as { id: string; full_name: string; status: string; access_expires_at: string | null }[]).map((p) => [p.id, p]));
  const ativo = (id: string | null) => { const p = id ? perfil.get(id) : null; return Boolean(p && p.status === "active" && (!p.access_expires_at || Date.parse(p.access_expires_at) > Date.now())); };
  return linhas
    .filter((c) => c.lista === "externa" || ativo(c.profile_id))
    // O número da SARA central primeiro; depois o mais antigo.
    .sort((a, b) => Number(b.whatsapp_canais.sara_modulo === "warroom") - Number(a.whatsapp_canais.sara_modulo === "warroom") || a.whatsapp_canais.created_at.localeCompare(b.whatsapp_canais.created_at))
    .map((c) => ({ contato: c.id, canal: c.whatsapp_canais.id, instancia: c.whatsapp_canais.instancia, canalNome: c.whatsapp_canais.nome, numero: c.numero,
      nome: (c.lista === "interna" ? perfil.get(c.profile_id ?? "")?.full_name : c.nome) ?? "sem nome", lista: c.lista, organizacao: c.organization_id, perfil: c.profile_id }));
}

/** Acha o destinatário pelo nome falado; o mesmo contato em dois números conta uma vez (o primeiro, pela ordem). */
async function acharDestino(nome: string): Promise<Destino | { erro: string }> {
  const lista = await destinos();
  const unicos = lista.filter((d, i) => lista.findIndex((x) => x.nome === d.nome && x.numero === d.numero) === i);
  const achou = acharPessoa(nome, unicos.map((d) => ({ id: d.contato, nome: d.nome })));
  if ("erro" in achou) return { erro: `${achou.erro} Pelo WhatsApp, só recebe quem está nas listas de um número da plataforma (Fundação › WhatsApp).` };
  return unicos.find((d) => d.contato === achou.pessoa.id)!;
}

async function documentos(sb: SupabaseClient, ids: string[]): Promise<Doc[] | { erro: string }> {
  if (!ids.length) return [];
  const { data } = await sb.from("sara_documentos").select("id, numero, tipo, titulo, caminho").in("id", ids);
  const docs = (data ?? []) as Doc[];
  const falta = ids.filter((id) => !docs.some((d) => d.id === id));
  if (falta.length) return { erro: "Documento não encontrado. Use o id que criar_documento ou criar_mensagem_de_voz devolveu." };
  const semArquivo = docs.filter((d) => !d.caminho);
  if (semArquivo.length) return { erro: `O arquivo de ${semArquivo.map((d) => d.numero).join(", ")} não foi gerado.` };
  return ids.map((id) => docs.find((d) => d.id === id)!);
}

const lerIds = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5);
const ehVoz = (d: Doc) => d.tipo === "mensagem_voz";

export const ENVIAR_WHATSAPP: Ferramenta = {
  nome: "enviar_pelo_whatsapp", rotulo: "preparou um envio pelo WhatsApp", exige: [],
  descricao: "PREPARA o envio pelo WhatsApp, por um número da plataforma, de documentos já criados (criar_documento: chega como PDF), mensagens de voz já gravadas (criar_mensagem_de_voz: chega como áudio gravado) e/ou um texto, para quem está nas listas de um número da plataforma (pessoas da Pecsil e contatos externos: fornecedores, clientes e outros). A pessoa que pediu permite antes. Diga o nome de quem recebe como foi falado e os ids dos documentos.",
  esquema: { type: "object", properties: {
    para: { type: "string", description: "Nome de quem recebe (ex.: \"Júnior\", \"White Martins\")." },
    documentos: { type: "array", items: { type: "string" }, description: "Ids que criar_documento ou criar_mensagem_de_voz devolveram (até 5)." },
    texto: { type: "string", description: "Mensagem de texto opcional, enviada antes dos arquivos." },
  }, required: ["para"] },
  acao: {
    nivel: "operar", modulos: ["warroom"],
    preparar: async (sb, e) => {
      const { data: dono } = await sb.rpc("is_owner");
      if (!dono) return { erro: "O envio pelo WhatsApp é do proprietário, por enquanto." };
      const d = await acharDestino(String(e.para ?? ""));
      if ("erro" in d) return d;
      const docs = await documentos(sb, lerIds(e.documentos));
      if ("erro" in docs) return docs;
      const texto = String(e.texto ?? "").trim();
      if (!docs.length && !texto) return { erro: "Diga o que enviar: um documento, uma mensagem de voz ou um texto." };
      return {
        resumo: `Enviar pelo WhatsApp «${d.canalNome}» para ${d.nome} (${numeroLegivel(d.numero)}${d.lista === "externa" ? ", contato externo" : ""})`,
        detalhes: [...(texto ? [`Texto: ${texto.slice(0, 300)}`] : []), ...docs.map((x) => `${x.numero} · ${x.titulo} (${ehVoz(x) ? "mensagem de voz" : "PDF"})`)],
        risco: d.lista === "externa" ? "alto" : "normal",
      };
    },
  },
  rodar: async (sb, e) => {
    const { data: dono } = await sb.rpc("is_owner");
    if (!dono) throw new Error("O envio pelo WhatsApp é do proprietário, por enquanto.");
    const d = await acharDestino(String(e.para ?? ""));
    if ("erro" in d) throw new Error(d.erro);
    const docs = await documentos(sb, lerIds(e.documentos));
    if ("erro" in docs) throw new Error(docs.erro);
    const admin = createSupabaseAdminClient();
    const registrar = async (waId: string | null, tipo: "texto" | "audio" | "documento") => {
      await admin.from("whatsapp_mensagens").insert({ organization_id: d.organizacao, canal_id: d.canal, contato_id: d.contato, profile_id: d.perfil, direcao: "saida", wa_id: waId,
        numero_final: d.numero.slice(-4), tipo, situacao: "enviada" }).then(({ error }) => { if (error) console.error("[whatsapp] registro do envio", error.message); });
    };
    const feitos: string[] = [];
    const texto = String(e.texto ?? "").trim();
    if (texto) { await registrar((await enviarTexto(d.instancia, d.numero, texto.slice(0, 3500))).id, "texto"); feitos.push("o texto"); }
    for (const doc of docs) {
      const { data: arq, error } = await admin.storage.from(BUCKET_DOCUMENTOS).download(doc.caminho!);
      if (error || !arq) throw new Error(`Não consegui ler o arquivo de ${doc.numero}.`);
      const base64 = Buffer.from(await arq.arrayBuffer()).toString("base64");
      if (ehVoz(doc)) { await registrar((await enviarAudio(d.instancia, d.numero, base64)).id, "audio"); feitos.push(`a mensagem de voz ${doc.numero}`); }
      else {
        const nome = `${doc.numero} - ${doc.titulo}`.replace(/[\\/:*?"<>|]/g, " ").slice(0, 120);
        await registrar((await enviarDocumento(d.instancia, d.numero, base64, `${nome}.pdf`, doc.titulo)).id, "documento");
        feitos.push(`o documento ${doc.numero}`);
      }
    }
    return { dados: { feito: `Enviado pelo WhatsApp «${d.canalNome}» para ${d.nome}: ${feitos.join(", ")}.` }, fontes: [] };
  },
};
