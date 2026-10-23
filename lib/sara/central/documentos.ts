import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasModuleAccess, normalizeGrants } from "../../../modules/access-catalog";
import { createSupabaseAdminClient } from "../../supabase/admin";
import type { Ferramenta } from "../base";
import { acharPessoa, nomeDoArquivo, textoParaConferir, validarDocumento } from "../documentos/documento";
import { gerarPdf, type Empresa } from "../documentos/pdf";
import { SARAS } from "../modulos";
import type { Visual } from "../visual";
import { conferirNumeros } from "./verificador";

/**
 * Ferramentas de documento da SARA central (só ela as tem; docs/PLANO-MINDMASTER.md › Documentos):
 *   criar_documento   confere cada número com o que as áreas devolveram nesta conversa, gera o PDF com o
 *                     timbre e guarda (bucket privado). Não envia nada.
 *   enviar_documento  AÇÃO: prepara o envio para uma pessoa da empresa e espera o "Permitir"; avisa antes se
 *                     ela não tem acesso a alguma área de onde vieram os dados.
 */

export const BUCKET_DOCUMENTOS = "sara-documentos";
export type DocumentoCriado = { id: string; numero: string; titulo: string; tipo: string; paginas: number };
export type ContextoDocumentos = {
  /** O que as SARAs das áreas e a calculadora devolveram nesta conversa (as fontes dos números). */
  fontes: unknown[];
  /** Visuais que as áreas montaram nesta conversa (o documento aponta por número). */
  visuais: Visual[];
  /** Os documentos criados nesta resposta (a tela mostra a prévia). */
  criados: DocumentoCriado[];
  conversa: string | null;
};

let logo: Uint8Array | null | undefined;
async function logoDaEmpresa(): Promise<Uint8Array | null> {
  if (logo !== undefined) return logo;
  try { logo = new Uint8Array(await readFile(join(process.cwd(), "public", "logo-pecsil.png"))); } catch { logo = null; }
  return logo;
}

async function empresaDe(sb: SupabaseClient): Promise<Empresa> {
  const [{ data }, { data: org }] = await Promise.all([sb.rpc("empresa_dados"), sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle()]);
  const d = (data ?? {}) as Record<string, string | null>;
  const cnpj = String(d.cnpj ?? "").replace(/\D/g, "");
  return {
    razao_social: d.razao_social || org?.legal_name || org?.display_name || "Empresa", nome_fantasia: d.nome_fantasia || org?.display_name || null,
    cnpj: cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : null,
    logradouro: d.logradouro, numero: d.numero, bairro: d.bairro, municipio: d.municipio, uf: d.uf, cep: d.cep, telefone: d.telefone, email: d.email, site: d.site,
  };
}

const MODULOS = Object.values(SARAS).filter((s) => !s.central).map((s) => s.modulo);
const SECAO = {
  type: "object",
  properties: {
    titulo: { type: "string" },
    texto: { type: "string", description: "Parágrafos separados por linha em branco; tópicos começando com \"- \"." },
    visual: { type: "number", description: "Número (1, 2…) de um gráfico ou tabela que a SARA da área montou nesta conversa: a plataforma preenche com os números dela. Prefira isto a digitar números." },
    tabela: { type: "object", properties: { titulo: { type: "string" }, colunas: { type: "array", items: { type: "string" } }, linhas: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } } } },
    grafico: { type: "object", properties: {
      tipo: { type: "string", enum: ["barras", "linhas", "rosca"] }, titulo: { type: "string" }, formato: { type: "string", enum: ["moeda", "numero", "percentual"] },
      rotulos: { type: "array", items: { type: "string" } }, series: { type: "array", items: { type: "object", properties: { nome: { type: "string" }, valores: { type: "array", items: { type: "number" } } } } },
    } },
  },
};

