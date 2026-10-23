import { NextResponse } from "next/server";
import { SARAS } from "../../../../../lib/sara/modulos";
import { QUEM_DECIDE } from "../../../../../lib/sara/central/sara";
import { URL_VOZ_AO_VIVO, VOZ_DA_SARA, extrairToken, instrucoesDeVoz, sessaoDeVoz, termosChave, vozExiste } from "../../../../../lib/sara/central/voz-ao-vivo";
import { preparar } from "../../../../../lib/sara/sessao";
import { primeiroNome } from "../../../../../lib/sara/tempo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Voz ao vivo da SARA central (Grok Voice, xAI). POST: confere a permissão (a SARA central da pessoa),
 * confere se a voz "luna" existe e pede um token temporário (5 min) para o navegador conectar direto ao
 * Grok, sem a chave sair do servidor (`XAI_API_KEY`). Devolve o endereço e a sessão (pt-BR, a persona e as
 * funções). Os dados da empresa não passam por aqui: o Grok chama `consultar_sara_central`, que é a rota
 * normal da central (com as permissões, o verificador e o registro).
 */
let vozConferida: { quando: number; ok: boolean } | null = null;

export async function POST(_request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  if (!SARAS[modulo]?.central) return NextResponse.json({ error: "Só a SARA central fala ao vivo." }, { status: 404 });
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  const chave = process.env.XAI_API_KEY?.trim();
  if (!chave) return NextResponse.json({ error: "A voz ao vivo ainda não está configurada (falta a chave da xAI no servidor)." }, { status: 503 });
  const cabecalho = { authorization: `Bearer ${chave}`, "content-type": "application/json" };

  // A voz escolhida pelo proprietário precisa existir: sem ela, não liga (em vez de trocar de voz calada).
  if (!vozConferida || Date.now() - vozConferida.quando > 3_600_000) {
    const r = await fetch("https://api.x.ai/v1/tts/voices", { headers: cabecalho, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const lista = r?.ok ? await r.json().catch(() => null) : null;
    vozConferida = lista ? { quando: Date.now(), ok: vozExiste(lista, VOZ_DA_SARA) } : null;
  }
  if (vozConferida && !vozConferida.ok) return NextResponse.json({ error: `A voz "${VOZ_DA_SARA}" não está disponível na xAI.` }, { status: 503 });

  const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", { method: "POST", headers: cabecalho, body: JSON.stringify({ expires_after: { seconds: 300 } }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const corpo = r ? await r.json().catch(() => null) : null;
  const token = r?.ok ? extrairToken(corpo) : null;
  if (!token) {
    console.error("[sara] voz ao vivo: token não veio", r?.status);
    return NextResponse.json({ error: "A voz ao vivo está indisponível agora." }, { status: 503 });
  }

  const eu = (await p.sb.rpc("current_profile_id")).data as string | null;
  const [{ data: me }, { data: org }] = await Promise.all([
    eu ? p.sb.from("profiles").select("full_name").eq("id", eu).maybeSingle() : Promise.resolve({ data: null }),
    p.sb.from("organizations").select("display_name, legal_name").limit(1).maybeSingle(),
  ]);
  const empresa = org?.display_name || org?.legal_name || "empresa";
  const areas = Object.values(SARAS).filter((s) => !s.central && p.access.canModule(s.feature)).map((s) => s.rotulo);
  const pessoas = QUEM_DECIDE.split(/[·:,]| e /).map((x) => x.trim()).filter((x) => /^[A-ZÁÉÍÓÚ][a-zà-ú]+$/.test(x));
  const sessao = sessaoDeVoz({
    instrucoes: instrucoesDeVoz({ empresa, nome: primeiroNome(me?.full_name), quemDecide: QUEM_DECIDE }),
    termos: termosChave([[empresa, "SARA", "War Room"], areas, pessoas]),
  });
  return NextResponse.json({ token, url: URL_VOZ_AO_VIVO, sessao });
}
