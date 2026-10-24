import type { SupabaseClient } from "@supabase/supabase-js";
import { iniciarPasso, passoFeito, textoDoPasso } from "./progresso.ts";
import { filtrarEstado } from "../decisao/guard.ts";
import { semPensar, type Proposta } from "./base.ts";
import type { Abrir, Ferramenta, Fonte } from "./ferramentas.ts";
import { dicaVisual, MOSTRAR, resolverVisual, type ResultadoConsulta, type Visual } from "./visual.ts";

/**
 * Laço da conversa da SARA com o Claude (Anthropic) por *tool use*. Não lê o ambiente (a chave e o
 * fetch entram por parâmetro; quem lê a chave é lib/sara/claude.ts, só no servidor), então é testável.
 * As ferramentas rodam com a sessão de quem pergunta: a credencial (e o RLS do banco) é a ÚNICA
 * restrição — o que a consulta devolve vai inteiro (decisão do proprietário, 20/10/2026). Máximo de 6
 * rodadas de ferramenta por pergunta.
 *
 * Cache de prompt da Anthropic: a parte fixa (ferramentas + manual + regras) é marcada para cache e
 * cobrada bem mais barato quando se repete; a parte do dia (data, nome, permissões) vem depois dela.
 * A última mensagem também é marcada, para a rodada seguinte da mesma pergunta reaproveitar a conversa.
 *
 * Sem "pensamento" (thinking) no copiloto: medido em 17/10, ele não mudou as consultas escolhidas e
 * custava ~23% de tempo e ~29% dos tokens de saída. O raciocínio profundo fica para o modo conselheiro.
 */

export type MensagemHistorico = { papel: "pessoa" | "sara"; texto: string };
/** Foto enviada com a pergunta (E2): vai ao modelo nesta pergunta e não fica guardada. */
export type Imagem = { tipo: "image/jpeg" | "image/png" | "image/webp"; dados: string };
/** Documento anexado à pergunta (E5): o texto já lido no servidor; vai só nesta pergunta. */
export type Anexo = { nome: string; texto: string };
/** Vai com o resultado de abrir_tela/mostrar quando a pessoa ainda não viu nenhuma resposta. */
export const LEMBRETE_RESPOSTA = "A pessoa ainda não viu nenhuma resposta (o que você pensa não aparece para ela): escreva agora a resposta completa, com os números, a explicação e o próximo passo.";
const SO_ACAO = new Set(["abrir_tela", "abrir_lancamento", "mostrar", "registrar_lacuna", "propor_habilidade"]);

/** Ação que a SARA preparou e espera o "Permitir" da pessoa (nada foi gravado). */
export type AcaoProposta = Proposta & { ferramenta: string; entrada: Record<string, unknown> };
/** Volta ao modelo quando a ação foi preparada: ele só avisa o que vai acontecer. */
export const AVISO_PROPOSTA = "Preparado, mas NADA foi feito ainda: a pessoa vê agora um cartão com o resumo e os botões Permitir e Não permitir. Escreva em uma ou duas frases o que vai acontecer quando ela tocar em Permitir. Não diga que já fez.";
const MAX_PROPOSTAS = 3;

export type RespostaSara = {
  texto: string; fontes: Fonte[]; abrir: Abrir | null; ferramentas: { nome: string; entrada: unknown; ok: boolean }[];
  /** tokensEntrada inclui os tokens lidos do cache e os gravados nele (volume total de entrada). */
  tokensEntrada: number; tokensSaida: number; cacheLido: number; cacheGravado: number; modelo: string;
  /** Visuais montados pela plataforma com o resultado das consultas (o modelo só apontou). */
  visuais: Visual[];
  /** Ações preparadas nesta resposta (a pessoa decide no cartão). */
  acoes: AcaoProposta[];
  /** O que cada consulta devolveu (o verificador da SARA central confere os números da resposta com isto). */
  resultados?: { nome: string; rotulo?: string; dados: unknown; fontes?: Fonte[] }[];
  /** Quanto levou cada chamada ao modelo e cada consulta (ms), para medir onde vai o tempo. */
  tempos?: { etapa: string; ms: number }[];
};
export type Sistema = string | { fixo: string; variavel: string };