export function ferramentaCriarDocumento(ctx: ContextoDocumentos): Ferramenta {
  return {
    nome: "criar_documento", rotulo: "montou um documento em PDF", exige: [],
    descricao: `Monta um documento em PDF com o timbre da empresa (logo, razão social, CNPJ, endereço) e guarda. NÃO envia: para enviar, use enviar_documento depois. Tipos: "relatorio" (interno: sumário, seções com texto, tabela e gráfico, insights com a confiança, recomendações e quem decide) ou "carta" (oferta, convite, comunicado ou proposta para cliente, fornecedor ou prospect: destinatário, assunto, corpo e assinatura; sem insights). Faça ANTES o levantamento com perguntar_a_sara (e as contas com calcular): todo número do documento é conferido com o que as áreas devolveram nesta conversa; se algum não bater, a ferramenta devolve o erro para você corrigir. Para gráfico ou tabela, prefira apontar o "visual" que a área montou (peça a ela: "…e mostre em barras"). Visuais disponíveis agora: ${ctx.visuais.length || "nenhum"}.`,
    esquema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["relatorio", "carta"] },
        titulo: { type: "string" }, subtitulo: { type: "string" },
        resumo: { type: "string", description: "Relatório: o sumário executivo (o que foi levantado e o principal achado)." },
        secoes: { type: "array", items: SECAO },
        insights: { type: "array", items: { type: "object", properties: { texto: { type: "string" }, confianca: { type: "string", enum: ["alta", "media", "baixa"] } } } },
        recomendacoes: { type: "array", items: { type: "string" } },
        quem_decide: { type: "string" },
        destinatario: { type: "object", properties: { nome: { type: "string" }, cargo: { type: "string" }, empresa: { type: "string" } }, description: "Carta: a quem se destina." },
        assunto: { type: "string", description: "Carta: o assunto." },
        assinatura: { type: "object", properties: { nome: { type: "string" }, cargo: { type: "string" } }, description: "Carta: quem assina (quem pediu, se não disser outro)." },
        areas: { type: "array", items: { type: "string", enum: MODULOS }, description: "Módulos de onde vieram os dados." },
      },
      required: ["tipo", "titulo", "secoes"],
    },
    rodar: async (sb, e) => {
      const v = validarDocumento(e, ctx.visuais, MODULOS);
      if ("erro" in v) return { dados: { erro: v.erro }, fontes: [] };
      // Número só com fonte: o que o modelo escreveu tem de estar no que as áreas (ou a calculadora) devolveram.
      const c = conferirNumeros(textoParaConferir(e), ctx.fontes);
      if (c.semFonte.length) return { dados: { erro: `Estes números não estão no que as áreas devolveram nesta conversa: ${c.semFonte.join(", ")}. Confirme com perguntar_a_sara (ou faça a conta com calcular) e monte de novo; não estime.` }, fontes: [] };
      const { data: reg, error } = await sb.rpc("sara_documento_registrar", { p_tipo: v.documento.tipo, p_titulo: v.documento.titulo, p_conteudo: v.documento, p_areas: v.documento.areas, p_conversa: ctx.conversa });
      if (error || !reg) return { dados: { erro: `Não registrou o documento: ${error?.message ?? "sem resposta"}` }, fontes: [] };
      const { id, numero } = reg as { id: string; numero: string };
      const [empresa, imagem] = await Promise.all([empresaDe(sb), logoDaEmpresa()]);
      const pdf = await gerarPdf(v.documento, { numero, empresa, logo: imagem });
      const { data: org } = await sb.rpc("current_organization_id");
      const caminho = `${org}/${id}/${nomeDoArquivo(numero, v.documento.titulo).replace(/[^\w.\- ]+/g, "")}`;
      const admin = createSupabaseAdminClient();
      const { error: eUp } = await admin.storage.from(BUCKET_DOCUMENTOS).upload(caminho, pdf.bytes, { contentType: "application/pdf", upsert: false });
      if (eUp) return { dados: { erro: `Não guardou o PDF: ${eUp.message}` }, fontes: [] };
      const { error: eArq } = await sb.rpc("sara_documento_arquivo", { p_documento: id, p_caminho: caminho, p_paginas: pdf.paginas, p_bytes: pdf.bytes.length });
      if (eArq) return { dados: { erro: `Não ligou o PDF: ${eArq.message}` }, fontes: [] };
      ctx.criados.push({ id, numero, titulo: v.documento.titulo, tipo: v.documento.tipo, paginas: pdf.paginas });
      return { dados: { criado: true, id, numero, titulo: v.documento.titulo, paginas: pdf.paginas, observacao: "A prévia aparece na tela da pessoa, com o botão para abrir o PDF. Para enviar, use enviar_documento com este id e o nome de quem recebe (ela vai permitir antes)." },
        fontes: [{ rotulo: `Documento ${numero}`, link: `/api/sara/documentos/${id}/pdf` }] };
    },
  };
}

type Pessoa = { id: string; nome: string; isOwner: boolean };
/**
 * Quem pode receber: as pessoas ativas da empresa de quem pede. Lido pelo servidor porque quem pede pode não
 * enxergar os perfis dos outros (só o proprietário enxerga); a empresa é a da sessão.
 */
async function pessoasAtivas(sb: SupabaseClient): Promise<Pessoa[]> {
  const { data: org } = await sb.rpc("current_organization_id");
  if (!org) return [];
  const { data } = await createSupabaseAdminClient().from("profiles").select("id, full_name, is_owner, access_expires_at").eq("organization_id", org).eq("status", "active").limit(1000);
  return ((data ?? []) as { id: string; full_name: string; is_owner: boolean; access_expires_at: string | null }[])
    .filter((p) => !p.access_expires_at || Date.parse(p.access_expires_at) > Date.now()).map((p) => ({ id: p.id, nome: p.full_name, isOwner: p.is_owner }));
}

