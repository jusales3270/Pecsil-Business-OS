import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { sincronizarTudo } from "../../../../lib/mail/sync";

export const dynamic = "force-dynamic";

/**
 * Rodada de leitura das caixas de e-mail.
 *
 * Quem chama é a tarefa agendada do Coolify, de DENTRO do contêiner
 * (`curl -H "x-sync-secret: …" http://localhost:3000/api/comercial/sync`).
 * Rodar por dentro tem uma razão prática: a porta 443 da PecSil oscila, e a
 * entrada de e-mail não pode depender dela.
 *
 * Esta rota não tem sessão de usuário — ela grava com a chave de serviço. Por
 * isso: segredo próprio obrigatório (`MAIL_SYNC_SECRET`), comparado sem vazar
 * tempo; sem segredo configurado, a rota fica fechada; e a resposta devolve só
 * contagens, nunca conteúdo de e-mail.
 */

function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.MAIL_SYNC_SECRET?.trim();
  if (!esperado || esperado.length < 16) return false;
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.MAIL_SYNC_SECRET?.trim()) {
    return NextResponse.json({ error: "MAIL_SYNC_SECRET não configurado." }, { status: 503 });
  }
  if (!segredoConfere(request.headers.get("x-sync-secret"))) {
    return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 });
  }

  const { contas, erro } = await sincronizarTudo(admin);
  if (erro) return NextResponse.json({ error: erro, contas }, { status: 503 });
  return NextResponse.json({
    contas: contas.map((conta) => ({
      conta: conta.conta,
      novas: conta.novas,
      ignoradas: conta.ignoradas,
      paginas: conta.paginas,
      incompleta: conta.incompleta,
      erro: conta.erro,
    })),
  });
}
