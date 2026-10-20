import { NextResponse } from "next/server";
import { fleetbase, fleetbaseConfigurado } from "../../../../lib/logistica/fleetbase";
import { andamentoParaTela, rastreioParaCliente, restanteNaRota } from "../../../../lib/logistica/regras.mjs";
import { rastreioGuardado } from "../../../../lib/logistica/servidor";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

const CODIGO = /^[A-Za-z0-9_-]{20,64}$/;
const GUARDA_MS = 20_000;
const memoria = new Map<string, { em: number; corpo: unknown }>();

/**
 * Link de rastreio do cliente (docs/PLANO-LOGISTICA.md §3). Público, sem login: quem tem o link vê só aquela
 * entrega. Tudo passa pela chave do servidor e pela função do banco, que confere o link pelo hash, a validade e a
 * situação. A resposta de cada link fica guardada 20 s (atualizar a página não chama o Fleetbase de novo), e a rota
 * com a previsão vem da guarda de 3 min da plataforma: o link do cliente não gasta a cota do Google.
 * Nunca sai daqui o nome, o telefone ou a placa do motorista, nem o número da ordem no Fleetbase.
 */
export async function GET(_request: Request, context: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await context.params;
  const cabecalhos = { "cache-control": "no-store", "x-robots-tag": "noindex" };
  if (!CODIGO.test(codigo)) return NextResponse.json({ situacao: "inexistente" }, { headers: cabecalhos });
  const ja = memoria.get(codigo);
  if (ja && Date.now() - ja.em < GUARDA_MS) return NextResponse.json(ja.corpo, { headers: cabecalhos });

  const { data, error } = await createSupabaseAdminClient().rpc("logistica_link_ler", { p_codigo: codigo });
  if (error) return NextResponse.json({ error: "Não foi possível abrir o rastreio agora." }, { status: 503 });
  const lido = data as { situacao: string; entrega?: { etapa?: string }; servidor?: { ordem?: string | null } };

  let posicao: { lat: number; lng: number } | null = null;
  let andamento: ReturnType<typeof andamentoParaTela> & { faltaM?: number | null; percentual?: number | null } | null = null;
  const ordem = lido.servidor?.ordem;
  if (lido.situacao === "aberto" && lido.entrega?.etapa === "a_caminho" && ordem && fleetbaseConfigurado()) {
    try {
      const o = await fleetbase.ordem(ordem);
      const idMotorista = (o.driver_assigned as { id?: string } | null)?.id;
      if (idMotorista) {
        const m = await fleetbase.motorista(idMotorista);
        const c = (m.location as { coordinates?: [number, number] } | null)?.coordinates;
        if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) posicao = { lat: Number(c[1]), lng: Number(c[0]) };
      }
      andamento = andamentoParaTela(await rastreioGuardado(ordem));
      const r = andamento && posicao ? restanteNaRota(andamento.trajeto, posicao) : null;
      if (andamento && r) andamento = { ...andamento, faltaM: r.faltaM, percentual: r.percentual, trajeto: r.aFrente };
    } catch {
      // Sem o serviço de entregas agora: a página mostra a situação gravada, sem o caminhão.
    }
  }
  const corpo = rastreioParaCliente(lido, posicao, andamento);
  memoria.set(codigo, { em: Date.now(), corpo });
  if (memoria.size > 1000) for (const [k, v] of memoria) if (Date.now() - v.em > GUARDA_MS) memoria.delete(k);
  return NextResponse.json(corpo, { headers: cabecalhos });
}
