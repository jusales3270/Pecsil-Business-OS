import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";
import { montarRelatorio, type TerceiroApontamento } from "../../../../lib/rh/terceiros-core";

export const dynamic = "force-dynamic";

/**
 * Terceiros para o RH, só leitura. Os apontamentos são da Portaria
 * (`portaria.terceiros`); o RH lê com `rh.terceiros` (RLS `terceiros_read_rh`).
 *
 *   ?data=AAAA-MM-DD  apontamentos do dia (painel "na fábrica agora")
 *   ?mes=AAAA-MM      relatório do mês, com as horas somadas como registradas
 */
export async function GET(request: Request) {
  const guard = await requireFeature("rh.terceiros");
  if ("error" in guard) return guard.error;

  const params = new URL(request.url).searchParams;
  const data = params.get("data");
  const mes = params.get("mes");
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ error: "Data inválida." }, { status: 400 });
  if (mes && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  if (!data && !mes) return NextResponse.json({ error: "Informe ?data= ou ?mes=." }, { status: 400 });

  const linhas: TerceiroApontamento[] = [];
  for (let from = 0; ; from += 1000) {
    let query = guard.supabase.from("terceiros").select("id, nome, data, hora_entrada, hora_saida").order("data").order("hora_entrada");
    query = data ? query.eq("data", data) : query.like("data", `${mes}-%`);
    const { data: page, error } = await query.range(from, from + 999);
    if (error) return dbError(error);
    for (const r of page ?? []) {
      linhas.push({ id: String(r.id), nome: String(r.nome ?? ""), data: String(r.data), entrada: String(r.hora_entrada ?? ""), saida: r.hora_saida ? String(r.hora_saida) : null });
    }
    if (!page || page.length < 1000) break;
  }

  const body = mes ? { relatorio: montarRelatorio(mes, linhas) } : { apontamentos: linhas };
  const response = NextResponse.json(body);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