const CACHE = { type: "ephemeral" } as const;
const blocosDoSistema = (s: Sistema) => (typeof s === "string" ? s : [{ type: "text", text: s.fixo, cache_control: CACHE }, ...(s.variavel ? [{ type: "text", text: s.variavel }] : [])]);
/** Cópia das mensagens com a marca de cache no último bloco da última mensagem. */
function comCacheNoFim(mensagens: { role: "user" | "assistant"; content: unknown }[]) {
  if (!mensagens.length) return mensagens;
  const ultima = mensagens[mensagens.length - 1];
  const blocos = typeof ultima.content === "string" ? [{ type: "text", text: ultima.content }] : [...(ultima.content as Record<string, unknown>[])];
  blocos[blocos.length - 1] = { ...blocos[blocos.length - 1], cache_control: CACHE };
  return [...mensagens.slice(0, -1), { role: ultima.role, content: blocos }];
}

const API = "https://api.anthropic.com/v1/messages";
/** Frase curta de passagem antes de uma consulta ("Vou consultar as contas…"), que não é resposta. */
const PASSAGEM = /^(vou|deixa eu|deixe-me|um momento|já vou|só um instante)\b[^\n]{0,160}$/i;
/** Frase em que o modelo comenta o próprio raciocínio ("é uma dúvida de conceito, então respondo com meu conhecimento"). */
const META = /[^.!?\n]*\b(então respondo|respondo (com|pelo|a partir d[oe]) (o )?meu conhecimento|sem consultar a plataforma|é uma dúvida de (conceito|conhecimento)|respondo direto|isso é conhecimento geral sobre a regra|(os|o) campos? do mostrar|(não|nao) aceit(ou|aram) o caminho|apontam para as consultas|vou refazer (com|o|a)|(a|o) ferramenta (mostrar|calcular)|chamada (do|de) mostrar)\b[^.!?\n]*[.!?]\s*/gi;
/** Linha que só anuncia o próximo passo ("Vou mostrar o comparativo por terceiro."), sem número. */
const PASSAGEM_LINHA = /^(agora\s+)?(vou|deixa eu|deixe-me|vamos)\s+(mostrar|montar|consultar|buscar|pesquisar|verificar|conferir|confirmar|trazer|levantar|calcular|separar|detalhar|abrir|ver)\b[^\d\n]{0,120}[.:…]?$/i;
const RODADAS = 6;

type Citacao = { type?: string; url?: string; title?: string };
type Bloco =
  | { type: "text"; text: string; citations?: Citacao[] }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "server_tool_use"; id: string; name: string; input: { query?: string } }
  | { type: "web_search_tool_result"; tool_use_id: string; content: unknown };

/** Pesquisa na internet (ferramenta da própria Anthropic), só nos sites do tema do módulo. */
export type Pesquisa = { dominios: string[]; maxBuscas?: number };

/**
 * O texto de uma rodada: sem a narração escrita logo antes de uma pesquisa ("Vou pesquisar…"),
 * e com as citações da pesquisa separadas como fontes externas.
 */
