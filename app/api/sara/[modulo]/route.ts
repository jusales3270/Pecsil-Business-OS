import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, after } from "next/server";
import { chaveConfigurada, conversar, verificar } from "../../../../lib/sara/claude";
import { MODELO_VERIFICADOR, recusa, regrasDeEscopo } from "../../../../lib/sara/escopo";
import type { RespostaSara } from "../../../../lib/sara/laco";
import { abertura, agoraSP, comAbertura, contextoDeTempo, primeiroNome, saudacao, situacaoDaConversa } from "../../../../lib/sara/tempo";
import { FERRAMENTAS, LACUNA } from "../../../../lib/sara/ferramentas";
import { MOSTRAR } from "../../../../lib/sara/visual";
import { PROPOR_HABILIDADE, instrucoesDeHabilidades, nomearHabilidade, pareceLacuna, pedidoRecorrente, validarProposta, type Passo } from "../../../../lib/sara/habilidades";
import { regrasDaSara } from "../../../../lib/sara/modulos";
import { ACOES } from "../../../../lib/sara/acoes";
import { parametrosUsados, type Usada } from "../../../../lib/sara/parametros";
import { validarGuia } from "../../../../lib/sara/guias";
import { CATALOGO } from "../../../../lib/sara/catalogo";
import { preparar } from "../../../../lib/sara/sessao";
import { temaDe } from "../../../../lib/sara/temas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;
const ANEXO_SEM_TEXTO = "Leia o documento anexado e cruze com os dados da plataforma: diga o que bate, o que não bate e o que falta.";
const FOTO_SEM_TEXTO = "O que é isto? Leia códigos e textos da foto, procure no catálogo e me diga o que achou.";
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
/** Foto da pergunta: tipo aceito e até ~4 MB (a Anthropic aceita até 5 MB por imagem). */
function lerFoto(f: { tipo?: string; dados?: string } | null | undefined): { tipo: (typeof TIPOS_FOTO)[number]; dados: string } | { erro: string } | null {
  if (!f) return null;
  const tipo = TIPOS_FOTO.find((t) => t === f.tipo);
  const dados = String(f.dados ?? "").replace(/^data:[^,]+,/, "");
  if (!tipo || !/^[A-Za-z0-9+/=]+$/.test(dados)) return { erro: "A foto precisa ser JPEG, PNG ou WebP." };
  if (dados.length > 5_400_000) return { erro: "A foto ficou grande demais. Tente de novo (ela é reduzida no celular)." };
  return { tipo, dados };
}

/**
 * SARA de um módulo (I-12, nível 1: orienta e consulta). GET: situação (configurada, ferramentas que
 * a pessoa tem, sugestões). POST: uma pergunta. PATCH: a nota de uma resposta. A pessoa precisa ter
 * acesso ao módulo e a SARA liberada para ela em Pessoas e Acessos (`<modulo>.sara`); as ferramentas oferecidas à SARA são só as que ela pode usar (inclusive de outros
 * módulos), e cada consulta roda com a sessão dela.
 *
 * Guarda de escopo: a SARA só trata da empresa e da rotina de quem pergunta. A regra fixa vai no prompt
 * e um verificador separado classifica a pergunta em paralelo; se ele der FORA, a conversa é cancelada
 * e a resposta é a recusa padrão (registrada na conversa, para auditoria).
 */
type LinhaMensagem = { id: string; papel: "pessoa" | "sara"; texto: string; created_at: string; nota: number | null; ferramentas: Record<string, unknown> | null };
type LinhaAcao = { id: string; mensagem_id: string | null; resumo: string; detalhes: string[]; risco: string; situacao: string; resultado: { feito?: string } | null; erro: string | null; expira_em: string; created_at: string };
const COLUNAS_ACAO = "id, mensagem_id, resumo, detalhes, risco, situacao, resultado, erro, expira_em, created_at";
/** Cartão de uma ação para a tela (a pendente vencida aparece como expirada). */
const cartao = (a: LinhaAcao) => ({ id: a.id, resumo: a.resumo, detalhes: a.detalhes ?? [], risco: a.risco, expiraEm: a.expira_em,
  situacao: a.situacao === "pendente" && Date.parse(a.expira_em) < Date.now() ? "expirada" : a.situacao, feito: a.resultado?.feito ?? null, erro: a.erro });

