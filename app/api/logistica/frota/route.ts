import { NextResponse } from "next/server";
import { requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { fleetbase, fleetbaseConfigurado } from "../../../../lib/logistica/fleetbase";
import { motoristaParaTela } from "../../../../lib/logistica/regras.mjs";
import { cnhNoRh, espelharMotorista, espelharVeiculo, respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/**
 * Frota e motoristas (cadastro da plataforma; o Fleetbase é o espelho). Ler: logistica.frota ou
 * logistica.entregas. Com `?colaboradores=1`, a lista do RH para escolher o motorista (só nome e cargo; exige
 * logistica.frota "operar"). O estado ao vivo (online, posição) vem do Fleetbase, pelo id de lá.
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["logistica.frota", "logistica.entregas"], "ver");
  if ("error" in guard) return guard.error;
  const podeOperar = guard.access.can("logistica.frota", "operar");
  if (new URL(request.url).searchParams.get("colaboradores")) {
    if (!podeOperar) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const { data, error } = await guard.supabase.rpc("logistica_colaboradores_motorista");
    if (error) return respostaDeErro(error, "Não foi possível ler os colaboradores do RH.");
    const lista = (data ?? []) as { id: string; nome: string; cargo: string | null }[];
    const cnh = await cnhNoRh(lista.map((c) => c.id));
    return NextResponse.json({ colaboradores: lista.map((c) => ({ ...c, cnh: cnh.has(c.id) })) });
  }
  const [veiculos, motoristas] = await Promise.all([
    guard.supabase.from("logistica_veiculos").select("*").order("ativo", { ascending: false }).order("placa"),
    guard.supabase.from("logistica_motoristas").select("id, employee_id, nome, veiculo_id, ativo, fleetbase_motorista, erro, updated_at").order("ativo", { ascending: false }).order("nome"),
  ]);
  const falha = [veiculos, motoristas].find((x) => x.error);
  if (falha?.error) return respostaDeErro(falha.error, "Não foi possível ler a frota.");
  let aoVivo: Record<string, ReturnType<typeof motoristaParaTela>> = {};
  if (fleetbaseConfigurado()) {
    try {
      const lista = await fleetbase.motoristasComPosicao();
      aoVivo = Object.fromEntries(lista.map((d) => [String(d.id ?? ""), motoristaParaTela(d)]));
    } catch { /* sem o estado ao vivo: a tela mostra só o cadastro */ }
  }
  // CNH do RH: se está lá e se foi conferida; o caminho do arquivo só para quem tem documentos do RH.
  const cnh = await cnhNoRh((motoristas.data ?? []).map((m) => m.employee_id));
  const verDocumentos = guard.access.can("rh.documentos", "ver");
  return NextResponse.json({
    servico: fleetbaseConfigurado(), podeOperar,
    veiculos: veiculos.data ?? [],
    motoristas: (motoristas.data ?? []).map((m) => {
      const v = m.fleetbase_motorista ? aoVivo[m.fleetbase_motorista] : null;
      const c = cnh.get(m.employee_id);
      return { ...m, online: Boolean(v?.online), posicaoEm: v?.posicao ? v.atualizado : null,
        cnh: c ? { titulo: c.titulo, conferida: c.conferida, enviada_em: c.enviada_em, caminho: verDocumentos ? c.caminho : null } : null };
    }),
  });
}

/** Cadastra ou altera um veículo ou um motorista e espelha no Fleetbase (se falhar, fica o motivo para tentar de novo). */
export async function POST(request: Request) {
  const guard = await requireFeature("logistica.frota", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { tipo?: string; dados?: Record<string, unknown> };
  const dados = body.dados ?? {};
  try {
    if (body.tipo === "veiculo") {
      const { data, error } = await guard.supabase.rpc("logistica_salvar_veiculo", { p: dados });
      if (error) return respostaDeErro(error, "Não foi possível salvar o veículo.");
      await espelharVeiculo(guard.supabase, data);
      const { data: atual } = await guard.supabase.from("logistica_veiculos").select("*").eq("id", data.id).single();
      return NextResponse.json(atual);
    }
    if (body.tipo === "motorista") {
      const { data, error } = await guard.supabase.rpc("logistica_salvar_motorista", { p: dados });
      if (error) return respostaDeErro(error, "Não foi possível salvar o motorista.");
      await espelharMotorista(guard.supabase, data);
      const { data: atual } = await guard.supabase.from("logistica_motoristas").select("*").eq("id", data.id).single();
      return NextResponse.json(atual);
    }
    return NextResponse.json({ error: "Tipo desconhecido." }, { status: 400 });
  } catch (error) {
    return respostaDeErro(error, "Não foi possível salvar.");
  }
}
