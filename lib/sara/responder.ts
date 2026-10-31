import { NextResponse, after } from "next/server";
import { chaveConfigurada, conversar, verificar } from "./claude";
import { contextoParaVerificar, MODELO_VERIFICADOR, recusa, regrasDeEscopo } from "./escopo";
import type { RespostaSara } from "./laco";
import { abertura, comAbertura, contextoDeTempo, situacaoDaConversa } from "./tempo";
import { FERRAMENTAS, LACUNA } from "./ferramentas";
import { MOSTRAR } from "./visual";
import { PROPOR_HABILIDADE, instrucoesDeHabilidades, nomearHabilidade, pareceLacuna, pedidoRecorrente, validarProposta, type Passo } from "./habilidades";
import { linhaDoMarcador, novoMarcador, RESPOSTA_SIGILO, vazouInstrucoes } from "./injecao";
import { regrasDaSara } from "./modulos";
import { ACOES } from "./acoes";
import { iniciarPasso } from "./progresso";
import { parametrosUsados, type Usada } from "./parametros";
import { validarGuia } from "./guias";
import { conferirNumeros, marcarSemFonte, type Conferencia } from "./central/verificador";
import { CATALOGO } from "./catalogo";
import { preparar } from "./sessao";
import { temaDe } from "./temas";
import { PERSONALIDADE, regraDeTratamento, semTratamentoIndevido, tratamento } from "./personalidade";
import { memoriaDaSara } from "./central/licoes";
import { blocoDaMemoria, lembrancas, lembrarDaConversa } from "./memoria-pessoa";
import { linhaDaTela, rotuloDaTela } from "./tela";
import { AVISO_GRAFO, pedeGrafo } from "./central/grafo";
import { rotuloDoRegistro } from "./registros";
import { avisarArea, comParecer, conferirSaida, textosDeSaida, type Parecer } from "./conferir-saida";
import { SARAS } from "./modulos";
import { createSupabaseAdminClient } from "../supabase/admin";
import { fotosPendentes, guardarFoto, leituraDaConversa } from "../qualidade/fotos-servidor";


/**
 * A resposta da SARA de um módulo a uma pergunta, com a sessão de quem pergunta (`p`, de `preparar` ou de
 * `prepararCom`). Usada pela rota /api/sara/[modulo] (tela e voz) e pelo WhatsApp (W3), para a SARA responder
 * igual nos dois lugares: mesmas ferramentas, escopo, verificador, registro e ações com Permitir.
 */
const UUID = /^[0-9a-f-]{36}$/i;
/** A resposta diz que há um cartão para permitir (ou um envio preparado)? */
export const prometeuCartao = (texto: string) =>
  /toque(?:\s+\w+){0,3}\s+em\s+permitir|falta(?:m)?\s+o\s+seu\s+(?:toque|permitir)|cart[aã]o\s+(?:de\s+aprova[cç][aã]o|logo\s+abaixo|na\s+tela|com\s+o\s+resumo)|(?:envio|a[cç][aã]o)\s+(?:est[aá]\s+|ficou\s+)?preparad[oa]|preparei\s+o\s+envio/i.test(texto);
const AVISO_SEM_CARTAO = "AVISO DA PLATAFORMA (não é a pessoa falando): na sua resposta anterior você disse que preparou um envio ou uma ação para a pessoa permitir, mas NENHUMA ferramenta de ação foi chamada, então não existe cartão na tela. Chame agora a ferramenta de ação certa para o que a pessoa pediu (reaproveitando documentos e mensagens de voz já criados nesta conversa, pelo número DOC-…) e responda de novo. Se não for possível, diga com clareza que nada foi preparado e por quê.";
/**
 * Depois da resposta (colheita do Segundo Cérebro, aviso do teto): pelo `after` do Next dentro de uma requisição;
 * fora dela (o WhatsApp atendido em segundo plano, um teste), roda logo em seguida, sem segurar a resposta.
 */
