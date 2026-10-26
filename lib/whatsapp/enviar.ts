import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSessionAccess } from "../auth/session-access";
import { createSupabaseAdminClient } from "../supabase/admin";
import type { Ferramenta } from "../sara/base";
import { BUCKET_DOCUMENTOS } from "../sara/central/documentos";
import { acharPessoa } from "../sara/documentos/documento";
import { enviarAudio, enviarDocumento, enviarTexto, numeroLegivel } from "./evolution";

/**
 * W4 (PLANO-WHATSAPP): a SARA central envia pelo WhatsApp — documentos em PDF, mensagens de voz e texto — a quem
 * está nas listas de um número da plataforma (interna: pessoas da Pecsil; externa: fornecedores, clientes e
 * outros). Pode quem usa a SARA central (o proprietário e quem ele liberou: módulo warroom + warroom.sara).
 * Confirmação: na tela, o Permitir; pelo WhatsApp, o que é para a própria pessoa sai direto na conversa, para outra
 * pessoa da empresa vai uma enquete, e para contato externo segue o Permitir (lib/whatsapp/atender.ts).
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
    .select("id, lista, numero, nome, profile_id, sara_modulo, organization_id, whatsapp_canais!inner(id, instancia, nome, conexao, ativo, created_at)")
    .eq("ativo", true).eq("whatsapp_canais.ativo", true).eq("whatsapp_canais.conexao", "whatsapp_web");
  if (error) throw new Error(`Não consegui ler as listas do WhatsApp: ${error.message}`);
  type L = { id: string; lista: "interna" | "externa"; numero: string; nome: string | null; profile_id: string | null; sara_modulo: string | null; organization_id: string;
    whatsapp_canais: { id: string; instancia: string; nome: string; created_at: string } };
  const linhas = (data ?? []) as unknown as L[];
  const ids = [...new Set(linhas.map((c) => c.profile_id).filter(Boolean))] as string[];
  const { data: perfis, error: eP } = ids.length ? await admin.from("profiles").select("id, full_name, status, access_expires_at").in("id", ids) : { data: [], error: null };
  if (eP) throw new Error(`Não consegui ler os usuários das listas: ${eP.message}`);
  const perfil = new Map(((perfis ?? []) as { id: string; full_name: string; status: string; access_expires_at: string | null }[]).map((p) => [p.id, p]));
  const ativo = (id: string | null) => { const p = id ? perfil.get(id) : null; return Boolean(p && p.status === "active" && (!p.access_expires_at || Date.parse(p.access_expires_at) > Date.now())); };
  return linhas
    .filter((c) => c.lista === "externa" || ativo(c.profile_id))
    // Primeiro o número em que a pessoa fala com a SARA central; depois o mais antigo.
    .sort((a, b) => Number(b.sara_modulo === "warroom") - Number(a.sara_modulo === "warroom") || a.whatsapp_canais.created_at.localeCompare(b.whatsapp_canais.created_at))
    .map((c) => ({ contato: c.id, canal: c.whatsapp_canais.id, instancia: c.whatsapp_canais.instancia, canalNome: c.whatsapp_canais.nome, numero: c.numero,
      nome: (c.lista === "interna" ? perfil.get(c.profile_id ?? "")?.full_name : c.nome) ?? "sem nome", lista: c.lista, organizacao: c.organization_id, perfil: c.profile_id }));
}

const SEM_CENTRAL = "O envio pelo WhatsApp é de quem usa a SARA central.";

/** Quem pode enviar: quem usa a SARA central (os mesmos critérios de prepararCom para a central). */
async function podeUsarACentral(sb: SupabaseClient): Promise<boolean> {
  const access = await readSessionAccess(sb).catch(() => null);
  return Boolean(access && access.canModule("warroom") && access.can("warroom.sara", "ver"));
}

/** "para mim", "me manda", "eu": quem pediu é o destinatário. */
export const ehQuemPede = (nome: string) => /^(para |pra )?(mim|eu|me|o proprio|a propria|o senhor|a senhora|voce)$/i.test(nome.normalize("NFD").replace(/[̀-ͯ]/g, "").trim());

/**
 * Acha o destinatário pelo nome falado ("para mim" = quem pediu); o mesmo contato em dois números conta uma vez
 * (o primeiro, pela ordem).
 */
