import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FiscalNaoPronto } from "./servidor";
import { ErroTransmissor } from "./transmissor";

/** Organização da sessão (para as chamadas que o servidor faz com a chave de serviço). */
export async function organizacaoDaSessao(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.rpc("current_organization_id");
  return data ? String(data) : null;
}

/** Erro do Fiscal/transmissor → resposta clara. Nada do certificado vai na mensagem. */
export function respostaDoErro(e: unknown, contexto: string) {
  if (e instanceof FiscalNaoPronto) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof ErroTransmissor) {
    const status = { NAO_CONFIGURADO: 503, INDISPONIVEL: 503, NAO_AUTORIZADO: 503, CONSUMO_INDEVIDO: 429, PEDIDO_INVALIDO: 400, FALHA: 502 }[e.codigo];
    const mensagem = {
      NAO_CONFIGURADO: "O transmissor de NF-e ainda não foi instalado no servidor.",
      INDISPONIVEL: "O transmissor de NF-e não respondeu. Tente de novo em alguns minutos.",
      NAO_AUTORIZADO: "O transmissor recusou a plataforma (segredo diferente nos dois lados).",
      CONSUMO_INDEVIDO: "A SEFAZ pediu para esperar 1 hora antes de consultar de novo.",
      PEDIDO_INVALIDO: e.message,
      FALHA: `SEFAZ: ${e.message}`,
    }[e.codigo];
    if (e.codigo !== "PEDIDO_INVALIDO" && e.codigo !== "FALHA") console.error(`${contexto}: ${e.codigo}`);
    return NextResponse.json({ error: mensagem, codigo: e.codigo }, { status });
  }
  console.error(contexto, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "Não foi possível concluir agora." }, { status: 500 });
}

/** Mensagem do banco (raise exception / check) para a tela. */
export function erroDoBanco(error: { message?: string; code?: string } | null): string {
  const m = error?.message ?? "";
  if (error?.code === "42501") return m || "Sem permissão.";
  if (error?.code === "23514") {
    const campo = m.match(/fiscal_config_(\w+?)_check/)?.[1];
    return campo ? `Valor inválido em "${campo.replace(/_/g, " ")}".` : "Algum campo tem valor inválido.";
  }
  return m || "Não foi possível gravar.";
}