export const ENVIAR_DOCUMENTO: Ferramenta = {
  nome: "enviar_documento", rotulo: "preparou o envio de um documento", exige: [],
  descricao: "PREPARA o envio de um documento já criado (criar_documento) para uma pessoa da empresa, pela plataforma (aviso no sino e \"Documentos para você\"). A pessoa que pediu permite antes. Diga o id do documento e o nome de quem recebe, como foi falado. Para fora da empresa (e-mail, WhatsApp) ainda não há envio: diga que o PDF pode ser baixado e encaminhado.",
  esquema: { type: "object", properties: { documento: { type: "string", description: "O id que criar_documento devolveu." }, para: { type: "string", description: "Nome de quem recebe (ex.: \"Ana\")." } }, required: ["documento", "para"] },
  acao: {
    nivel: "operar", modulos: ["warroom"],
    preparar: async (sb, e) => {
      const id = String(e.documento ?? "");
      const { data: doc } = await sb.from("sara_documentos").select("id, numero, titulo, areas, caminho").eq("id", id).maybeSingle();
      if (!doc) return { erro: "Documento não encontrado. Use o id que criar_documento devolveu." };
      if (!doc.caminho) return { erro: "O PDF deste documento não foi gerado." };
      const pessoas = await pessoasAtivas(sb);
      const achou = acharPessoa(String(e.para ?? ""), pessoas);
      if ("erro" in achou) return achou;
      const p = pessoas.find((x) => x.id === achou.pessoa.id)!;
      // Quem recebe enxerga as áreas de onde vieram os dados? Se não, quem pede decide sabendo.
      let semAcesso: string[] = [];
      if (!p.isOwner) {
        // Só as permissões DE QUEM RECEBE (o "proprietário" da sessão é de quem pede).
        const { data: g } = await createSupabaseAdminClient().from("user_feature_grants").select("feature_code, level").eq("profile_id", p.id);
        const grants = normalizeGrants(Object.fromEntries(((g ?? []) as { feature_code: string; level: string }[]).map((r) => [r.feature_code, r.level])));
        semAcesso = ((doc.areas ?? []) as string[]).filter((m) => SARAS[m] && !hasModuleAccess({ isOwner: false, grants }, SARAS[m].feature)).map((m) => SARAS[m].rotulo);
      }
      return {
        resumo: `Enviar o documento ${doc.numero} «${doc.titulo}» para ${p.nome}, pela plataforma`,
        detalhes: [`${p.nome} recebe o aviso no sino e o PDF em "Documentos para você".`,
          ...(semAcesso.length ? [`Atenção: ${p.nome} não tem acesso a ${semAcesso.join(", ")} na plataforma; o documento mostra dados dessas áreas.`] : [])],
        risco: semAcesso.length ? "alto" : "normal",
      };
    },
  },
  rodar: async (sb, e) => {
    const pessoas = await pessoasAtivas(sb);
    const achou = acharPessoa(String(e.para ?? ""), pessoas);
    if ("erro" in achou) throw new Error(achou.erro);
    const { data, error } = await sb.rpc("sara_documento_enviar", { p_documento: String(e.documento ?? ""), p_para: achou.pessoa.id });
    if (error) throw new Error(error.message);
    const r = data as { enviado?: boolean; ja_enviado?: boolean; para: string; numero?: string };
    return { dados: { feito: r.ja_enviado ? `${r.para} já tinha recebido este documento.` : `Documento ${r.numero} enviado para ${r.para}.` }, fontes: [] };
  },
};

/** Para as SARAs dos módulos: os documentos que a central mandou para a pessoa (só leitura). */
export const DOCUMENTOS_RECEBIDOS: Ferramenta = {
  nome: "documentos_recebidos", rotulo: "documentos recebidos da SARA central", exige: [],
  descricao: "Os documentos em PDF que a SARA central enviou para a pessoa (relatórios e cartas), com número, título, quem enviou, quando e se já abriu. A pessoa abre o PDF em \"Documentos para você\" (menu da conta).",
  esquema: { type: "object", properties: {} },
  rodar: async (sb) => {
    const { data, error } = await sb.rpc("sara_documentos_recebidos");
    if (error) throw new Error(error.message);
    const lista = (data ?? []) as { id: string }[];
    return { dados: { documentos: lista, quantidade: lista.length }, fontes: lista.slice(0, 5).map((d) => ({ rotulo: "Documento recebido (PDF)", link: `/api/sara/documentos/${d.id}/pdf` })) };
  },
};
