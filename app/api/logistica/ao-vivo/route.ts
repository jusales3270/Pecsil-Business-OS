import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { fleetbase, fleetbaseConfigurado } from "../../../../lib/logistica/fleetbase";
import { andamentoParaTela, motoristaParaTela, restanteNaRota } from "../../../../lib/logistica/regras.mjs";
import { conferirAbertas, rastreioGuardado, respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

type Lido = { motoristas: unknown[]; andamento: Record<string, unknown> };
let memoria: { em: number; lido: Lido } | null = null;

/**
 * O mapa ao vivo: posição dos motoristas (só nome, posição, velocidade e placa), as entregas abertas com o
 * destino e o andamento das que estão a caminho. A tela lê a cada 5 s; as posições vêm do Fleetbase no máximo a
 * cada 3 s, e a rota com a previsão (consulta ao Google) no máximo a cada 3 min por entrega.
 */
export async function GET() {
  const guard = await requireFeature("logistica.entregas", "ver");
  if ("error" in guard) return guard.error;
  await conferirAbertas();
  const [entregas, origem] = await Promise.all([
    guard.supabase.from("logistica_entregas")
      .select("id, numero, cliente_nome, descricao, origem_rotulo, situacao, destino_endereco, destino_lat, destino_lng, fleetbase_ordem, rastreio, motorista, veiculo, previsao, saiu_em, entregue_em, erro")
      .or(`situacao.in.(criada,enviada,a_caminho),entregue_em.gte.${new Date(Date.now() - 12 * 3600_000).toISOString()}`)
      .order("numero", { ascending: false }).limit(100),
    guard.supabase.from("logistica_config").select("origem_nome, origem_endereco, origem_lat, origem_lng").maybeSingle(),
  ]);
  if (entregas.error) return respostaDeErro(entregas.error, "Não foi possível ler as entregas.");
  if (!fleetbaseConfigurado()) return NextResponse.json({ servico: false, origem: origem.data ?? null, entregas: entregas.data ?? [], motoristas: [], andamento: {} });

  try {
    if (!memoria || Date.now() - memoria.em > 3000) {
      const caminho = (entregas.data ?? []).filter((e) => e.situacao === "a_caminho" && e.fleetbase_ordem).slice(0, 15);
      const [motoristas, ...rastreios] = await Promise.all([
        fleetbase.motoristasComPosicao(),
        ...caminho.map((e) => rastreioGuardado(e.fleetbase_ordem as string)),
      ]);
      memoria = {
        em: Date.now(),
        lido: {
          motoristas: (Array.isArray(motoristas) ? motoristas : []).map(motoristaParaTela).filter(Boolean),
          andamento: Object.fromEntries(caminho.map((e, i) => [e.id, andamentoParaTela(rastreios[i])])),
        },
      };
    }
    // Quanto falta e o percentual medidos na rota guardada com a posição de agora (sem consulta ao Google).
    const motoristas = memoria.lido.motoristas as { nome: string; posicao: { lat: number; lng: number } | null }[];
    const andamento = Object.fromEntries(Object.entries(memoria.lido.andamento).map(([id, a]) => {
      const e = (entregas.data ?? []).find((x) => x.id === id);
      const mot = motoristas.find((m) => m.nome === e?.motorista);
      const r = a && mot?.posicao ? restanteNaRota((a as { trajeto: [number, number][] }).trajeto, mot.posicao) : null;
      return [id, a && r ? { ...(a as object), faltaM: r.faltaM, percentual: r.percentual, trajeto: r.aFrente } : a];
    }));
    return NextResponse.json({ servico: true, origem: origem.data ?? null, entregas: entregas.data ?? [], ...memoria.lido, andamento, lidoEm: new Date(memoria.em).toISOString() });
  } catch (error) {
    return respostaDeErro(error, "Não foi possível ler a frota agora.");
  }
}
