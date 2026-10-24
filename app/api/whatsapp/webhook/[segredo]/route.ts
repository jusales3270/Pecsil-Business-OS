import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { atender } from "../../../../../lib/whatsapp/atender";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Aviso de mensagem da Evolution (PLANO-WHATSAPP W3). A Evolution chama pela rede interna do Coolify
 * (http://pecsil-business-os:3000), com o segredo no caminho (ela não assina o aviso). Segredo errado: 404, como se
 * a rota não existisse. Responde na hora (a Evolution espera até 30 s e reenvia se demorar) e atende depois; o
 * aviso repetido não é atendido duas vezes (whatsapp_mensagens).
 */
const confere = (recebido: string) => {
  const esperado = process.env.WHATSAPP_WEBHOOK_SEGREDO?.trim();
  if (!esperado || !recebido) return false;
  const a = createHash("sha256").update(recebido).digest(), b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
};

export async function POST(request: Request, context: { params: Promise<{ segredo: string }> }) {
  const { segredo } = await context.params;
  if (!confere(segredo)) return new NextResponse(null, { status: 404 });
  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({ ok: false }, { status: 400 });
  after(async () => {
    const r = await atender(payload).catch((e) => ({ situacao: "falhou", motivo: e instanceof Error ? e.message : "erro" }));
    if (r.situacao === "falhou") console.error("[whatsapp] não atendeu", r.motivo);
  });
  return NextResponse.json({ ok: true });
}
