import { isIP } from "node:net";

type Balde = { tentativas: number; ativos: number; vence: number };
type Resultado = { ok: true; liberar: () => void } | { ok: false; aguardar: number };

/**
 * Apenas para o servidor de UMA instância. Reiniciar limpa a janela; múltiplas réplicas precisam
 * de limite compartilhado no proxy/Redis. Sem proxy explicitamente confiável, o IP não vem de
 * cabeçalhos controlados pelo visitante: usa-se um único balde mais restritivo.
 * Ativar COTAR_TRUST_PROXY=1 exige app acessível só pelo proxy, que acrescente/substitua XFF.
 */
export function ipDoFornecedor(headers: Headers, confiarProxy = process.env.COTAR_TRUST_PROXY === "1"): string | null {
  if (!confiarProxy) return null;
  const ultimo = (headers.get("x-forwarded-for") ?? "").split(",").at(-1)?.trim().replace(/^::ffff:/, "");
  return ultimo && isIP(ultimo) ? ultimo : null;
}

export function criarLimitesCotar({ janelaMs = 600_000, maxIp = 30, maxToken = 8, simultaneos = 2, global = 8, chaves = 10_000, agora = Date.now } = {}) {
  const baldes = new Map<string, Balde>();
  let ativos = 0;
  return (ip: string | null, hash: string): Resultado => {
    const momento = agora();
    for (const [chave, b] of baldes) if (b.vence <= momento && !b.ativos) baldes.delete(chave);
    const regras = [[`ip:${ip ?? "sem-proxy"}`, maxIp], [`token:${hash}`, maxToken]] as const;
    // Não despeja baldes vivos (isso permitiria contornar o limite com tokens aleatórios).
    if (ativos >= global || regras.some(([chave]) => !baldes.has(chave)) && baldes.size + 2 > chaves) return { ok: false, aguardar: Math.ceil(janelaMs / 1000) };
    const usados = regras.map(([chave, max], indice) => {
      let b = baldes.get(chave);
      if (!b) { b = { tentativas: 0, ativos: 0, vence: momento + janelaMs }; baldes.set(chave, b); }
      if (b.vence <= momento) { b.tentativas = 0; b.vence = momento + janelaMs; }
      return { b, max, concorrencia: indice === 1 ? 1 : simultaneos };
    });
    const bloqueados = usados.filter(({ b, max, concorrencia }) => b.tentativas >= max || b.ativos >= concorrencia);
    if (bloqueados.length) return { ok: false, aguardar: Math.max(1, ...bloqueados.map(({ b }) => Math.ceil((b.vence - momento) / 1000))) };
    usados.forEach(({ b }) => { b.tentativas++; b.ativos++; }); ativos++;
    let liberado = false;
    return { ok: true, liberar: () => { if (!liberado) { liberado = true; usados.forEach(({ b }) => { b.ativos--; }); ativos--; } } };
  };
}