/** A última conversa da pessoa neste módulo, para a janela abrir na última interação. */
/** Como cada consulta aparece para quem usa ("contas a pagar"). */
const rotulosDe = (fs: { nome: string; rotulo?: string }[]) => Object.fromEntries(fs.filter((f) => f.rotulo).map((f) => [f.nome, f.rotulo as string]));
/** Nome das tabelas como as telas chamam ("pedidos de material"), para os parâmetros da consulta direta. */
const TABELAS = Object.fromEntries(CATALOGO.map((t) => [t.tabela, t.rotulo]));

async function ultimaConversa(sb: SupabaseClient, modulo: string, eu: string | null, rotulos: Record<string, string> = {}) {
  if (!eu) return null;
  const { data: conv } = await sb.from("sara_conversas").select("id, updated_at").eq("modulo", modulo).eq("profile_id", eu).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conv) return null;
  // As 40 mais recentes, na ordem da conversa (no empate de horário, a pergunta antes da resposta).
  const { data } = await sb.from("sara_mensagens").select("id, papel, texto, created_at, nota, ferramentas").eq("conversa_id", conv.id)
    .order("created_at", { ascending: false }).order("papel", { ascending: false }).limit(40);
  const { data: acoes } = await sb.from("sara_acoes").select(COLUNAS_ACAO).eq("conversa_id", conv.id).order("created_at");
  const acoesDe = (id: string) => ((acoes ?? []) as LinhaAcao[]).filter((a) => a.mensagem_id === id).map(cartao);
  const mensagens = ((data ?? []) as LinhaMensagem[]).reverse().map((m) => {
    const f = (m.ferramentas ?? {}) as { usadas?: Usada[]; fontes?: unknown[]; abriu?: unknown; escopo?: { fora?: string | null }; visuais?: unknown[] };
    return { id: m.id, papel: m.papel, texto: m.texto, quando: m.created_at, nota: m.nota, consultas: (f.usadas ?? []).map((u) => u.nome), fontes: f.fontes ?? [], abrir: f.abriu ?? null, fora: Boolean(f.escopo?.fora), visuais: f.visuais ?? [], acoes: acoesDe(m.id),
      parametros: m.papel === "sara" ? parametrosUsados(f.usadas ?? [], rotulos, new Set(ACOES.map((x) => x.nome)), TABELAS) : [] };
  });
  return { id: conv.id, mensagens };
}

export async function GET(_request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const eu = (await p.sb.rpc("current_profile_id")).data as string | null;
  const [{ data: me }, conversa] = await Promise.all([
    eu ? p.sb.from("profiles").select("full_name").eq("id", eu).maybeSingle() : Promise.resolve({ data: null }),
    ultimaConversa(p.sb, modulo, eu, rotulosDe(p.ferramentas)),
  ]);
  return NextResponse.json({
    // Na apresentação, só as consultas do próprio módulo (as dos outros módulos e a pesquisa vão numa frase).
    nome: p.sara.nome, configurada: chaveConfigurada(), sugestoes: p.sara.sugestoes,
    ferramentas: p.ferramentas.filter((f) => p.sara.ferramentas.includes(f.nome) || ["abrir_tela", "abrir_lancamento"].includes(f.nome)).map((f) => f.nome),
    alcance: { outrosModulos: p.ferramentas.some((f) => !p.sara.ferramentas.includes(f.nome) && f.exige.length > 0), dados: p.ferramentas.some((f) => f.nome === "consultar_dados"), pesquisa: Boolean(temaDe(modulo)) },
    // Como cada consulta aparece para quem usa.
    rotulos: Object.fromEntries(p.ferramentas.filter((f) => f.rotulo).map((f) => [f.nome, f.rotulo])),
    // Atalhos das habilidades aprovadas (o primeiro jeito de pedir vira o texto da pergunta).
    habilidades: p.habilidades.map((h) => ({ id: h.id, nome: h.nome, pedido: h.gatilhos[0] ?? h.nome })),
    // Cumprimento pelo relógio do servidor, no fuso de São Paulo, com o nome de quem está logado.
    pessoa: primeiroNome(me?.full_name), saudacao: saudacao(agoraSP().hora24), conversa,
  });
}

