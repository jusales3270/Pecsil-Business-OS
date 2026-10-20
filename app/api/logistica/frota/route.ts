import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { fleetbase, fleetbaseConfigurado } from "../../../../lib/logistica/fleetbase";
import { motoristaParaTela } from "../../../../lib/logistica/regras.mjs";
import { respostaDeErro } from "../../../../lib/logistica/servidor";

export const dynamic = "force-dynamic";

/** Veículos e motoristas cadastrados no Fleetbase (leitura; o cadastro é feito lá, pelo despacho). */
export async function GET() {
  const guard = await requireFeature("logistica.entregas", "ver");
  if ("error" in guard) return guard.error;
  if (!fleetbaseConfigurado()) return NextResponse.json({ servico: false, veiculos: [], motoristas: [] });
  try {
    const [veiculos, motoristas] = await Promise.all([fleetbase.veiculos(), fleetbase.motoristasComPosicao()]);
    return NextResponse.json({
      servico: true,
      veiculos: (Array.isArray(veiculos) ? veiculos : []).map((v) => ({
        id: String(v.id ?? ""), placa: (v.plate_number as string) ?? null,
        modelo: [v.make, v.model].filter(Boolean).join(" ") || null, ano: (v.year as string) ?? null,
        situacao: (v.status as string) ?? null, online: Boolean(v.online),
      })),
      motoristas: (Array.isArray(motoristas) ? motoristas : []).map(motoristaParaTela).filter(Boolean),
    });
  } catch (error) {
    return respostaDeErro(error, "Não foi possível ler a frota agora.");
  }
}
