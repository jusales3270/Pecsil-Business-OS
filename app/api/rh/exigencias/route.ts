import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * RH › Saúde e segurança › Exigências por função (R-03). Ler: quem vê SST (exigências, sugestões pelo
 * histórico de entregas e pendências de cada colaborador). Definir: quem aprova SST no RH (o banco
 * confere pela permissão da área).
 */
export async function GET() {
  const guard = await requireFeature("rh.sst");
  if ("error" in guard) return guard.error;
  const sb = guard.supabase;
  // Pendências em páginas: o Supabase devolve no máximo 1.000 linhas por consulta.
  const lerPendencias = async () => {
    const linhas: unknown[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.rpc("rh_exigencias_pendencias").range(de, de + 999);
      if (error) return { data: null, error };
      linhas.push(...(data ?? []));
      if (!data || data.length < 1000) return { data: linhas, error: null };
    }
  };
  const [exigencias, sugestoes, pendencias, funcoes, epis, pode] = await Promise.all([
    sb.from("rh_position_requirements").select("id, position_id, tipo, ppe_item_id, titulo, validade_dias, origem, criado_por_nome, created_at").order("created_at"),
    sb.rpc("rh_exigencias_sugestoes"),
    lerPendencias(),
    sb.from("employees").select("position_id, positions(name)").eq("active", true).not("position_id", "is", null),
    sb.from("rh_ppe_items").select("id, name, ca_number").eq("active", true).order("name"),
    sb.rpc("tem_permissao_da_area", { p_feature: "rh.sst", p_level: "aprovar" }),
  ]);
  const erro = exigencias.error ?? sugestoes.error ?? pendencias.error ?? funcoes.error ?? epis.error;
  if (erro) return NextResponse.json({ error: "Não foi possível carregar as exigências." }, { status: 500 });
  // Funções com colaboradores ativos, com a contagem.
  const porFuncao = new Map<string, { id: string; nome: string; ativos: number }>();
  for (const e of (funcoes.data ?? []) as unknown as { position_id: string; positions: { name: string } | null }[]) {
    const f = porFuncao.get(e.position_id) ?? { id: e.position_id, nome: e.positions?.name ?? "—", ativos: 0 };
    f.ativos++;
    porFuncao.set(e.position_id, f);
  }
  return NextResponse.json({
    podeEditar: pode.data === true,
    funcoes: [...porFuncao.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    exigencias: exigencias.data ?? [], sugestoes: sugestoes.data ?? [], pendencias: pendencias.data ?? [], epis: epis.data ?? [],
  });
}

type Acao =
  | { acao: "salvar"; funcao: string; tipo: "epi" | "exame" | "treinamento"; epi?: string | null; titulo?: string | null; validade?: number | null; origem?: "manual" | "historico" }
  | { acao: "remover"; id: string }
  | { acao: "confirmar"; itens: { funcao: string; epi: string }[]; validade?: number | null };

export async function POST(request: Request) {
  const guard = await requireFeature("rh.sst", "aprovar");
  if ("error" in guard) return guard.error;
  const a = (await request.json().catch(() => null)) as Acao | null;
  const validade = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3650 ? v : null);
  const falha = (error: { code?: string; message?: string }) => NextResponse.json({ error: error.message || "Não foi possível gravar." }, { status: error.code === "42501" ? 403 : 400 });
  if (a?.acao === "salvar") {
    if (!UUID.test(a.funcao)) return NextResponse.json({ error: "Escolha a função." }, { status: 400 });
    const { error } = await guard.supabase.rpc("rh_exigencia_salvar", {
      p_position: a.funcao, p_tipo: a.tipo, p_item: a.tipo === "epi" && a.epi && UUID.test(a.epi) ? a.epi : null,
      p_titulo: a.tipo === "epi" ? null : String(a.titulo ?? "").slice(0, 120), p_validade: validade(a.validade), p_origem: a.origem === "historico" ? "historico" : "manual",
    });
    return error ? falha(error) : NextResponse.json({ ok: true });
  }
  if (a?.acao === "remover") {
    if (!UUID.test(a.id)) return NextResponse.json({ error: "Exigência inválida." }, { status: 400 });
    const { error } = await guard.supabase.rpc("rh_exigencia_remover", { p_id: a.id });
    return error ? falha(error) : NextResponse.json({ ok: true });
  }
  if (a?.acao === "confirmar") {
    const itens = (a.itens ?? []).filter((i) => UUID.test(i.funcao) && UUID.test(i.epi)).slice(0, 300);
    if (!itens.length) return NextResponse.json({ error: "Nenhuma sugestão escolhida." }, { status: 400 });
    let feitas = 0;
    for (const i of itens) {
      const { error } = await guard.supabase.rpc("rh_exigencia_salvar", { p_position: i.funcao, p_tipo: "epi", p_item: i.epi, p_titulo: null, p_validade: validade(a.validade), p_origem: "historico" });
      if (error) return error.code === "42501" ? falha(error) : NextResponse.json({ error: `${feitas} de ${itens.length} confirmadas; parou em uma: ${error.message}` }, { status: 400 });
      feitas++;
    }
    return NextResponse.json({ ok: true, feitas });
  }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
