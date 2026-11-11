import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireUserSession } from "../../../lib/supabase/session";
import { lerCombinados } from "../../../lib/tarefas/ler";
import { AREAS_DAS_TAREFAS, conferirItens, prazoDoTexto } from "../../../lib/tarefas/regras";
import { pessoasEResponsaveis } from "../../../lib/tarefas/sara";
import { agoraSP } from "../../../lib/sara/tempo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Tarefas e quadros (I-28). Quem vê o quê é decidido pelo banco (RLS: o responsável, quem criou, quem responde pela
 * área, a diretoria, o proprietário e a Auditoria); a gravação é só pelas funções tarefa_* e quadro_criar.
 * GET: a lista visível (quadros e tarefas); ?minhas=1 as da pessoa; ?contar=1 o contador do menu; ?pessoas=1 quem
 * pode ser responsável. POST: { acao: "tarefa" } cria uma; { acao: "quadro", itens } cria o quadro conferido na tela;
 * { acao: "ler", texto } lê uma ata ou reunião e devolve os itens para conferir (nada é criado).
 */
async function sessao() {
  const s = await requireUserSession();
  if ("error" in s && s.error) return { erro: s.error } as const;
  return { sb: s.supabase as unknown as SupabaseClient } as const;
}

export async function GET(request: Request) {
  const a = await sessao();
  if ("erro" in a) return a.erro;
  const q = new URL(request.url).searchParams;
  const hoje = agoraSP().dia;
  if (q.get("contar") === "1" || q.get("minhas") === "1") {
    const { data, error } = await a.sb.rpc("tarefas_minhas");
    if (error) return NextResponse.json({ error: "Não foi possível carregar as suas tarefas." }, { status: 500 });
    const lista = (data ?? []) as { situacao: string; prazo: string | null }[];
    const abertas = lista.filter((t) => t.situacao === "aberta" || t.situacao === "em_andamento");
    const contagem = { abertas: abertas.length, vencidas: abertas.filter((t) => t.prazo && t.prazo < hoje).length, hoje: abertas.filter((t) => t.prazo === hoje).length };
    return NextResponse.json(q.get("contar") === "1" ? contagem : { ...contagem, tarefas: lista, hojeIso: hoje });
  }
  if (q.get("pessoas") === "1") {
    let pessoas;
    try { pessoas = (await pessoasEResponsaveis(a.sb)).pessoas; } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
    return NextResponse.json({ pessoas: pessoas.sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")), areas: AREAS_DAS_TAREFAS });
  }
  const [{ data: eu }, { data: tarefas, error }, { data: quadros }] = await Promise.all([
    a.sb.rpc("current_profile_id"),
    a.sb.from("tarefas").select("id, quadro_id, titulo, detalhe, modulo, responsavel_id, responsavel_nome, prazo, situacao, motivo, criado_por, criado_por_nome, concluida_em, created_at, updated_at")
      .order("prazo", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(800),
    a.sb.from("quadros").select("id, titulo, origem, resumo, criado_por, criado_por_nome, created_at").order("created_at", { ascending: false }).limit(80),
  ]);
  if (error) return NextResponse.json({ error: "Não foi possível carregar as tarefas." }, { status: 500 });
  return NextResponse.json({ eu, hojeIso: hoje, tarefas: tarefas ?? [], quadros: quadros ?? [] });
}

type ItemDaTela = { titulo?: unknown; detalhe?: unknown; responsavel?: unknown; prazo?: unknown; modulo?: unknown };
const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const limpo = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function criarTarefa(sb: SupabaseClient, i: ItemDaTela, quadro: string | null) {
  const responsavel = UUID.test(String(i.responsavel ?? "")) ? String(i.responsavel) : null;
  const prazo = DATA.test(String(i.prazo ?? "")) ? String(i.prazo) : null;
  const modulo = AREAS_DAS_TAREFAS.includes(String(i.modulo ?? "")) ? String(i.modulo) : null;
  return sb.rpc("tarefa_criar", { p_titulo: limpo(i.titulo, 200), p_detalhe: limpo(i.detalhe, 2000) || null, p_responsavel: responsavel, p_prazo: prazo, p_modulo: modulo, p_quadro: quadro });
}

export async function POST(request: Request) {
  const a = await sessao();
  if ("erro" in a) return a.erro;
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = corpo?.acao;

  if (acao === "ler") {
    const chave = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
    if (!chave) return NextResponse.json({ error: "A leitura pela SARA não está configurada no servidor." }, { status: 503 });
    const { data: org } = await a.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle();
    const lido = await lerCombinados({ chave, empresa: org?.display_name || org?.legal_name || "empresa", texto: String(corpo?.texto ?? "") });
    if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
    const { pessoas, responsaveisDaArea } = await pessoasEResponsaveis(a.sb);
    const itens = conferirItens(lido.itens, { pessoas, responsaveisDaArea, areas: AREAS_DAS_TAREFAS, hoje: agoraSP().dia });
    return NextResponse.json({ titulo: lido.titulo, resumo: lido.resumo, itens });
  }

  if (acao === "tarefa") {
    if (limpo(corpo?.titulo, 200).length < 3) return NextResponse.json({ error: "Escreva o que fazer." }, { status: 400 });
    const { data, error } = await criarTarefa(a.sb, corpo as ItemDaTela, null);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ id: data });
  }

  if (acao === "quadro") {
    const itens = (Array.isArray(corpo?.itens) ? corpo.itens : []).slice(0, 60) as ItemDaTela[];
    const validos = itens.filter((i) => limpo(i.titulo, 200).length >= 3);
    if (!validos.length) return NextResponse.json({ error: "O quadro precisa de pelo menos uma tarefa." }, { status: 400 });
    const titulo = limpo(corpo?.titulo, 160);
    if (titulo.length < 3) return NextResponse.json({ error: "Dê um título ao quadro." }, { status: 400 });
    const origem = ["texto", "reuniao", "tela"].includes(String(corpo?.origem)) ? String(corpo?.origem) : "tela";
    const { data: quadro, error } = await a.sb.rpc("quadro_criar", { p_titulo: titulo, p_origem: origem, p_resumo: limpo(corpo?.resumo, 4000) || null, p_texto: typeof corpo?.texto === "string" ? corpo.texto.slice(0, 60000) : null });
    if (error || !quadro) return NextResponse.json({ error: error?.message ?? "Não criou o quadro." }, { status: 400 });
    let criadas = 0;
    for (const i of validos) {
      const { error: e } = await criarTarefa(a.sb, i, quadro as string);
      if (e) return NextResponse.json({ error: `Criou ${criadas} de ${validos.length}: ${e.message}`, quadro }, { status: 400 });
      criadas++;
    }
    return NextResponse.json({ quadro, criadas });
  }

  if (acao === "prazo") {
    // Ajuda da tela: o prazo falado ("sexta", "dia 20") em data, para a pessoa conferir.
    return NextResponse.json({ prazo: prazoDoTexto(String(corpo?.texto ?? ""), agoraSP().dia) });
  }
  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}

