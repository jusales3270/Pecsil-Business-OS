import { NextResponse } from "next/server";
import { SARAS } from "../../../../../lib/sara/modulos";
import { QUEM_DECIDE } from "../../../../../lib/sara/central/sara";
import { URL_SESSAO_AO_VIVO, conversaLimpa, instrucoesDeVoz, pedidoDeSessao, respostaDaSessao, sdpValido, sessaoDeVoz, termosChave, vozAoVivo } from "../../../../../lib/sara/central/voz-ao-vivo";
import { preparar } from "../../../../../lib/sara/sessao";
import { primeiroNome } from "../../../../../lib/sara/tempo";
import { regraDeTratamento } from "../../../../../lib/sara/personalidade";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Voz ao vivo da SARA central (OpenAI GPT-Live, `gpt-live-1`, voz "gleam", desde 11/11/2026). POST com a oferta
 * WebRTC do navegador: confere a permissão (a SARA central da pessoa), monta a sessão (a persona, a língua, as áreas
 * dela e a conversa anterior, quando a sessão é reaberta) e abre a sessão na OpenAI com a chave do servidor
 * (`OPENAI_API_KEY`, que nunca vai para o navegador). Devolve só a resposta SDP; o áudio e os eventos passam a
 * correr direto entre o navegador e a OpenAI. Os dados da empresa não passam por aqui: quando a pessoa pede algo,
 * a voz avisa o navegador, o roteador escolhe a função (rotear/route.ts) e a SARA responde pelas rotas de sempre,
 * com as permissões, o verificador e o registro.
 */
export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  if (!SARAS[modulo]?.central) return NextResponse.json({ error: "Só a SARA central fala ao vivo." }, { status: 404 });
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const chave = process.env.OPENAI_API_KEY?.trim();
  if (!chave) return NextResponse.json({ error: "A voz ao vivo ainda não está configurada (falta a chave da OpenAI no servidor)." }, { status: 503 });

  const bruto = await request.text().catch(() => "");
  if (bruto.length > 80_000) return NextResponse.json({ error: "Pedido grande demais." }, { status: 413 });
  let corpo: { sdp?: unknown; historico?: unknown } = {};
  try { corpo = JSON.parse(bruto || "{}"); } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }); }
  if (!sdpValido(corpo.sdp)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  const eu = (await p.sb.rpc("current_profile_id")).data as string | null;
  const [{ data: me }, { data: org }] = await Promise.all([
    eu ? p.sb.from("profiles").select("full_name").eq("id", eu).maybeSingle() : Promise.resolve({ data: null }),
    p.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle(),
  ]);
  const empresa = org?.display_name || org?.legal_name || "empresa";
  // As áreas que a pessoa pode consultar direto: as mesmas que a central consulta por ela.
  const saras = Object.values(SARAS).filter((s) => !s.central && p.access.canModule(s.feature) && p.access.can(s.permissao, "ver"));
  const areasDeVoz = saras.map((s) => ({ modulo: s.modulo, rotulo: s.rotulo }));
  const pessoas = QUEM_DECIDE.split(/[·:,]| e /).map((x) => x.trim()).filter((x) => /^[A-ZÁÉÍÓÚ][a-zà-ú]+$/.test(x));
  const sessao = sessaoDeVoz({
    instrucoes: instrucoesDeVoz({ empresa, nome: primeiroNome(me?.full_name), quemDecide: QUEM_DECIDE, tratamento: regraDeTratamento({ nome: me?.full_name, fundador: p.access.isOwner, verificado: true }), areas: areasDeVoz,
      termos: termosChave([[empresa, "SARA", "War Room"], saras.map((s) => s.rotulo), pessoas]) }),
    voz: vozAoVivo(),
    historico: conversaLimpa(corpo.historico),
  });

  const r = await fetch(URL_SESSAO_AO_VIVO, {
    method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
    body: JSON.stringify(pedidoDeSessao(sessao, corpo.sdp)), signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  const resposta = r?.ok ? respostaDaSessao(j) : null;
  if (!resposta) {
    const erro = (j as { error?: { code?: string; param?: string } } | null)?.error;
    console.error("[sara] voz ao vivo: a sessão não abriu", r?.status ?? "sem resposta", erro?.code ?? "", erro?.param ?? "");
    return NextResponse.json({ error: "A voz ao vivo está indisponível agora." }, { status: 503 });
  }
  return NextResponse.json({ sdp: resposta.sdp });
}
