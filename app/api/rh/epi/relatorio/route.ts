import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { dataValida, montarRelatorio, type ColaboradorEpi, type EntregaEpi, type ExigenciaEpi, type FiltroSituacao } from "../../../../../lib/rh/epi-relatorio";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const SITUACOES = new Set(["", "em_dia", "pendente", "sem_exigencias"]);
type Row = Record<string, unknown>;
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/**
 * Relatório de EPIs (RH › Relatórios). ?opcoes=1 devolve as listas dos filtros (colaboradores, EPIs,
 * setores). Sem ele: ?de=&ate= (obrigatórios) &colaborador= &item= &setor= &situacao=. Quem vê Saúde e
 * segurança do RH; a RLS das tabelas repete a exigência. Nenhum documento pessoal sai por aqui.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("rh.sst");
  if ("error" in guard) return guard.error;
  const sb = guard.supabase;
  const q = new URL(request.url).searchParams;

  const colaboradoresQ = await sb.from("employees").select("id, full_name, active, position_id, departments(name), positions(name)").order("full_name").limit(5000);
  if (colaboradoresQ.error) return dbError(colaboradoresQ.error);
  const colaboradores: ColaboradorEpi[] = ((colaboradoresQ.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), nome: String(r.full_name), ativo: Boolean(r.active), positionId: r.position_id ? String(r.position_id) : null,
    setor: one(r.departments as { name: string } | null)?.name ?? null, funcao: one(r.positions as { name: string } | null)?.name ?? null,
  }));

  if (q.get("opcoes") === "1") {
    const itens = await sb.from("rh_ppe_items").select("id, name, ca_number").order("name").limit(2000);
    if (itens.error) return dbError(itens.error);
    return NextResponse.json({
      colaboradores: colaboradores.map((c) => ({ id: c.id, nome: c.nome, setor: c.setor, ativo: c.ativo })),
      itens: ((itens.data ?? []) as Row[]).map((r) => ({ id: String(r.id), nome: String(r.name), ca: r.ca_number ? String(r.ca_number) : null })),
      setores: [...new Set(colaboradores.map((c) => c.setor).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const de = q.get("de"), ate = q.get("ate");
  const colaborador = q.get("colaborador") ?? "", item = q.get("item") ?? "", setor = (q.get("setor") ?? "").slice(0, 120), situacao = q.get("situacao") ?? "";
  if (!dataValida(de) || !dataValida(ate) || de > ate || (colaborador && !UUID.test(colaborador)) || (item && !UUID.test(item)) || !SITUACOES.has(situacao)) {
    return NextResponse.json({ error: "Filtros inválidos: confira o período." }, { status: 400 });
  }

  const exigQ = await sb.from("rh_position_requirements").select("position_id, ppe_item_id, validade_dias, rh_ppe_items(name, ca_number)").eq("tipo", "epi").not("ppe_item_id", "is", null);
  if (exigQ.error) return dbError(exigQ.error);
  const exigencias: ExigenciaEpi[] = ((exigQ.data ?? []) as Row[]).map((r) => {
    const i = one(r.rh_ppe_items as { name: string; ca_number: string | null } | null);
    return { positionId: String(r.position_id), itemId: String(r.ppe_item_id), item: i?.name ?? "—", ca: i?.ca_number ?? null, validadeDias: r.validade_dias == null ? null : Number(r.validade_dias) };
  });

  // Todas as entregas até o fim do período (as anteriores contam para a situação), em páginas de 1.000.
  const entregas: EntregaEpi[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    let consulta = sb.from("rh_ppe_deliveries").select("id, employee_id, item_id, quantity, delivered_on, signed_on, signature_method, rh_ppe_items(name, ca_number)").lte("delivered_on", ate);
    if (colaborador) consulta = consulta.eq("employee_id", colaborador);
    const { data, error } = await consulta.order("delivered_on").order("id").range(from, from + 999);
    if (error) return dbError(error);
    for (const r of (data ?? []) as Row[]) {
      const i = one(r.rh_ppe_items as { name: string; ca_number: string | null } | null);
      entregas.push({ id: String(r.id), employeeId: String(r.employee_id), itemId: String(r.item_id), item: i?.name ?? "—", ca: i?.ca_number ?? null,
        quantidade: Number(r.quantity), entregueEm: String(r.delivered_on), assinadoEm: r.signed_on ? String(r.signed_on) : null, metodo: r.signature_method ? String(r.signature_method) : null });
    }
    if (!data || data.length < 1000) break;
  }

  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const relatorio = montarRelatorio({ colaboradores, exigencias, entregas, hoje, filtros: { de, ate, colaborador, item, setor, situacao: situacao as FiltroSituacao } });
  // Os nomes dos filtros escolhidos, para o cabeçalho do documento.
  let itemNome = item ? entregas.find((e) => e.itemId === item)?.item ?? exigencias.find((e) => e.itemId === item)?.item ?? null : null;
  if (item && !itemNome) itemNome = ((await sb.from("rh_ppe_items").select("name").eq("id", item).maybeSingle()).data as { name: string } | null)?.name ?? null;
  return NextResponse.json({ relatorio, filtros: { colaborador: colaborador ? colaboradores.find((c) => c.id === colaborador)?.nome ?? null : null, item: itemNome, setor: setor || null, situacao: situacao || null, funcoesComExigencia: new Set(exigencias.map((e) => e.positionId)).size } },
    { headers: { "Cache-Control": "no-store" } });
}
