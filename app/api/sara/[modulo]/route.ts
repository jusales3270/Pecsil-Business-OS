import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { chaveConfigurada, conversar, verificar } from "../../../../lib/sara/claude";
import { MODELO_VERIFICADOR, recusa, regrasDeEscopo } from "../../../../lib/sara/escopo";
import type { RespostaSara } from "../../../../lib/sara/laco";
import { ferramentaDeTelas, ferramentasDe } from "../../../../lib/sara/ferramentas";
import { REGRAS_SARA, SARAS } from "../../../../lib/sara/modulos";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * SARA de um módulo (I-12, nível 1: orienta e consulta). GET: situação (configurada, ligada, uso do
 * mês, ferramentas que a pessoa tem) e as conversas dela. POST: uma pergunta. A pessoa precisa ter
 * acesso ao módulo; as ferramentas oferecidas à SARA são só as que ela pode usar (inclusive de outros
 * módulos), e cada consulta roda com a sessão dela.
 *
 * Guarda de escopo: a SARA só trata da empresa e da rotina de quem pergunta. A regra fixa vai no prompt
 * e um verificador separado classifica a pergunta em paralelo; se ele der FORA, a conversa é cancelada
 * e a resposta é a recusa padrão (registrada na conversa, para auditoria).
 */
async function preparar(modulo: string) {
  const sara = SARAS[modulo];
  if (!sara) return { erro: NextResponse.json({ error: "Este módulo ainda não tem SARA." }, { status: 404 }) } as const;
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  // Sem acesso ao módulo, sem a SARA dele.
  if (!access.canModule(sara.feature)) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  const { data: cfg } = await session.supabase.from("sara_modulos").select("ligada, modelo, teto_tokens_mes").eq("modulo", modulo).maybeSingle();
  const telas = sara.telas.filter((t) => t.exige.some((f) => access.can(f, "ver")));
  const navegar = ferramentaDeTelas(telas);
  const ferramentas = [...ferramentasDe((f) => access.can(f, "ver"), sara.ferramentas), ...(navegar ? [navegar] : [])];
  return { sara, sb: session.supabase, access, cfg, ferramentas } as const;
}

export async function GET(_request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const [{ data: uso }, { data: conversas }] = await Promise.all([
    p.sb.rpc("sara_uso_mes", { p_modulo: modulo }),
    p.sb.from("sara_conversas").select("id, titulo, updated_at").eq("modulo", modulo).eq("profile_id", (await p.sb.rpc("current_profile_id")).data).order("updated_at", { ascending: false }).limit(10),
  ]);
  return NextResponse.json({
    nome: p.sara.nome, configurada: chaveConfigurada(), ligada: Boolean(p.cfg?.ligada), modelo: p.cfg?.modelo ?? null,
    uso: Number(uso ?? 0), teto: p.cfg?.teto_tokens_mes ?? 0, podeConfigurar: p.access.isOwner,
    ferramentas: p.ferramentas.map((f) => f.nome), sugestoes: p.sara.sugestoes, conversas: conversas ?? [],
  });
}

