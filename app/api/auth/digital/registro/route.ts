import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { auditarDigital, base64url, consumirDesafio, guardarDesafio, origemDaRequest } from "../../../../../lib/auth/digital";
import { MAX_APARELHOS, ehCelular, nomeDoAparelho } from "../../../../../lib/auth/digital-regras";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ativar a digital neste celular (passkey). Só com sessão aberta e só no celular.
 *   { etapa: "opcoes" }                          → desafio para o celular assinar
 *   { etapa: "verificar", desafio, resposta }    → confere a assinatura e guarda a chave PÚBLICA
 * A digital não sai do aparelho. Cada cadastro vai para a auditoria.
 */
export async function POST(request: Request) {
  const sessao = await requireUserSession();
  if ("error" in sessao && sessao.error) return sessao.error;
  const { supabase, user } = sessao;
  const origem = origemDaRequest(request);
  if ("erro" in origem) return NextResponse.json({ error: origem.erro }, { status: 400 });
  const ua = request.headers.get("user-agent");
  if (!ehCelular(ua)) return NextResponse.json({ error: "A entrada com a digital é ativada pelo celular." }, { status: 400 });

  const [{ data: profileId }, { data: org }] = await Promise.all([supabase.rpc("current_profile_id"), supabase.rpc("current_organization_id")]);
  if (!profileId || !org) return NextResponse.json({ error: "Conta sem acesso ativo." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  const { data: ativos } = await admin.from("access_passkeys").select("credential_id, transports").eq("user_id", user.id).is("revoked_at", null);

  const corpo = (await request.json().catch(() => ({}))) as { etapa?: string; desafio?: string; resposta?: RegistrationResponseJSON };
  if (corpo.etapa === "opcoes") {
    if ((ativos?.length ?? 0) >= MAX_APARELHOS) return NextResponse.json({ error: `Limite de ${MAX_APARELHOS} aparelhos com digital. Remova um no painel da conta.` }, { status: 409 });
    const [{ data: perfil }, { data: empresa }] = await Promise.all([
      admin.from("profiles").select("full_name, email").eq("id", profileId).single(),
      admin.from("organizations").select("display_name, legal_name").eq("id", org).single(),
    ]);
    const opcoes = await generateRegistrationOptions({
      rpName: empresa?.display_name || empresa?.legal_name || "Business OS",
      rpID: origem.rpID,
      userName: perfil?.email || user.email || user.id,
      userDisplayName: perfil?.full_name || user.email || "Usuário",
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: (ativos ?? []).map((a) => ({ id: a.credential_id, transports: a.transports ?? undefined })),
      // Só a biometria do próprio aparelho, com verificação da pessoa (digital/rosto/PIN do aparelho).
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
    });
    const desafio = await guardarDesafio(admin, "registro", opcoes.challenge, user.id);
    if (!desafio) return NextResponse.json({ error: "Tente de novo em instantes." }, { status: 503 });
    return NextResponse.json({ desafio, opcoes });
  }

  if (corpo.etapa === "verificar" && corpo.resposta) {
    const challenge = await consumirDesafio(admin, corpo.desafio, "registro", user.id);
    if (!challenge) return NextResponse.json({ error: "O pedido venceu. Toque em ativar de novo." }, { status: 400 });
    let verificado;
    try {
      verificado = await verifyRegistrationResponse({
        response: corpo.resposta, expectedChallenge: challenge, expectedOrigin: origem.origem, expectedRPID: origem.rpID, requireUserVerification: true,
      });
    } catch {
      return NextResponse.json({ error: "O celular não confirmou a digital." }, { status: 400 });
    }
    if (!verificado.verified) return NextResponse.json({ error: "O celular não confirmou a digital." }, { status: 400 });
    const c = verificado.registrationInfo.credential;
    const aparelho = nomeDoAparelho(ua);
    const { data: nova, error } = await admin.from("access_passkeys").insert({
      organization_id: org, profile_id: profileId, user_id: user.id, credential_id: c.id, public_key: base64url.para(c.publicKey),
      counter: c.counter, transports: c.transports ?? null, aparelho,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.code === "23505" ? "Este aparelho já está com a digital ativa." : "Não foi possível guardar." }, { status: 400 });
    await auditarDigital(admin, { org: String(org), userId: user.id, profileId: String(profileId), evento: "cadastrada", passkeyId: nova.id, risco: "sensitive", dados: { aparelho } });
    return NextResponse.json({ ok: true, aparelho });
  }
  return NextResponse.json({ error: "Etapa inválida." }, { status: 400 });
}
