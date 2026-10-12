import {
  ErroTransmissor,
  type CodigoErroTransmissor,
  type DadosCertificado,
  type ResultadoDistribuicao,
  type ResultadoValidacao,
  type RespostaSefaz,
  type Transmissor,
} from "./contrato";

/**
 * Implementação do contrato que chama o serviço `services/transmissor-nfe` pela rede interna.
 *
 * - `TRANSMISSOR_URL` (ex.: http://transmissor-nfe:3100) e `TRANSMISSOR_SECRET` (32+): só no
 *   servidor, nunca com prefixo NEXT_PUBLIC_.
 * - Nova tentativa só em queda de rede e só nas consultas. O que muda a situação de uma nota na
 *   SEFAZ (autorizar, evento, inutilizar) NUNCA é repetido às cegas: quem chama consulta a chave
 *   antes de tentar de novo.
 */

type Opcoes = { url: string; segredo: string; prazoMs?: number; fetch?: typeof fetch };

const OPERACOES_REPETIVEIS = new Set(["status", "certificado", "validar", "consultar", "distribuicao", "cadastro", "danfe"]);

const CODIGOS_DO_SERVICO: Record<string, CodigoErroTransmissor> = {
  NAO_AUTORIZADO: "NAO_AUTORIZADO",
  CONSUMO_INDEVIDO: "CONSUMO_INDEVIDO",
  FALHA: "FALHA",
};

export function criarTransmissorHttp({ url, segredo, prazoMs = 60_000, fetch: buscar = fetch }: Opcoes): Transmissor {
  const base = url.replace(/\/+$/, "");

  async function chamar<T>(operacao: string, corpo: Record<string, unknown>): Promise<T> {
    const tentativas = OPERACOES_REPETIVEIS.has(operacao) ? 2 : 1;
    for (let tentativa = 1; ; tentativa++) {
      let resposta: Response;
      try {
        resposta = await buscar(`${base}/v1/${operacao}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-transmissor-secret": segredo },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(prazoMs),
          cache: "no-store",
        });
      } catch {
        if (tentativa < tentativas) { await new Promise((ok) => setTimeout(ok, 1_000)); continue; }
        throw new ErroTransmissor("INDISPONIVEL", "O transmissor de NF-e não respondeu.");
      }
      const json = (await resposta.json().catch(() => null)) as
        | { ok: true; resultado: T }
        | { ok: false; erro?: { codigo?: string; mensagem?: string } }
        | null;
      if (json?.ok) return json.resultado;
      const codigoServico = json && !json.ok ? json.erro?.codigo ?? "" : "";
      const mensagem = (json && !json.ok ? json.erro?.mensagem : undefined) ?? `O transmissor respondeu ${resposta.status}.`;
      const codigo: CodigoErroTransmissor = resposta.status === 400 ? "PEDIDO_INVALIDO" : CODIGOS_DO_SERVICO[codigoServico] ?? "FALHA";
      throw new ErroTransmissor(codigo, mensagem, codigoServico || undefined);
    }
  }

  return {
    nome: "servico-nfewizard",
    status: (c) => chamar<RespostaSefaz>("status", { ...c }),
    certificado: (certificado) => chamar<DadosCertificado>("certificado", { certificado }),
    validar: (xml) => chamar<ResultadoValidacao>("validar", { xml }),
    autorizar: (c, xml) => chamar<RespostaSefaz>("autorizar", { ...c, xml }),
    consultar: (c, chave) => chamar<RespostaSefaz>("consultar", { ...c, chave }),
    evento: (c, evento) => chamar<RespostaSefaz>("evento", { ...c, ...evento }),
    inutilizar: (c, faixa) => chamar<RespostaSefaz>("inutilizar", { ...c, ...faixa }),
    distribuicao: (c, pedido) => chamar<ResultadoDistribuicao>("distribuicao", { ...c, ...pedido }),
    cadastro: (c, consulta) => chamar<RespostaSefaz>("cadastro", { ...c, cnpjConsulta: consulta.cnpj, ufConsulta: consulta.uf }),
    danfe: async (xml) => Buffer.from((await chamar<{ pdf: string }>("danfe", { xml })).pdf, "base64"),
  };
}