export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { pergunta?: string; conversa?: string | null } | null;
  const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
  if (pergunta.length < 2) return NextResponse.json({ error: "Escreva a pergunta." }, { status: 400 });
  if (!chaveConfigurada()) return NextResponse.json({ error: "A SARA ainda não está configurada (falta a chave do modelo no servidor)." }, { status: 503 });
  if (!p.cfg?.ligada) return NextResponse.json({ error: "A SARA deste módulo está desligada. Quem liga é o proprietário." }, { status: 409 });
  const { data: uso } = await p.sb.rpc("sara_uso_mes", { p_modulo: modulo });
  if (Number(uso ?? 0) >= (p.cfg.teto_tokens_mes ?? 0)) return NextResponse.json({ error: "A SARA deste módulo atingiu o teto de uso do mês." }, { status: 429 });

  const conversa = corpo?.conversa && UUID.test(corpo.conversa) ? corpo.conversa : null;
  // Pergunta e resposta são gravadas no mesmo instante (mesmo created_at): no empate, "pessoa" vem antes
  // de "sara" (ordem alfabética do papel). Sem isso o histórico sai trocado e a SARA responde a pergunta anterior.
  const historico = conversa
    ? ((await p.sb.from("sara_mensagens").select("papel, texto").eq("conversa_id", conversa).order("created_at").order("papel").limit(24)).data ?? []) as { papel: "pessoa" | "sara"; texto: string }[]
    : [];
  const [{ data: me }, { data: org }] = await Promise.all([
    p.sb.from("profiles").select("full_name").eq("id", (await p.sb.rpc("current_profile_id")).data).maybeSingle(),
    p.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle(),
  ]);
  const empresa = org?.display_name || org?.legal_name || "empresa";
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  const indisponiveis = p.sara.ferramentas.filter((n) => !p.ferramentas.some((f) => f.nome === n));
  // Fixo (vai para o cache) + do dia (data, quem conversa, o que não pode).
  const sistema = {
    fixo: `${p.sara.manual}\n\n${REGRAS_SARA}\n\n${regrasDeEscopo(empresa, p.sara.rotulo)}`,
    variavel: `Hoje é ${hoje}. Quem conversa: ${me?.full_name ?? "uma pessoa da empresa"}.${indisponiveis.length ? `\nConsultas que esta pessoa NÃO tem permissão de fazer: ${indisponiveis.join(", ")}.` : ""}`,
  };
  // Verificador de escopo em paralelo: se der FORA, cancela a conversa e responde a recusa padrão.
  const parar = new AbortController();
  const ultima = [...historico].reverse().find((m) => m.papel === "sara")?.texto ?? null;
  const verificacao = verificar({ empresa, pergunta, contexto: ultima }).then((v) => { if (!v.dentro) parar.abort(); return v; });
  let r: RespostaSara | null = null;
  let falha: unknown = null;
  try {
    r = await conversar(p.sb, { modelo: p.cfg.modelo, sistema, historico, pergunta, ferramentas: p.ferramentas, sinal: parar.signal });
  } catch (e) { falha = e; }
  const v = await verificacao;
  const textoRecusa = recusa(empresa, p.sara.rotulo);
  let fora: "verificador" | "modelo" | null = null;
  if (!v.dentro) {
    fora = "verificador";
    r = { texto: textoRecusa, fontes: [], abrir: null, ferramentas: [], tokensEntrada: v.tokensEntrada, tokensSaida: v.tokensSaida, cacheLido: 0, cacheGravado: 0, modelo: MODELO_VERIFICADOR };
  } else if (!r) {
    const m = falha instanceof Error ? falha.message : "";
    console.error("[sara] falha", m.slice(0, 200));
    return NextResponse.json({ error: m.startsWith("NAO_CONFIGURADA") ? "A SARA ainda não está configurada." : "A SARA está indisponível agora. Tente de novo em instantes." }, { status: 503 });
  } else {
    r = { ...r, tokensEntrada: r.tokensEntrada + v.tokensEntrada, tokensSaida: r.tokensSaida + v.tokensSaida };
    if (r.texto.replace(/["“”]/g, "").trim() === textoRecusa) { fora = "modelo"; r = { ...r, texto: textoRecusa, fontes: [], abrir: null }; }
  }
  const { data: reg, error } = await p.sb.rpc("sara_registrar", {
    p_conversa: conversa, p_modulo: modulo, p_pergunta: pergunta, p_resposta: r.texto,
    p_ferramentas: { usadas: r.ferramentas, fontes: r.fontes, abriu: r.abrir, cache: { lido: r.cacheLido, gravado: r.cacheGravado }, escopo: { fora, verificador_falhou: v.falhou } }, p_modelo: r.modelo, p_tokens_entrada: r.tokensEntrada, p_tokens_saida: r.tokensSaida,
  });
  if (error) console.error("[sara] não registrou a conversa", error.message);
  const ids = reg as { conversa: string; mensagem: string } | null;

  return NextResponse.json({
    conversa: ids?.conversa ?? conversa, mensagem: ids?.mensagem ?? null, texto: r.texto, fontes: r.fontes, abrir: r.abrir, ferramentas: r.ferramentas.map((f) => f.nome), foraDoEscopo: Boolean(fora),
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const corpo = (await request.json().catch(() => null)) as { mensagem?: string; nota?: number; configurar?: { ligada: boolean; modelo: string; teto: number } } | null;
  if (corpo?.configurar) {
    const c = corpo.configurar;
    const { error } = await p.sb.rpc("sara_configurar", { p_modulo: modulo, p_ligada: Boolean(c.ligada), p_modelo: c.modelo, p_teto: Math.round(Number(c.teto) || 0) });
    return error ? NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 }) : NextResponse.json({ ok: true });
  }
  if (corpo?.mensagem && UUID.test(corpo.mensagem) && corpo.nota) {
    const { error } = await p.sb.rpc("sara_avaliar", { p_mensagem: corpo.mensagem, p_nota: Math.round(corpo.nota) });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Nada para fazer." }, { status: 400 });
}