function depois(tarefa: () => Promise<void>) {
  try { after(tarefa); }
  catch { void tarefa().catch((e) => console.error("[sara] tarefa depois da resposta", e instanceof Error ? e.message : e)); }
}
/** Como cada consulta aparece para quem usa ("contas a pagar"). */
export const rotulosDe = (fs: { nome: string; rotulo?: string }[]) => Object.fromEntries(fs.filter((f) => f.rotulo).map((f) => [f.nome, f.rotulo as string]));
/** Nome das tabelas como as telas chamam ("pedidos de material"), para os parâmetros da consulta direta. */
export const TABELAS = Object.fromEntries(CATALOGO.map((t) => [t.tabela, t.rotulo]));
export type LinhaAcao = { id: string; mensagem_id: string | null; resumo: string; detalhes: string[]; risco: string; situacao: string; resultado: { feito?: string } | null; erro: string | null; expira_em: string; created_at: string };
export const COLUNAS_ACAO = "id, mensagem_id, resumo, detalhes, risco, situacao, resultado, erro, expira_em, created_at";
/** Cartão de uma ação para a tela (a pendente vencida aparece como expirada). */
export const cartao = (a: LinhaAcao) => ({ id: a.id, resumo: a.resumo, detalhes: a.detalhes ?? [], risco: a.risco, expiraEm: a.expira_em,
  situacao: a.situacao === "pendente" && Date.parse(a.expira_em) < Date.now() ? "expirada" : a.situacao, feito: a.resultado?.feito ?? null, erro: a.erro });
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

export type Corpo = { pergunta?: string; conversa?: string | null; habilidade?: string | null; imagem?: { tipo?: string; dados?: string } | null; voz?: boolean; anexo?: { nome?: string; texto?: string } | null;
  /** A pergunta veio pelo WhatsApp (W3): resposta curta, sem gráfico nem tabela, sem "abaixo" ou "no painel". */
  canal?: "whatsapp";
  /** O que a pessoa está vendo (lib/tela-atual.ts): só um apontador, conferido em lib/sara/tela.ts. */
  tela?: unknown;
  /** A tela quer ver os passos enquanto a SARA trabalha (resposta em fluxo, uma linha JSON por passo). */
  progresso?: boolean };
export type Preparado = Exclude<Awaited<ReturnType<typeof preparar>>, { erro: unknown }>;


/**
 * Só o servidor passa (nunca o corpo da requisição): o comportamento e o modelo do número de WhatsApp por onde a
 * pergunta chegou. O comportamento complementa a SARA; as regras de segurança acima dele continuam valendo.
 */
export type DoCanal = { comportamento?: string | null; modelo?: string | null; apelido?: string | null };

