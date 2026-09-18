import { NextResponse } from "next/server";
import { emptyForjaDashboardData } from "@/modules/producao/src/data/emptyForjaData";

export const dynamic = "force-dynamic";

export async function GET() {
  const forjaBaseUrl = process.env.FORJA_API_URL || "http://localhost:3001";
  const forjaToken = process.env.FORJA_API_TOKEN;

  const targetUrl = `${forjaBaseUrl.replace(/\/+$/, "")}/api/dashboard`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (forjaToken) {
      headers["Authorization"] = `Bearer ${forjaToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(targetUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(
        {
          success: true,
          source: "live",
          endpoint: targetUrl,
          data: data.data ?? data,
        },
        {
          headers: {
            "X-Forja-Source": "live",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }
      );
    }

    // Se o Forja responder com erro ou 401/500, loga e usa fallback controlado
    console.warn(`[Forja Proxy] Resposta não-OK de ${targetUrl}: ${response.status}`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.info(`[Forja Proxy] Conexão com Forja offline (${targetUrl}): ${errorMsg}. Utilizando dados locais em fallback.`);
  }

  // Sem dado real: devolve vazio e avisa. Nunca dado fictício.
  return NextResponse.json(
    {
      success: true,
      source: "sem-conexao",
      endpoint: targetUrl,
      data: emptyForjaDashboardData,
      warning: "Sem conexão com a API do Forja. Nenhum dado de produção disponível.",
    },
    {
      headers: {
        "X-Forja-Source": "sem-conexao",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}
