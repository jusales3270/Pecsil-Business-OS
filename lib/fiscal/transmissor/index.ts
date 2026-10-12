import { ErroTransmissor, type Transmissor } from "./contrato";
import { criarTransmissorHttp } from "./http";

export * from "./contrato";

/**
 * O transmissor em uso. Hoje só existe o serviço separado (opção 3, gratuita). Para trocar por uma
 * API paga (opção 4): criar `lib/fiscal/transmissor/<fornecedor>.ts` implementando `Transmissor` e
 * escolher aqui por `TRANSMISSOR_TIPO`; o resto da plataforma não muda.
 */
export function transmissorConfigurado(): boolean {
  return Boolean(process.env.TRANSMISSOR_URL?.trim()) && (process.env.TRANSMISSOR_SECRET?.trim().length ?? 0) >= 32;
}

export function obterTransmissor(): Transmissor {
  const tipo = process.env.TRANSMISSOR_TIPO?.trim() || "servico";
  if (tipo !== "servico") throw new ErroTransmissor("NAO_CONFIGURADO", `Transmissor "${tipo}" não existe.`);
  const url = process.env.TRANSMISSOR_URL?.trim();
  const segredo = process.env.TRANSMISSOR_SECRET?.trim();
  if (!url || !segredo || segredo.length < 32) {
    throw new ErroTransmissor("NAO_CONFIGURADO", "Transmissor de NF-e não configurado (TRANSMISSOR_URL e TRANSMISSOR_SECRET).");
  }
  return criarTransmissorHttp({ url, segredo });
}
