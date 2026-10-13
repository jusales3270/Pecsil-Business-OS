import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { auditarDigital, base64url, consumirDesafio, guardarDesafio, origemDaRequest } from "../../../../../lib/auth/digital";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Entrar com a digital (passkey). Rota pública:
 *   { etapa: "opcoes" }                       → desafio (o celular mostra as chaves deste endereço)
 *   { etapa: "verificar", desafio, resposta } → confere a assinatura com a chave pública guardada e,
 *                                               só então, abre a sessão (mesmos cookies do login
 *                                               por senha). Conta bloqueada ou vencida não entra.
 * A sessão é criada por um link de uso único gerado e consumido aqui mesmo (nunca enviado por e-mail).
 */
export async function POST(request: Request) {
  const origem = origemDaRequest(request);
  if ("erro" in origem) return NextResponse.json({ error: origem.erro }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const corpo = (await request.json().catch(() => ({}))) as { etapa?: string; desafio?: string; resposta?: AuthenticationResponseJSON };

  if (corpo.etapa === "opcoes") {
    const opcoes = await generateAuthenticationOptions({ rpID: origem.rpID, userVerification: "required" });
    const desafio = await guardarDesafio(admin, "login", opcoes.challenge, null);
    if (!desafio) return NextResponse.json({ error: "Muitas tentativas agora. Tente em instantes." }, { status: 429 });
    return NextResponse.json({ desafio, opcoes });
  }
  if (corpo.etapa !== "verificar" || !corpo.resposta?.id) return NextResponse.json({ error: "Etapa inválida." }, { status: 400 });

  const challenge = await consumirDesafio(admin, corpo.desafio, "login", null);
  if (!challenge) return NextResponse.json({ error: "O pedido venceu. Toque em entrar de novo." }, { status: 400 });
  const { data: chave } = await admin.from("access_passkeys")
    .select("id, organization_id, profile_id, user_id, credential_id, public_key, counter, transports, aparelho")
    .eq("credential_id", corpo.resposta.id).is("revoked_at", null).maybeSingle();
  // Chave removida ou desconhecida: o celular ainda a oferece, mas ela não vale mais.
  if (!chave) return NextResponse.json({ error: "Esta digital não está mais ativa. Entre com a senha e ative de novo.", codigo: "DIGITAL_INATIVA" }, { status: 401 });

  let verificado;
  try {
    verificado = await verifyAuthenticationResponse({
      response: corpo.resposta, expectedChallenge: challenge, expectedOrigin: origem.origem, expectedRPID: origem.rpID, requireUserVerification: true,
      credential: { id: chave.credential_id, publicKey: base64url.de(chave.public_key), counter: Number(chave.counter), transports: chave.transports ?? undefined },
    });
  } catch {
    verificado = null;
  }
  if (!verificado?.verified) {
    await auditarDigital(admin, { org: chave.organization_id, userId: chave.user_id, profileId: chave.profile_id, evento: "falha", passkeyId: chave.id, risco: "sensitive", dados: { aparelho: chave.aparelho } });
    return NextResponse.json({ error: "A digital não foi confirmada." }, { status: 401 });
  }

  // A conta precisa estar ativa e dentro da validade (terceiros), como no login por senha.
  const { data: perfil } = await admin.from("profiles").select("status, access_expires_at").eq("id", chave.profile_id).maybeSingle();
  if (!perfil || perfil.status !== "active") return NextResponse.json({ error: "Conta sem acesso ativo. Fale com o responsável pela plataforma." }, { status: 403 });
  if (perfil.access_expires_at && new Date(perfil.access_expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "ACCESS_EXPIRED", expiresAt: perfil.access_expires_at }, { status: 403 });
  }

  await admin.from("access_passkeys").update({ counter: verificado.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", chave.id);
  const { data: u } = await admin.auth.admin.getUserById(chave.user_id);
  const email = u?.user?.email;
  if (!email) return NextResponse.json({ error: "Conta sem e-mail." }, { status: 403 });
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (eLink || !tokenHash) return NextResponse.json({ error: "Não foi possível abrir a sessão agora." }, { status: 503 });
  const servidor = await createSupabaseServerClient();
  const { error: eSessao } = await servidor.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (eSessao) return NextResponse.json({ error: "Não foi possível abrir a sessão agora." }, { status: 503 });

  await auditarDigital(admin, { org: chave.organization_id, userId: chave.user_id, profileId: chave.profile_id, evento: "login", passkeyId: chave.id, risco: "normal", dados: { aparelho: chave.aparelho } });
  return NextResponse.json({ ok: true });
}
