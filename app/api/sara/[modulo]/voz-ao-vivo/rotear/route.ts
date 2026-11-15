import { NextResponse } from "next/server";
import { SARAS } from "../../../../../../lib/sara/modulos";
import { conversaLimpa, escolhaDoRoteador, pedidoDoRoteador } from "../../../../../../lib/sara/central/voz-ao-vivo";
import { chamarClaude } from "../../../../../../lib/sara/motor/anthropic";
import { preparar } from "../../../../../../lib/sara/sessao";
import { escolhaDaRotinaPela } from "../../../../../../lib/sara/politica";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * O que fazer quando a voz ao vivo (GPT-Live) pede a plataforma (11/11/2026). O navegador manda o fim da conversa
 * (a transcrição que a própria sessão devolveu); o Haiku escolhe UMA função: a SARA de uma área, a SARA central ou
 * um comando de tela. Só escolhe: quem executa é o navegador, pelas rotas de sempre (com a permissão da pessoa,
 * o verificador e o registro). A área só entra na lista se a pessoa pode usar a SARA dela.
 */
export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  if (!SARAS[modulo]?.central) return NextResponse.json({ error: "Só a SARA central fala ao vivo." }, { status: 404 });
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) return NextResponse.json({ error: "A SARA não está configurada (falta a chave da Anthropic)." }, { status: 503 });

  const bruto = await request.text().catch(() => "");
  if (bruto.length > 40_000) return NextResponse.json({ error: "Pedido grande demais." }, { status: 413 });
  let corpo: { conversa?: unknown } = {};
  try { corpo = JSON.parse(bruto || "{}"); } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }); }
  const conversa = conversaLimpa(corpo.conversa, 12);
  if (!conversa.some((f) => f.quem === "pessoa")) return NextResponse.json({ error: "Sem a fala da pessoa." }, { status: 400 });

  const areas = Object.values(SARAS).filter((s) => !s.central && p.access.canModule(s.feature) && p.access.can(s.permissao, "ver")).map((s) => ({ modulo: s.modulo, rotulo: s.rotulo }));
  // O modelo do roteador vem da política da empresa (roteador ligado); sem ela, o Haiku de sempre (I-32).
  const escolha = await escolhaDaRotinaPela(p.sb, "roteador_voz");
  const r = await chamarClaude(pedidoDoRoteador(areas, conversa, escolha), { chave, timeoutMs: escolha && escolha.modelo !== "claude-haiku-5-5" ? 30_000 : 12_000 }).catch(() => null);
  if (!r?.ok) console.error("[sara] voz ao vivo: o roteador falhou", r ? r.status : "exceção", r && !r.ok ? r.erro.slice(0, 120) : "");
  // Sem o roteador, a pergunta vai inteira para a SARA central (ela sabe tudo o que as áreas sabem).
  return NextResponse.json(escolhaDoRoteador(r?.ok ? r.mensagem : null, areas, conversa));
}