async function acharDestino(nome: string, sb: SupabaseClient): Promise<Destino | { erro: string }> {
  const lista = await destinos();
  const unicos = lista.filter((d, i) => lista.findIndex((x) => x.nome === d.nome && x.numero === d.numero) === i);
  if (ehQuemPede(nome)) {
    const { data: eu } = await sb.rpc("current_profile_id");
    const meu = unicos.find((d) => d.lista === "interna" && d.perfil === eu);
    return meu ?? { erro: "O seu número não está em nenhuma lista de WhatsApp da plataforma. Cadastre-o em Fundação › WhatsApp." };
  }
  const achou = acharPessoa(nome, unicos.map((d) => ({ id: d.contato, nome: d.nome })));
  if ("erro" in achou) return { erro: `${achou.erro} Pelo WhatsApp, só recebe quem está nas listas de um número da plataforma (Fundação › WhatsApp).` };
  return unicos.find((d) => d.contato === achou.pessoa.id)!;
}

/** O destino de um envio já preparado (o atendimento do WhatsApp entrega direto quando é para quem pediu). */
export async function destinoDoEnvio(sb: SupabaseClient, entrada: Record<string, unknown>): Promise<{ perfil: string | null; lista: "interna" | "externa" } | null> {
  const d = await acharDestino(String(entrada.para ?? ""), sb).catch(() => null);
  return d && !("erro" in d) ? { perfil: d.perfil, lista: d.lista } : null;
}

/** Os documentos pedidos, pelo id interno ou pelo número (DOC-2026-0008), na ordem pedida. */
async function documentos(sb: SupabaseClient, refs: string[]): Promise<Doc[] | { erro: string }> {
  if (!refs.length) return [];
  const ids = refs.filter((x) => UUID.test(x)), numeros = refs.filter((x) => NUMERO.test(x)).map((x) => x.toUpperCase());
  const invalidos = refs.filter((x) => !UUID.test(x) && !NUMERO.test(x));
  if (invalidos.length) return { erro: `Não reconheci ${invalidos.join(", ")}: use o número do documento (DOC-AAAA-NNNN) ou o id que criar_documento devolveu.` };
  const q = sb.from("sara_documentos").select("id, numero, tipo, titulo, caminho");
  const { data } = await (ids.length && numeros.length ? q.or(`id.in.(${ids.join(",")}),numero.in.(${numeros.join(",")})`) : ids.length ? q.in("id", ids) : q.in("numero", numeros));
  const docs = (data ?? []) as Doc[];
  const achar = (r: string) => docs.find((d) => d.id === r || d.numero === r.toUpperCase());
  const falta = refs.filter((r) => !achar(r));
  if (falta.length) return { erro: `Documento não encontrado: ${falta.join(", ")}.` };
  const lista = refs.map((r) => achar(r)!).filter((d, i, l) => l.findIndex((x) => x.id === d.id) === i);
  const semArquivo = lista.filter((d) => !d.caminho);
  if (semArquivo.length) return { erro: `O arquivo de ${semArquivo.map((d) => d.numero).join(", ")} não foi gerado.` };
  return lista;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERO = /^DOC-\d{4}-\d{4,}$/i;
const lerIds = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
const ehVoz = (d: Doc) => d.tipo === "mensagem_voz";

export const ENVIAR_WHATSAPP: Ferramenta = {
  nome: "enviar_pelo_whatsapp", rotulo: "preparou um envio pelo WhatsApp", exige: [],
  descricao: "PREPARA o envio pelo WhatsApp, por um número da plataforma, de documentos já criados (criar_documento: chega como PDF), mensagens de voz já gravadas (criar_mensagem_de_voz: chega como áudio gravado) e/ou um texto, para quem está nas listas de um número da plataforma (pessoas da Pecsil e contatos externos: fornecedores, clientes e outros). Na tela, a pessoa que pediu permite antes. Pelo WhatsApp, o que é para a própria pessoa (\"para mim\") sai direto nesta conversa; para outra pessoa da empresa vai uma enquete para confirmar; para contato externo, o Permitir na plataforma. Diga quem recebe como foi falado (\"para mim\" quando é para quem pediu) e o número (DOC-…) de cada documento. Reaproveite os documentos e mensagens de voz já criados nesta conversa: não crie de novo para enviar.",
  esquema: { type: "object", properties: {
    para: { type: "string", description: "Nome de quem recebe (ex.: \"Júnior\", \"White Martins\")." },
    documentos: { type: "array", items: { type: "string" }, description: "O número de cada documento ou mensagem de voz (ex.: DOC-2026-0008) ou o id que criar_documento/criar_mensagem_de_voz devolveu (até 5)." },
    texto: { type: "string", description: "Mensagem de texto opcional, enviada antes dos arquivos." },
  }, required: ["para"] },
  acao: {
    nivel: "operar", modulos: ["warroom"],
    preparar: async (sb, e) => {
      if (!(await podeUsarACentral(sb))) return { erro: SEM_CENTRAL };
      const d = await acharDestino(String(e.para ?? ""), sb);
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
    if (!(await podeUsarACentral(sb))) throw new Error(SEM_CENTRAL);
    const d = await acharDestino(String(e.para ?? ""), sb);
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