export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { pergunta?: string; conversa?: string | null; habilidade?: string | null; imagem?: { tipo?: string; dados?: string } | null; voz?: boolean; anexo?: { nome?: string; texto?: string } | null } | null;
  // (o cliente do Supabase só envia a consulta quando alguém espera por ela: sem o await, não contava)
  if (corpo?.habilidade && UUID.test(corpo.habilidade) && p.habilidades.some((h) => h.id === corpo.habilidade)) await p.sb.rpc("sara_habilidade_usada", { p_id: corpo.habilidade });
  // Foto (E2): só JPEG, PNG ou WebP, já reduzida no celular; vai ao modelo nesta pergunta e não fica guardada.
  const foto = lerFoto(corpo?.imagem);
  if (foto && "erro" in foto) return NextResponse.json({ error: foto.erro }, { status: 400 });
  const imagem = foto && !("erro" in foto) ? foto : null;
  // Documento anexado (E5): o texto lido pela rota /anexo volta aqui; vai só nesta pergunta e não fica guardado.
  const anexo = corpo?.anexo && typeof corpo.anexo.texto === "string" && corpo.anexo.texto.trim()
    ? { nome: String(corpo.anexo.nome ?? "documento").slice(0, 120), texto: corpo.anexo.texto.slice(0, 40_000) } : null;
  const digitada = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
  const pergunta = digitada || (imagem ? FOTO_SEM_TEXTO : anexo ? ANEXO_SEM_TEXTO : "");
  if (pergunta.length < 2) return NextResponse.json({ error: "Escreva a pergunta." }, { status: 400 });
  if (!chaveConfigurada()) return NextResponse.json({ error: "A SARA ainda não está configurada (falta a chave do modelo no servidor)." }, { status: 503 });
  const { data: uso } = await p.sb.rpc("sara_uso_mes", { p_modulo: modulo });
  if (Number(uso ?? 0) >= p.cfg.teto_tokens_mes) return NextResponse.json({ error: "A SARA deste módulo atingiu o limite de uso do mês. Fale com o proprietário." }, { status: 429 });

  const conversa = corpo?.conversa && UUID.test(corpo.conversa) ? corpo.conversa : null;
  // Pergunta e resposta são gravadas no mesmo instante (mesmo created_at): no empate, "pessoa" vem antes
  // de "sara" (ordem alfabética do papel). Sem isso o histórico sai trocado e a SARA responde a pergunta anterior.
  const historico = conversa
    ? ((await p.sb.from("sara_mensagens").select("papel, texto, created_at").eq("conversa_id", conversa).order("created_at", { ascending: false }).order("papel", { ascending: false }).limit(24)).data ?? []).reverse() as { papel: "pessoa" | "sara"; texto: string; created_at: string }[]
    : [];
  // Nova, continuação ou retomada (outro dia ou pausa longa), pela hora da última mensagem.
  const situacao = situacaoDaConversa(historico.at(-1)?.created_at ?? null);
  const [{ data: me }, { data: org }] = await Promise.all([
    p.sb.from("profiles").select("full_name").eq("id", (await p.sb.rpc("current_profile_id")).data).maybeSingle(),
    p.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle(),
  ]);
  const empresa = org?.display_name || org?.legal_name || "empresa";
  // O que aconteceu com as ações desta conversa (a pessoa decide fora do modelo): a SARA fica sabendo.
  const recentes = conversa ? (((await p.sb.from("sara_acoes").select(COLUNAS_ACAO).eq("conversa_id", conversa).order("created_at", { ascending: false }).limit(5)).data ?? []) as LinhaAcao[]).map(cartao) : [];
  const SITUACAO: Record<string, string> = { pendente: "esperando a pessoa decidir", permitida: "permitida, executando", recusada: "a pessoa NÃO permitiu", expirada: "venceu sem decisão (nada foi feito)", executada: "FEITA", falhou: "falhou" };
  const notaAcoes = recentes.length ? `\nAções que você preparou nesta conversa (a mais recente primeiro): ${recentes.map((a) => `${a.resumo} → ${SITUACAO[a.situacao] ?? a.situacao}${a.feito ? ` (${a.feito})` : ""}${a.erro ? ` (${a.erro})` : ""}`).join(" | ")}.` : "";
  const indisponiveis = p.sara.ferramentas.filter((n) => !p.ferramentas.some((f) => f.nome === n));
  // Ações deste módulo que a pessoa não tem o nível para fazer: a SARA diz "Você não tem permissão" em vez de perguntar detalhes.
  const acoesFechadas = ACOES.filter((f) => f.acao && f.acao.modulos !== "todos" && f.acao.modulos.includes(modulo) && !p.ferramentas.some((x) => x.nome === f.nome))
    .map((f) => f.descricao.replace(/^PREPARA /, "").split(" (")[0]);
  // Fixo (vai para o cache) + do momento (hora, quem conversa, situação da conversa, o que não pode).
  const sistema = {
    fixo: `${p.sara.manual}\n\n${regrasDaSara(p.sara)}\n\n${regrasDeEscopo(empresa, p.sara.rotulo, temaDe(modulo))}${p.habilidades.length ? `\n\n${instrucoesDeHabilidades(p.habilidades)}` : ""}`,
    variavel: `${contextoDeTempo({ nome: primeiroNome(me?.full_name), situacao })}${indisponiveis.length ? `\nConsultas que esta pessoa NÃO tem permissão de fazer: ${indisponiveis.join(", ")}.` : ""}${acoesFechadas.length ? `\nAções que esta pessoa NÃO tem permissão de fazer (se ela pedir, comece com "Você não tem permissão para…" e diga quem pode; não pergunte detalhes): ${acoesFechadas.join("; ")}.` : ""}${notaAcoes}\nResponda sempre em português do Brasil.`,
  };
  // Verificador de escopo em paralelo: se der FORA, cancela a conversa e responde a recusa padrão.
  const parar = new AbortController();
  const ultima = [...historico].reverse().find((m) => m.papel === "sara")?.texto ?? null;
  const tema = temaDe(modulo);
  const verificacao = verificar({ empresa, pergunta, contexto: ultima, tema: tema?.assunto ?? null }).then((v) => { if (!v.dentro) parar.abort(); return v; });
  let r: RespostaSara | null = null;
  let falha: unknown = null;
  try {
    // Pesquisa na internet só nos sites do tema do módulo (lib/sara/temas.ts).
    r = await conversar(p.sb, { modelo: p.cfg.modelo, sistema, historico, pergunta, ferramentas: p.ferramentas, todasAsConsultas: [...FERRAMENTAS.map((f) => f.nome), ...ACOES.map((f) => f.nome), "consultar_dados", "buscar_documentos_do_setor"], sinal: parar.signal, pesquisa: tema ? { dominios: tema.dominios, maxBuscas: tema.maxBuscas ?? 3 } : null, maxTokens: p.sara.maxTokens, imagem, anexo });
  } catch (e) { falha = e; }
  const v = await verificacao;
  const textoRecusa = recusa(empresa, p.sara.rotulo);
  let fora: "verificador" | "modelo" | null = null;
  if (!v.dentro) {
    fora = "verificador";
    r = { texto: textoRecusa, fontes: [], abrir: null, ferramentas: [], tokensEntrada: v.tokensEntrada, tokensSaida: v.tokensSaida, cacheLido: 0, cacheGravado: 0, modelo: MODELO_VERIFICADOR, visuais: [], acoes: [] };
  } else if (!r) {
    const m = falha instanceof Error ? falha.message : "";
    console.error("[sara] falha", m.slice(0, 200));
    return NextResponse.json({ error: m.startsWith("NAO_CONFIGURADA") ? "A SARA ainda não está configurada." : "A SARA está indisponível agora. Tente de novo em instantes." }, { status: 503 });
  } else {
    r = { ...r, tokensEntrada: r.tokensEntrada + v.tokensEntrada, tokensSaida: r.tokensSaida + v.tokensSaida };
    if (r.texto.replace(/["“”]/g, "").trim() === textoRecusa) { fora = "modelo"; r = { ...r, texto: textoRecusa, fontes: [], abrir: null, visuais: [], acoes: [] }; }
  }
  // Cumprimento e aviso de retomada vêm da plataforma (hora certa de São Paulo, nome de quem está logado).
  const nomeCurto = primeiroNome(me?.full_name);
  r = { ...r, texto: comAbertura(r.texto, abertura({ nome: nomeCurto, situacao }), nomeCurto) };
  const { data: reg, error } = await p.sb.rpc("sara_registrar", {
    p_conversa: conversa, p_modulo: modulo, p_pergunta: `${imagem ? "📷 " : ""}${corpo?.voz ? "🎤 " : ""}${anexo ? `📎 ${anexo.nome} · ` : ""}${pergunta}`, p_resposta: r.texto,
    p_ferramentas: { usadas: r.ferramentas, fontes: r.fontes, abriu: r.abrir, visuais: r.visuais, cache: { lido: r.cacheLido, gravado: r.cacheGravado }, escopo: { fora, verificador_falhou: v.falhou },
      lacunas: r.ferramentas.filter((f) => f.nome === LACUNA.nome).map((f) => String((f.entrada as { assunto?: string })?.assunto ?? "").slice(0, 300)) }, p_modelo: r.modelo, p_tokens_entrada: r.tokensEntrada, p_tokens_saida: r.tokensSaida,
  });
  if (error) console.error("[sara] não registrou a conversa", error.message);
  const ids = reg as { conversa: string; mensagem: string } | null;
  // Ações preparadas: ficam pendentes (15 min) até a pessoa decidir no cartão.
  const acoes: ReturnType<typeof cartao>[] = [];
  for (const a of r.acoes) {
    const { data: id, error: e2 } = await p.sb.rpc("sara_acao_propor", { p_conversa: ids?.conversa ?? conversa, p_mensagem: ids?.mensagem ?? null, p_modulo: modulo,
      p_ferramenta: a.ferramenta, p_entrada: a.entrada, p_resumo: a.resumo, p_detalhes: a.detalhes, p_risco: a.risco ?? "normal" });
    if (e2 || !id) { console.error("[sara] não registrou a ação", e2?.message); continue; }
    acoes.push(cartao({ id: String(id), mensagem_id: ids?.mensagem ?? null, resumo: a.resumo, detalhes: a.detalhes, risco: a.risco ?? "normal", situacao: "pendente", resultado: null, erro: null,
      expira_em: new Date(Date.now() + 15 * 60_000).toISOString(), created_at: new Date().toISOString() }));
  }

  // Colheita para o Segundo Cérebro (depois da resposta, sem atrasar a conversa): as lacunas e as
  // habilidades que a SARA propôs — e a rede de segurança da plataforma quando ela não lembrou de propor.
  const resposta = r;
  after(async () => {
    // Custo (E4): passou de 80% do teto do mês, o proprietário é avisado (uma vez no mês).
    const { error: eTeto } = await p.sb.rpc("sara_aviso_teto", { p_modulo: modulo });
    if (eTeto) console.error("[sara] aviso do teto", eTeto.message);
    const lacunas = resposta.ferramentas.filter((f) => f.nome === LACUNA.nome).map((f) => String((f.entrada as { assunto?: string })?.assunto ?? "").trim()).filter((x) => x.length >= 3);
    if (!fora && !lacunas.length && pareceLacuna(resposta.texto)) lacunas.push(pergunta.replace(/\s+/g, " ").trim().slice(0, 200));
    if (lacunas.length) {
      const { error: e3 } = await p.sb.rpc("sara_lacunas_registrar", { p_modulo: modulo, p_mensagem: ids?.mensagem ?? null, p_pergunta: pergunta, p_assuntos: lacunas });
      if (e3) console.error("[sara] não registrou a lacuna", e3.message);
    }
    const doModulo = p.ferramentas.filter((f) => !f.acao && ![LACUNA.nome, PROPOR_HABILIDADE.nome, "criar_guia", MOSTRAR.nome, "abrir_tela", "abrir_lancamento"].includes(f.nome)).map((f) => f.nome);
    // Guias (E3) pedidas na conversa: consultas e ações da pessoa; vão para aprovação de quem responde pela área.
    const daGuia = p.ferramentas.filter((f) => ![LACUNA.nome, PROPOR_HABILIDADE.nome, "criar_guia", MOSTRAR.nome].includes(f.nome)).map((f) => f.nome);
    for (const f of resposta.ferramentas.filter((x) => x.nome === "criar_guia" && x.ok)) {
      const g = validarGuia(f.entrada, daGuia, p.eventos.map((e) => e.tipo));
      if ("erro" in g) { console.error("[sara] guia inválida", g.erro); continue; }
      const { error: eG } = await p.sb.rpc("sara_guia_propor", { p_modulo: modulo, p_nome: g.nome, p_descricao: g.descricao, p_gatilhos: g.gatilhos, p_passos: g.passos, p_formato: g.formato, p_gatilho: g.gatilho });
      if (eG) console.error("[sara] não registrou a guia", eG.message);
    }
    const propostas = resposta.ferramentas.filter((x) => x.nome === PROPOR_HABILIDADE.nome).map((f) => validarProposta(f.entrada, doModulo)).filter((x) => x !== null);
    const pediuGuia = resposta.ferramentas.some((x) => x.nome === "criar_guia");
    if (!fora && !propostas.length && !pediuGuia && pedidoRecorrente(pergunta)) {
      const passos: Passo[] = resposta.ferramentas.filter((f) => f.ok && doModulo.includes(f.nome))
        .map((f) => ({ ferramenta: f.nome, para_que: "parte do pedido recorrente", ...(f.entrada && typeof f.entrada === "object" && Object.keys(f.entrada).length ? { entrada: f.entrada as Record<string, unknown> } : {}) }))
        .filter((x, k, l) => l.findIndex((y) => y.ferramenta === x.ferramenta && JSON.stringify(y.entrada) === JSON.stringify(x.entrada)) === k);
      if (passos.length) propostas.push(await nomearHabilidade({ chave: process.env.ANTHROPIC_API_KEY?.trim() ?? "", rotulo: p.sara.rotulo, pergunta, passos }));
    }
    for (const prop of propostas) {
      const { error: e4 } = await p.sb.rpc("sara_habilidade_propor", { p_modulo: modulo, p_nome: prop.nome, p_descricao: prop.descricao, p_gatilhos: prop.gatilhos, p_passos: prop.passos,
        p_formato: prop.formato, p_origem: "conversa", p_evidencia: { vezes: 1, exemplos: [pergunta.slice(0, 200)] } });
      if (e4) console.error("[sara] não registrou a habilidade proposta", e4.message);
    }
  });

  return NextResponse.json({
    conversa: ids?.conversa ?? conversa, mensagem: ids?.mensagem ?? null, texto: r.texto, fontes: r.fontes, abrir: r.abrir, ferramentas: r.ferramentas.map((f) => f.nome), foraDoEscopo: Boolean(fora), visuais: r.visuais, acoes,
    parametros: parametrosUsados(r.ferramentas as Usada[], rotulosDe(p.ferramentas), new Set(ACOES.map((f) => f.nome)), TABELAS),
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { mensagem?: string; nota?: number } | null;
  if (corpo?.mensagem && UUID.test(corpo.mensagem) && corpo.nota) {
    const { error } = await p.sb.rpc("sara_avaliar", { p_mensagem: corpo.mensagem, p_nota: Math.round(corpo.nota) });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Nada para fazer." }, { status: 400 });
}