export async function responder(p: Preparado, modulo: string, corpo: Corpo | null, doCanal: DoCanal = {}): Promise<Response> {
  if (doCanal.modelo) p = { ...p, cfg: { ...p.cfg, modelo: doCanal.modelo } };
  // (o cliente do Supabase só envia a consulta quando alguém espera por ela: sem o await, não contava)
  if (corpo?.habilidade && UUID.test(corpo.habilidade) && p.habilidades.some((h) => h.id === corpo.habilidade)) await p.sb.rpc("sara_habilidade_usada", { p_id: corpo.habilidade });
  // Foto (E2): só JPEG, PNG ou WebP, já reduzida no celular; vai ao modelo nesta pergunta e só fica guardada na SARA que guarda evidência (guardaFotos).
  const foto = lerFoto(corpo?.imagem);
  if (foto && "erro" in foto) return NextResponse.json({ error: foto.erro }, { status: 400 });
  const imagem = foto && !("erro" in foto) ? foto : null;
  // Documento anexado (E5): o texto lido pela rota /anexo volta aqui; vai só nesta pergunta e não fica guardado.
  const anexo = corpo?.anexo && typeof corpo.anexo.texto === "string" && corpo.anexo.texto.trim()
    ? { nome: String(corpo.anexo.nome ?? "documento").slice(0, 120), texto: corpo.anexo.texto.slice(0, 40_000) } : null;
  const digitada = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
  const pergunta = digitada || (imagem ? p.sara.fotoSemTexto ?? FOTO_SEM_TEXTO : anexo ? ANEXO_SEM_TEXTO : "");
  if (pergunta.length < 2) return NextResponse.json({ error: "Escreva a pergunta." }, { status: 400 });
  if (!chaveConfigurada()) return NextResponse.json({ error: "A SARA ainda não está configurada (falta a chave do modelo no servidor)." }, { status: 503 });
  const { data: uso } = await p.sb.rpc("sara_uso_mes", { p_modulo: modulo });
  if (Number(uso ?? 0) >= p.cfg.teto_tokens_mes) {
    // A pessoa só lê "foi avisado" se o aviso saiu de verdade.
    const { data: avisou, error: eCheio } = await p.sb.rpc("sara_aviso_teto_cheio", { p_modulo: modulo });
    if (eCheio) console.error("[sara] aviso do teto cheio", eCheio.message);
    return NextResponse.json({ error: `A SARA deste módulo chegou ao limite de uso do mês. ${avisou ? "O proprietário já foi avisado." : "Fale com o proprietário."} Enquanto isso, o trabalho segue pelas telas do módulo.` }, { status: 429 });
  }

  const conversa = corpo?.conversa && UUID.test(corpo.conversa) ? corpo.conversa : null;
  // Documentos da SARA central ficam ligados à conversa em que foram pedidos.
  if (p.documentos) p.documentos.conversa = conversa;
  // Pergunta e resposta são gravadas no mesmo instante (mesmo created_at): no empate, "pessoa" vem antes
  // de "sara" (ordem alfabética do papel). Sem isso o histórico sai trocado e a SARA responde a pergunta anterior.
  const historico = conversa
    ? ((await p.sb.from("sara_mensagens").select("papel, texto, created_at").eq("conversa_id", conversa).order("created_at", { ascending: false }).order("papel", { ascending: false }).limit(24)).data ?? []).reverse() as { papel: "pessoa" | "sara"; texto: string; created_at: string }[]
    : [];
  // Fontes que já estão na conversa: as respostas anteriores (conferidas; sem o aviso do que NÃO teve fonte) e
  // os números que a própria pessoa disse. Valem para a calculadora, o painel e os documentos da central.
  const fontesDaConversa = historico.map((m) => m.texto.replace(/⚠️?\s*Sem fonte conferida:[^\n]*/g, ""));
  if (p.documentos) p.documentos.fontes.push(...fontesDaConversa);
  // Evidência (Qualidade): a foto fica guardada desde já, antes da resposta do modelo.
  let fotoGuardada: string | null = null;
  let notaFoto = "";
  if (imagem && p.sara.guardaFotos && p.access.can(p.sara.guardaFotos, "operar")) {
    try { fotoGuardada = await guardarFoto(p.sb, imagem, conversa); notaFoto = "\nA foto desta mensagem foi guardada como evidência."; }
    catch (e) { console.error("[sara] não guardou a foto", e instanceof Error ? e.message : e); notaFoto = "\nA foto desta mensagem NÃO foi guardada (falha no servidor): avise a pessoa e peça para mandar de novo antes de registrar."; }
  }
  // Nova, continuação ou retomada (outro dia ou pausa longa), pela hora da última mensagem.
  // Pela voz da SARA central, a conversa já foi aberta por ela (o cumprimento já foi dito): a área vai direto à resposta.
  const situacao = corpo?.voz && !p.sara.central ? { tipo: "continua" as const, ultima: null, ontem: false } : situacaoDaConversa(historico.at(-1)?.created_at ?? null);
  const [{ data: me }, { data: org }] = await Promise.all([
    p.sb.from("profiles").select("full_name").eq("id", (await p.sb.rpc("current_profile_id")).data).maybeSingle(),
    p.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle(),
  ]);
  const empresa = org?.display_name || org?.legal_name || "empresa";
  // Quem conversa, como a sessão autenticou (o tratamento da personalidade vem daqui).
  const interlocutor = { nome: me?.full_name, fundador: p.access.isOwner, verificado: true, apelido: doCanal.apelido ?? null };
  // O que aconteceu com as ações desta conversa (a pessoa decide fora do modelo): a SARA fica sabendo.
  const recentes = conversa ? (((await p.sb.from("sara_acoes").select(COLUNAS_ACAO).eq("conversa_id", conversa).order("created_at", { ascending: false }).limit(5)).data ?? []) as LinhaAcao[]).map(cartao) : [];
  const SITUACAO: Record<string, string> = { pendente: "esperando a pessoa decidir", permitida: "permitida, executando", recusada: "a pessoa NÃO permitiu", expirada: "venceu sem decisão (nada foi feito)", executada: "FEITA", falhou: "falhou" };
  const notaAcoes = recentes.length ? `\nAções que você preparou nesta conversa (a mais recente primeiro): ${recentes.map((a) => `${a.resumo} → ${SITUACAO[a.situacao] ?? a.situacao}${a.feito ? ` (${a.feito})` : ""}${a.erro ? ` (${a.erro})` : ""}`).join(" | ")}.` : "";
  const indisponiveis = p.sara.ferramentas.filter((n) => !p.ferramentas.some((f) => f.nome === n));
  // Ações deste módulo que a pessoa não tem o nível para fazer: a SARA diz "Você não tem permissão" em vez de perguntar detalhes.
  const acoesFechadas = ACOES.filter((f) => f.acao && f.acao.modulos !== "todos" && f.acao.modulos.includes(modulo) && !p.ferramentas.some((x) => x.nome === f.nome))
    .map((f) => f.descricao.replace(/^PREPARA /, "").split(" (")[0]);
  // J5: o que a empresa ensinou (lições aprovadas pela área) e, na central, o que a vigia aprendeu nas áreas da pessoa.
  const areasDaMemoria = p.sara.central ? Object.values(SARAS).filter((s) => !s.central && p.access.canModule(s.feature) && p.access.can(s.permissao, "ver")).map((s) => s.modulo) : [modulo];
  const memoria = await memoriaDaSara(areasDaMemoria, Boolean(p.sara.central));
  // I-21: o que foi tratado com esta pessoa em outras conversas, na tela ou no WhatsApp. Só de áreas que ela ainda acessa.
  // A SARA central entra na lista de todas: é ela que costuma atender pelo WhatsApp.
  const central = Object.values(SARAS).find((s) => s.central);
  const areasDaPessoa = [...areasDaMemoria, modulo, ...(central && p.access.canModule(central.feature) && p.access.can(central.permissao, "ver") ? [central.modulo] : [])];
  const memoriaPessoa = blocoDaMemoria(await lembrancas(p.sb, [...new Set(areasDaPessoa)], conversa).catch(() => []), Object.fromEntries(Object.values(SARAS).map((s) => [s.modulo, s.rotulo])));
  // Marcador secreto desta resposta (injeção): se aparecer na resposta, a SARA revelou as instruções.
  const marcador = novoMarcador();
  // Fixo (vai para o cache) + do momento (hora, quem conversa, situação da conversa, o que não pode).
  const sistema = {
    fixo: `${PERSONALIDADE}\n\n${p.sara.manual}\n\n${regrasDaSara(p.sara)}\n\n${regrasDeEscopo(empresa, p.sara.rotulo, temaDe(modulo))}${p.habilidades.length ? `\n\n${instrucoesDeHabilidades(p.habilidades)}` : ""}`,
    variavel: `${linhaDoMarcador(marcador)}\n${contextoDeTempo({ nome: tratamento(interlocutor), situacao })}\n${regraDeTratamento(interlocutor)}${indisponiveis.length ? `\nConsultas que esta pessoa NÃO tem permissão de fazer: ${indisponiveis.join(", ")}.` : ""}${acoesFechadas.length ? `\nAções que esta pessoa NÃO tem permissão de fazer (se ela pedir, comece com "Você não tem permissão para…" e diga quem pode; não pergunte detalhes): ${acoesFechadas.join("; ")}.` : ""}${notaAcoes}${memoria.texto ? `\n\n${memoria.texto}` : ""}${corpo?.voz && !p.sara.central && corpo?.canal !== "whatsapp" ? "\nA pergunta veio pela voz da SARA: o PRIMEIRO parágrafo é o que será falado. Comece por ele, com a resposta direta e os números (até 60 palavras); o detalhe vem depois, para o painel." : ""}${corpo?.canal === "whatsapp" ? (corpo?.voz
      ? "\nA conversa é pelo WhatsApp e a sua resposta volta em ÁUDIO: fale direto, de forma natural, com os números, em até 60 palavras e sem lista. Não fale de \"painel\", \"tela\", \"abaixo\" nem \"tabela\": a pessoa só ouve este áudio. Se houver mais detalhe, diga que ela pode ver na plataforma. Se preparar uma ação, diga o que preparou e que falta a confirmação, sem falar de cartão nem de Permitir: a plataforma manda logo depois como confirmar (pela enquete ou pelo link). Exceção: documento, mensagem de voz ou texto que a pessoa pediu PARA ELA MESMA (enviar_pelo_whatsapp com para \"mim\") chega nesta conversa logo depois da sua resposta, sem confirmar: diga que está mandando, nunca prometa um envio sem preparar com enviar_pelo_whatsapp."
      : "\nA conversa é pelo WhatsApp: responda em texto corrido e curto (até 120 palavras), com os números; no máximo uma lista curta, sem tabela e sem gráfico. Não diga \"abaixo\", \"na tabela\" nem \"no painel\", e não ofereça abrir telas: a pessoa só vê esta mensagem. Se houver mais detalhe, diga que ela pode ver na plataforma. Se preparar uma ação, diga o que preparou e que falta a confirmação, sem falar de cartão nem de Permitir: a plataforma manda logo depois como confirmar (pela enquete ou pelo link). Exceção: documento, mensagem de voz ou texto que a pessoa pediu PARA ELA MESMA (enviar_pelo_whatsapp com para \"mim\") chega nesta conversa logo depois da sua resposta, sem confirmar: diga que está mandando, nunca prometa um envio sem preparar com enviar_pelo_whatsapp.") : ""}${doCanal.comportamento ? `\n\nComo se comportar neste número de WhatsApp (definido pelo proprietário; complementa o que está acima, e as regras de segurança, de permissão e de escopo da empresa continuam valendo e prevalecem):\n${doCanal.comportamento}` : ""}\nResponda sempre em português do Brasil.`,
  };
  // T2: a tela vem do catálogo; o registro aberto, resolvido aqui com a sessão da pessoa.
  const naTela = corpo?.canal === "whatsapp" ? null : rotuloDaTela(corpo?.tela, p.access);
  const registroNaTela = naTela ? await rotuloDoRegistro(p.sb, (corpo?.tela as { registro?: unknown } | null)?.registro ?? null).catch(() => null) : null;
  sistema.variavel += notaFoto + memoriaPessoa + linhaDaTela(registroNaTela ?? naTela);
  if (p.sara.central && corpo?.canal !== "whatsapp" && pedeGrafo(pergunta) && p.ferramentas.some((f) => f.nome === "mostrar_grafo")) sistema.variavel += AVISO_GRAFO;
  // Verificador de escopo em paralelo: se der FORA, cancela a conversa e responde a recusa padrão.
  const parar = new AbortController();
  const ultima = [...historico].reverse().find((m) => m.papel === "sara")?.texto ?? null;
  const tema = temaDe(modulo);
  const verificacao = verificar({ empresa, pergunta, contexto: contextoParaVerificar(pergunta, ultima), tema: tema?.assunto ?? null }).then((v) => { if (!v.dentro) parar.abort(); return v; });
  const inicioRota = Date.now();
  let r: RespostaSara | null = null;
  let falha: unknown = null;
  const argsConversa = { modelo: p.cfg.modelo, sistema, historico, pergunta, ferramentas: corpo?.canal === "whatsapp" ? p.ferramentas.filter((f) => !["mostrar", "mostrar_grafo", "abrir_tela", "abrir_lancamento", "abrir_registro"].includes(f.nome)) : p.ferramentas, todasAsConsultas: [...FERRAMENTAS.map((f) => f.nome), ...ACOES.map((f) => f.nome), "consultar_dados", "buscar_documentos_do_setor"], sinal: parar.signal, pesquisa: tema ? { dominios: tema.dominios, maxBuscas: tema.maxBuscas ?? 3 } : null, maxTokens: p.sara.maxTokens, imagem, anexo, rodadas: p.sara.central ? 10 : undefined, maxVisuais: p.sara.central ? 8 : undefined };
  try {
    // Pesquisa na internet só nos sites do tema do módulo (lib/sara/temas.ts).
    r = await conversar(p.sb, argsConversa);
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
    if (r.texto.replace(/["“”]/g, "").trim() === textoRecusa) { fora = "modelo"; r = { ...r, texto: textoRecusa, fontes: [], abrir: null, grafo: null, visuais: [], acoes: [] }; }
    // Trava (24/10): a resposta promete um cartão ("toque em Permitir", "envio preparado") sem nenhuma ação
    // preparada. A SARA tenta de novo, uma vez, chamando a ferramenta de verdade; se ainda não preparar, a resposta
    // sai com o aviso de que nada foi preparado (a pessoa não procura um cartão que não existe).
    else if (!r.acoes.length && prometeuCartao(r.texto) && p.ferramentas.some((f) => f.acao)) {
      const antes = r;
      const deNovo = await conversar(p.sb, { ...argsConversa, historico: [...historico, { papel: "pessoa", texto: pergunta, created_at: new Date().toISOString() }, { papel: "sara", texto: antes.texto, created_at: new Date().toISOString() }],
        pergunta: AVISO_SEM_CARTAO }).catch(() => null);
      if (deNovo) r = { ...deNovo, ferramentas: [...antes.ferramentas, ...deNovo.ferramentas], tokensEntrada: antes.tokensEntrada + deNovo.tokensEntrada, tokensSaida: antes.tokensSaida + deNovo.tokensSaida,
        cacheLido: antes.cacheLido + deNovo.cacheLido, cacheGravado: antes.cacheGravado + deNovo.cacheGravado, resultados: [...(antes.resultados ?? []), ...(deNovo.resultados ?? [])], falhasDoModelo: [...(antes.falhasDoModelo ?? []), ...(deNovo.falhasDoModelo ?? [])] };
      if (!r.acoes.length && prometeuCartao(r.texto)) r = { ...r, texto: `${r.texto}\n\n⚠️ Nada foi preparado nesta resposta: não há cartão para permitir. Peça de novo.` };
    }
  }
  // Filtro de saída (injeção), sem modelo: a resposta não pode trazer o marcador nem trecho longo das instruções
  // (regras fixas e o comportamento do número). A recusa padrão, que a SARA deve repetir, fica de fora da comparação.
  let sigilo: "marcador" | "trecho" | null = null;
  if (!fora) {
    sigilo = vazouInstrucoes(r.texto, { marcador, textos: [regrasDaSara(p.sara), regrasDeEscopo(empresa, p.sara.rotulo, temaDe(modulo)).replace(textoRecusa, ""), doCanal.comportamento ?? ""] });
    if (sigilo) {
      console.error("[sara] resposta bloqueada: revelaria as instruções", modulo, sigilo);
      r = { ...r, texto: RESPOSTA_SIGILO, fontes: [], abrir: null, grafo: null, visuais: [], acoes: [] };
    }
  }
  const msModelo = Date.now() - inicioRota;
  // SARA central (E7): todo número da resposta tem de estar no que as SARAs das áreas devolveram (ou numa
  // conta). O que não bate é apontado no fim da resposta. Conferido pela plataforma, não pelo modelo.
  let conferencia: Conferencia | null = null;
  if (p.sara.central && !fora) {
    const passoConferir = iniciarPasso("conferencia", "Conferindo cada número com a fonte das áreas");
    // Fontes: o que as áreas devolveram agora e as respostas anteriores desta conversa (já conferidas).
    conferencia = conferirNumeros(r.texto, [...(r.resultados ?? []).map((x) => x.dados), ...fontesDaConversa,
      // O que a vigia aprendeu (números do histórico, calculados pela plataforma).
      ...(memoria.tipos.length ? [memoria.texto] : [])]);
    // Os gráficos que as áreas montaram vão para a tela (a central apresenta).
    r = { ...r, texto: marcarSemFonte(r.texto, conferencia), visuais: [...r.visuais, ...p.visuaisSubagentes].slice(0, 8) };
    passoConferir.fim(true);
  }
  // I-22: o que vai sair da empresa passa por uma segunda leitura. Reprovou, a pessoa vê o motivo e a área é avisada.
  let parecer: Parecer | null = null;
  const saindo = !fora && !sigilo ? textosDeSaida(r) : [];
  if (saindo.length) {
    const passoSaida = iniciarPasso("conferencia", "Conferindo o que vai sair da empresa");
    parecer = await conferirSaida({ chave: process.env.ANTHROPIC_API_KEY?.trim() ?? "", empresa, pedido: pergunta, textos: saindo });
    r = { ...comParecer(r, parecer), tokensEntrada: r.tokensEntrada + parecer.tokensEntrada, tokensSaida: r.tokensSaida + parecer.tokensSaida };
    passoSaida.fim(parecer.aprovada);
  }
  // Cumprimento e aviso de retomada vêm da plataforma (hora certa de São Paulo, nome de quem está logado).
  const nomeCurto = tratamento(interlocutor);
  // A SARA central (holograma) já cumprimenta ao ser invocada: a resposta não repete o cumprimento.
  if (!p.sara.central) r = { ...r, texto: comAbertura(r.texto, abertura({ nome: nomeCurto, situacao }), nomeCurto) };
  // O "Senhor" é só do fundador verificado: a plataforma corrige o que o modelo tenha concedido a outra pessoa.
  r = { ...r, texto: semTratamentoIndevido(r.texto, interlocutor) };
  const passoGravar = iniciarPasso("conferencia", "Guardando a conversa");
  const { data: reg, error } = await p.sb.rpc("sara_registrar", {
    p_conversa: conversa, p_modulo: modulo, p_pergunta: `${imagem ? "📷 " : ""}${corpo?.voz ? "🎤 " : ""}${anexo ? `📎 ${anexo.nome} · ` : ""}${pergunta}`, p_resposta: r.texto,
    p_ferramentas: { usadas: r.ferramentas, fontes: r.fontes, abriu: r.abrir, grafo: r.grafo ?? null, visuais: r.visuais, cache: { lido: r.cacheLido, gravado: r.cacheGravado }, escopo: { fora, verificador_falhou: v.falhou, sigilo }, tempos: { total_ms: Date.now() - inicioRota, conversa_ms: msModelo, etapas: r.tempos ?? [] },
      lacunas: r.ferramentas.filter((f) => f.nome === LACUNA.nome).map((f) => String((f.entrada as { assunto?: string })?.assunto ?? "").slice(0, 300)),
      ...(r.falhasDoModelo?.length ? { falhas_do_modelo: r.falhasDoModelo } : {}),
      ...(parecer ? { conferencia_saida: { aprovada: parecer.aprovada, motivo: parecer.motivo, area: parecer.area, falhou: parecer.falhou } } : {}),
      ...(p.sara.central ? { verificador: conferencia, subagentes: p.subagentes, documentos: p.documentos?.criados ?? [] } : {}) }, p_modelo: r.modelo, p_tokens_entrada: r.tokensEntrada, p_tokens_saida: r.tokensSaida,
  });
  if (error) console.error("[sara] não registrou a conversa", error.message);
  passoGravar.fim(!error);
  const ids = reg as { conversa: string; mensagem: string } | null;
  // J5: a lição proposta na primeira mensagem nasce antes da conversa; liga a lição à conversa agora.
  if (p.sara.central && !conversa && ids?.conversa && r.ferramentas.some((f) => f.nome === "propor_licao")) {
    try {
      const eu = (await p.sb.rpc("current_profile_id")).data as string | null;
      if (eu) await createSupabaseAdminClient().from("sara_licoes").update({ conversa_id: ids.conversa }).eq("ensinada_por", eu).is("conversa_id", null).gte("created_at", new Date(inicioRota).toISOString());
    } catch (e) { console.error("[sara] não ligou a lição à conversa", e instanceof Error ? e.message : e); }
  }
  // A primeira mensagem nasce sem conversa: liga a foto a ela agora.
  if (fotoGuardada && !conversa && ids?.conversa) {
    const { error: e3 } = await p.sb.rpc("qualidade_foto_ligar_conversa", { p_foto: fotoGuardada, p_conversa: ids.conversa });
    if (e3) console.error("[sara] não ligou a foto à conversa", e3.message);
  }
  // As fotos que vão no cartão saem da conversa, pelo servidor: o modelo não escolhe.
  const levaFotos = (nome: string) => Boolean(p.ferramentas.find((f) => f.nome === nome)?.acao?.levaFotos);
  const conversaDaFoto = ids?.conversa ?? conversa;
  const fotosDaConversa = conversaDaFoto && r.acoes.some((a) => levaFotos(a.ferramenta)) ? await fotosPendentes(p.sb, conversaDaFoto).catch(() => [] as string[]) : [];
  // A foto só vai ao modelo na mensagem em que chegou: ao refazer o cartão, a leitura dela vem do cartão anterior.
  const leituraAnterior = fotosDaConversa.length && r.acoes.some((a) => levaFotos(a.ferramenta) && !a.entrada?.analise_sara)
    ? await leituraDaConversa(p.sb, conversaDaFoto as string).catch(() => null) : null;
  // Ações preparadas: ficam pendentes (15 min) até a pessoa decidir no cartão.
  const acoes: ReturnType<typeof cartao>[] = [];
  for (const original of r.acoes) {
    const herdada = levaFotos(original.ferramenta) && !original.entrada?.analise_sara ? leituraAnterior : null;
    const a = levaFotos(original.ferramenta)
      ? { ...original, entrada: { ...original.entrada, ...(herdada ?? {}), fotos: fotosDaConversa },
          detalhes: [...original.detalhes, ...(herdada ? [`Leitura da SARA: ${herdada.analise_sara.slice(0, 400)}`] : []), fotosDaConversa.length ? `Fotos: ${fotosDaConversa.length}` : "⚠️ Sem foto"] }
      : original;
    const { data: id, error: e2 } = await p.sb.rpc("sara_acao_propor", { p_conversa: ids?.conversa ?? conversa, p_mensagem: ids?.mensagem ?? null, p_modulo: modulo,
      p_ferramenta: a.ferramenta, p_entrada: a.entrada, p_resumo: a.resumo, p_detalhes: a.detalhes, p_risco: a.risco ?? "normal" });
    if (e2 || !id) { console.error("[sara] não registrou a ação", e2?.message); continue; }
    acoes.push(cartao({ id: String(id), mensagem_id: ids?.mensagem ?? null, resumo: a.resumo, detalhes: a.detalhes, risco: a.risco ?? "normal", situacao: "pendente", resultado: null, erro: null,
      expira_em: new Date(Date.now() + 15 * 60_000).toISOString(), created_at: new Date().toISOString() }));
  }
  // Central: o envio pelo WhatsApp de documentos que JÁ existiam (criados antes ou fora desta conversa) também
  // aparece com a prévia (PDF e áudio), para quem permite ver o que vai sair, não só o número.
  const documentos = [...(p.documentos?.criados ?? [])];
  if (p.sara.central) {
    const refs = [...new Set(r.acoes.filter((a) => a.ferramenta === "enviar_pelo_whatsapp").flatMap((a) => (Array.isArray(a.entrada?.documentos) ? a.entrada.documentos : []).map(String)))]
      .filter((x) => !documentos.some((d) => d.id === x || d.numero === x.toUpperCase())).slice(0, 5);
    if (refs.length) {
      const ids = refs.filter((x) => UUID.test(x)), numeros = refs.map((x) => x.toUpperCase()).filter((x) => /^DOC-\d{4}-\d{4,}$/.test(x));
      const { data: ja } = !ids.length && !numeros.length ? { data: [] } : await p.sb.from("sara_documentos").select("id, numero, titulo, tipo, paginas")
        .or([ids.length ? `id.in.(${ids.join(",")})` : "", numeros.length ? `numero.in.(${numeros.join(",")})` : ""].filter(Boolean).join(","));
      for (const d of (ja ?? []) as { id: string; numero: string; titulo: string; tipo: string; paginas: number | null }[]) documentos.push({ ...d, paginas: d.paginas ?? 0 });
    }
  }

  // Colheita para o Segundo Cérebro (depois da resposta, sem atrasar a conversa): as lacunas e as
  // habilidades que a SARA propôs — e a rede de segurança da plataforma quando ela não lembrou de propor.
  const resposta = r;
  depois(async () => {
    if (parecer && !parecer.aprovada && ids?.mensagem) {
      const admin = createSupabaseAdminClient();
      const { data: conv } = await admin.from("sara_conversas").select("organization_id").eq("id", ids.conversa).maybeSingle<{ organization_id: string }>();
      if (conv) await avisarArea(admin, { organizacao: conv.organization_id, mensagem: ids.mensagem, parecer, quemPediu: nomeCurto })
        .catch((e) => console.error("[sara] aviso da conferência", e instanceof Error ? e.message : e));
    }
    if (!fora && !sigilo && ids?.conversa) {
      await lembrarDaConversa(createSupabaseAdminClient(), { chave: process.env.ANTHROPIC_API_KEY?.trim() ?? "", conversa: ids.conversa, modulo, historico, pergunta, resposta: resposta.texto })
        .catch((e) => console.error("[sara] memória da pessoa", e instanceof Error ? e.message : e));
    }
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
    conversa: ids?.conversa ?? conversa, mensagem: ids?.mensagem ?? null, texto: r.texto, fontes: r.fontes, abrir: r.abrir, grafo: r.grafo ?? null, ferramentas: r.ferramentas.map((f) => f.nome), foraDoEscopo: Boolean(fora), visuais: r.visuais, acoes,
    documentos,
    parametros: parametrosUsados(r.ferramentas as Usada[], rotulosDe(p.ferramentas), new Set(ACOES.map((f) => f.nome)), TABELAS),
  });
}