export function textoECitacoes(conteudo: Bloco[]) {
  // Texto picado pela pesquisa: há busca nesta rodada ou citações (a continuação de uma pesquisa pausada
  // traz o texto citado sem o bloco da busca).
  const pesquisou = conteudo.some((b) => b.type === "server_tool_use" || (b.type === "text" && Boolean(b.citations?.length)));
  const partes: string[] = [];
  const citacoes: Fonte[] = [];
  conteudo.forEach((b, i) => {
    if (b.type !== "text") return;
    const proximo = conteudo.slice(i + 1).find((x) => x.type !== "text");
    if (proximo?.type === "server_tool_use") return; // narração antes da busca
    partes.push(b.text);
    for (const c of b.citations ?? []) {
      if (!c.url || !/^https:\/\//.test(c.url)) continue;
      let host = c.url;
      try { host = new URL(c.url).hostname.replace(/^www\./, ""); } catch { /* fica a url */ }
      citacoes.push({ rotulo: `Internet › ${host}`, link: c.url });
    }
  });
  // Com pesquisa, o texto vem picado em blocos (um por citação): junta sem quebrar a frase.
  return { texto: partes.join(pesquisou ? "" : "\n"), citacoes };
}

export async function conversarCom(sb: SupabaseClient, a: {
  chave: string; buscar?: typeof fetch; modelo: string; sistema: Sistema; historico: MensagemHistorico[]; pergunta: string; ferramentas: Ferramenta[];
  /** Cancela a conversa (o verificador de escopo deu FORA). */
  sinal?: AbortSignal;
  /** Rodadas de ferramenta (padrão 6). A SARA central precisa de mais: levantamento, contas, documento e envio. */
  rodadas?: number;
  /** Nomes de todas as consultas da plataforma: separa "sem permissão" de "não existe essa consulta". */
  todasAsConsultas?: string[];
  /** Pesquisa na internet restrita ao tema do módulo (sem ela, a SARA não pesquisa). */
  pesquisa?: Pesquisa | null;
  /** Tamanho máximo de cada resposta do modelo (padrão 1.500; a SARA de TI usa mais). */
  maxTokens?: number;
  /** Foto da pergunta (chão de fábrica): etiqueta, peça, material. */
  imagem?: Imagem | null;
  /** Documento anexado (Excel, Word, PDF, texto), já em texto. */
  anexo?: Anexo | null;
  /** Quantos visuais por resposta (padrão 4; a SARA central monta painéis de até 8). */
  maxVisuais?: number;
}): Promise<RespostaSara> {
  const chave = a.chave;
  const buscar = a.buscar ?? fetch;
  if (!chave) throw new Error("NAO_CONFIGURADA");
  const mensagens: { role: "user" | "assistant"; content: unknown }[] = [
    ...a.historico.slice(-12).map((m) => ({ role: (m.papel === "pessoa" ? "user" : "assistant") as "user" | "assistant", content: m.texto })),
    { role: "user", content: a.imagem || a.anexo
      ? [
          ...(a.imagem ? [{ type: "image", source: { type: "base64", media_type: a.imagem.tipo, data: a.imagem.dados } }] : []),
          ...(a.anexo ? [{ type: "text", text: `Documento anexado pela pessoa ("${a.anexo.nome}"), já em texto:\n<<<\n${a.anexo.texto}\n>>>` }] : []),
          { type: "text", text: a.pergunta },
        ]
      : a.pergunta },
  ];
  const tools: Record<string, unknown>[] = a.ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.esquema }));
  if (a.pesquisa?.dominios.length) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: a.pesquisa.maxBuscas ?? 3, allowed_domains: a.pesquisa.dominios,
      user_location: { type: "approximate", country: "BR", region: "São Paulo", timezone: "America/Sao_Paulo" } });
  }
  const fontes: Fonte[] = [];
  let abrir: Abrir | null = null;
  const usadas: RespostaSara["ferramentas"] = [];
  let tokensEntrada = 0, tokensSaida = 0, cacheLido = 0, cacheGravado = 0;
  // O texto de todas as rodadas: o modelo pode escrever a resposta antes de pedir uma ferramenta
  // (ex.: dá o total e depois abre a tela). Ficar só com a última rodada perdia essa parte.
  const textos: string[] = [];
  // Resultado de cada consulta desta resposta, para montar os visuais.
  const resultados: ResultadoConsulta[] = [];
  const visuais: Visual[] = [];
  const acoes: AcaoProposta[] = [];
  const ehAcao = (nome: string) => Boolean(a.ferramentas.find((x) => x.nome === nome)?.acao);
  // Sem as frases de passagem ("Vou consultar…") e sem repetir o que já foi dito.
  const juntar = () => {
    // Frase de passagem solta no meio do texto ("Vou mostrar o comparativo…") também sai.
    // Linha a linha, preservando as quebras (parágrafo continua parágrafo).
    const limpar = (t: string) => t.split(/(\n+)/).map((p) => (/^\n+$/.test(p) ? p : PASSAGEM_LINHA.test(p.replace(META, "").trim()) ? "" : p.replace(META, "").trimEnd()))
      .join("").replace(/\n{3,}/g, "\n\n").trim();
    const partes = textos.map((t) => limpar(t.trim())).filter(Boolean);
    return partes.filter((t, i) => !(i < partes.length - 1 && (PASSAGEM.test(t) || partes.slice(i + 1).some((d) => d.includes(t))))).join("\n\n");
  };

  const podeMostrar = a.ferramentas.some((x) => x.nome === MOSTRAR.nome);
  const executar = async (nome: string, entrada: Record<string, unknown>): Promise<{ conteudo: string; ok: boolean }> => {
    if (nome === MOSTRAR.nome && podeMostrar) {
      const r = resolverVisual(entrada, resultados);
      if ("erro" in r) return { conteudo: JSON.stringify({ erro: r.erro }), ok: false };
      if (visuais.length < (a.maxVisuais ?? 4)) visuais.push(r.visual);
      return { conteudo: JSON.stringify({ mostrado: true, componente: r.visual.componente, observacao: "O visual aparece abaixo do seu texto: não repita os números dele no texto, só o resumo." }), ok: true };
    }
    const f = a.ferramentas.find((x) => x.nome === nome);
    if (!f) {
      // Nome que não é consulta nenhuma (ex.: o id de uma tela) é engano do modelo, não falta de permissão.
      const existe = (a.todasAsConsultas ?? []).includes(nome);
      return { conteudo: JSON.stringify({ erro: existe
        ? "Sem permissão: esta pessoa não tem a credencial desta consulta."
        : `Não existe consulta chamada "${nome}". Se for uma tela, use abrir_tela; para dados, use uma das suas consultas (ou consultar_dados).` }), ok: false };
    }
    if (f.acao) {
      // Ação: só prepara (confere a entrada e monta o resumo). Quem executa é a pessoa, no cartão.
      if (acoes.length >= MAX_PROPOSTAS) return { conteudo: JSON.stringify({ erro: "Já há ações demais esperando a pessoa decidir nesta resposta." }), ok: false };
      try {
        const p = await f.acao.preparar(sb, entrada);
        if ("erro" in p) return { conteudo: JSON.stringify({ erro: p.erro }), ok: false };
        acoes.push({ ...p, ferramenta: f.nome, entrada });
        return { conteudo: JSON.stringify({ preparado: true, resumo: p.resumo, observacao: AVISO_PROPOSTA }), ok: true };
      } catch (e) { return { conteudo: JSON.stringify({ erro: `Não consegui preparar: ${e instanceof Error ? e.message.slice(0, 200) : "erro"}` }), ok: false }; }
    }
    try {
      const res = await f.rodar(sb, entrada);
      const json = JSON.stringify(res.dados);
      fontes.push(...res.fontes);
      if (res.abrir) abrir = res.abrir;
      resultados.push({ nome, rotulo: f.rotulo ?? nome.replace(/_/g, " "), dados: res.dados, fontes: res.fontes });
      // O resultado bruto das consultas das áreas (SARA central): fica aqui para o mostrar, não vai ao modelo.
      if (res.paraVisual?.length) resultados.push(...res.paraVisual);
      const dica = podeMostrar && !res.abrir ? dicaVisual(nome, res.dados) : null;
      return { conteudo: json.slice(0, 30_000) + (dica ? `\n\n${dica}` : ""), ok: true };
    } catch (e) { return { conteudo: JSON.stringify({ erro: `A consulta falhou: ${e instanceof Error ? e.message.slice(0, 200) : "erro"}` }), ok: false }; }
  };


  const tempos: { etapa: string; ms: number }[] = [];
  for (let rodada = 0; rodada < (a.rodadas ?? RODADAS); rodada++) {
    if (a.sinal?.aborted) throw new Error("CANCELADA");
    const inicioModelo = Date.now();
    // Na tela: o que a SARA está fazendo agora (o modelo pensando é o passo mais longo).
    const pensando = iniciarPasso("pensando", rodada === 0 ? "Entendendo o pedido" : "Analisando o que encontrou");
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 60_000);
    const cancelar = () => ctrl.abort();
    a.sinal?.addEventListener("abort", cancelar);
    let r: Response;
    try {
      r = await buscar(API, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: a.modelo, max_tokens: a.maxTokens ?? 1500, thinking: semPensar(a.modelo), system: blocosDoSistema(a.sistema), messages: comCacheNoFim(mensagens), ...(tools.length ? { tools } : {}) }),
      });
    } catch (e) {
      pensando.fim(false);
      if (a.sinal?.aborted) throw new Error("CANCELADA");
      throw e;
    } finally { clearTimeout(relogio); a.sinal?.removeEventListener("abort", cancelar); }
    const corpo = await r.json().catch(() => null) as { content?: Bloco[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; error?: { message?: string } } | null;
    pensando.fim(Boolean(r.ok && corpo?.content));
    if (!r.ok || !corpo?.content) throw new Error(`MODELO_INDISPONIVEL: ${r.status} ${corpo?.error?.message ?? ""}`.trim());
    tempos.push({ etapa: `modelo ${rodada + 1} (${corpo.usage?.output_tokens ?? 0} tokens de saída)`, ms: Date.now() - inicioModelo });
    cacheLido += corpo.usage?.cache_read_input_tokens ?? 0;
    cacheGravado += corpo.usage?.cache_creation_input_tokens ?? 0;
    tokensEntrada += (corpo.usage?.input_tokens ?? 0) + (corpo.usage?.cache_read_input_tokens ?? 0) + (corpo.usage?.cache_creation_input_tokens ?? 0);
    tokensSaida += corpo.usage?.output_tokens ?? 0;
    const pedidos = corpo.content.filter((b): b is Extract<Bloco, { type: "tool_use" }> => b.type === "tool_use");
    const { texto: textoDaRodada, citacoes } = textoECitacoes(corpo.content);
    fontes.push(...citacoes.slice(0, 5));
    // Cada busca na internet fica registrada (auditoria), com o termo pesquisado.
    for (const b of corpo.content) {
      if (b.type !== "server_tool_use") continue;
      const termo = String(b.input?.query ?? "");
      if (!filtrarEstado(termo).ok) console.warn("[sara] a pesquisa na internet levou dado pessoal no termo");
      usadas.push({ nome: "pesquisar_na_internet", entrada: { termo }, ok: true });
      passoFeito("internet", `Pesquisou na internet · ${termo.slice(0, 60)}`);
    }
    // Pesquisa longa: a Anthropic pausa a vez e espera a continuação (sem resposta de ferramenta).
    if (corpo.stop_reason === "pause_turn") {
      if (textoDaRodada.trim()) textos.push(textoDaRodada);
      mensagens.push({ role: "assistant", content: corpo.content });
      continue;
    }
    // Texto escrito antes de uma consulta de dados é rascunho do modelo ("a primeira consulta falhou…"),
    // e às vezes sai em inglês: não entra na resposta. Antes de só abrir tela, montar visual ou anotar
    // lacuna, a resposta já está pronta e fica.
    const consultou = pedidos.some((p) => !SO_ACAO.has(p.name) && !ehAcao(p.name));
    if (corpo.stop_reason !== "tool_use" || !pedidos.length || !consultou) textos.push(textoDaRodada);
    if (corpo.stop_reason !== "tool_use" || !pedidos.length) {
      const texto = juntar();
      return { texto: texto || "Não consegui montar uma resposta agora.", fontes: unicas(fontes), abrir, ferramentas: usadas, tokensEntrada, tokensSaida, cacheLido, cacheGravado, modelo: a.modelo, visuais, acoes, tempos,
        resultados: resultados.map((x) => ({ nome: x.nome, rotulo: x.rotulo, dados: x.dados, fontes: x.fontes })) };
    }
    mensagens.push({ role: "assistant", content: corpo.content });
    // Só abrir a tela ou mostrar, e nada escrito ainda: o modelo que pensa entre ferramentas (Sonnet) às
    // vezes põe a resposta no pensamento, que não aparece, e termina com "Abri a tela". O lembrete vai junto.
    const lembrar = !consultou && !textos.some((t) => t.trim());
    // As chamadas marcadas como paralelas (as SARAs dos módulos, na SARA central) rodam juntas; as outras,
    // uma de cada vez e na ordem (o visual depende da consulta feita antes). A resposta volta na ordem pedida.
    const paralela = (nome: string) => Boolean(a.ferramentas.find((x) => x.nome === nome)?.paralela);
    const feitos = new Map<string, { conteudo: string; ok: boolean }>();
    const cronometrar = async (p: { id: string; name: string; input?: Record<string, unknown> }) => {
      const t = Date.now();
      const f = a.ferramentas.find((x) => x.nome === p.name);
      // A conversa com a SARA de uma área tem o próprio passo (lib/sara/central/subagente.ts).
      const passo = p.name === "perguntar_a_sara" ? null : (() => { const x = textoDoPasso(p.name, f?.rotulo, p.input, Boolean(f?.acao)); return iniciarPasso(x.tipo, x.texto); })();
      const feito = await executar(p.name, p.input ?? {});
      passo?.fim(feito.ok);
      feitos.set(p.id, feito); tempos.push({ etapa: `ferramenta ${p.name}`, ms: Date.now() - t });
    };
    await Promise.all(pedidos.filter((p) => paralela(p.name)).map(cronometrar));
    for (const p of pedidos) if (!feitos.has(p.id)) await cronometrar(p);
    const devolvidos = [];
    for (const p of pedidos) {
      const { conteudo, ok } = feitos.get(p.id)!;
      usadas.push({ nome: p.name, entrada: p.input, ok });
      devolvidos.push({ type: "tool_result", tool_use_id: p.id, content: lembrar ? `${conteudo}\n\n${LEMBRETE_RESPOSTA}` : conteudo });
    }
    mensagens.push({ role: "user", content: devolvidos });
  }
  return { texto: "A pergunta pediu consultas demais. Tente uma pergunta mais direta.", fontes: unicas(fontes), abrir, ferramentas: usadas, tokensEntrada, tokensSaida, cacheLido, cacheGravado, modelo: a.modelo, visuais, acoes, tempos };
}

const unicas = (f: Fonte[]) => f.filter((x, i) => f.findIndex((y) => y.link === x.link) === i);
