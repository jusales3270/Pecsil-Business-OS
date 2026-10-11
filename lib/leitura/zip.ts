/**
 * Leitor de zip que roda no navegador e no servidor (Word e Excel são zips de XMLs). Usa o
 * `DecompressionStream("deflate-raw")`, que existe nos dois — sem biblioteca. Só lê; arquivos
 * criptografados ou zip64 não são suportados (viram "sem texto").
 */
export class ZipInvalido extends Error {}

type Entrada = { metodo: number; tamanho: number; inicio: number };

export type Zip = { nomes: string[]; ler: (nome: string) => Promise<string | null> };

export function abrirZip(dados: Uint8Array): Zip {
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  // Fim do diretório central: assinatura 0x06054b50 nos últimos ~64 KB.
  let fim = -1;
  for (let i = dados.length - 22; i >= Math.max(0, dados.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new ZipInvalido("Não é um arquivo zip válido.");
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const mapa = new Map<string, Entrada>();
  const nomeDe = new TextDecoder("utf-8");
  for (let k = 0; k < total; k++) {
    if (p + 46 > dados.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipInvalido("Diretório do zip corrompido.");
    const metodo = v.getUint16(p + 10, true);
    const tamanho = v.getUint32(p + 20, true);
    const nLen = v.getUint16(p + 28, true);
    const eLen = v.getUint16(p + 30, true);
    const cLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = nomeDe.decode(dados.subarray(p + 46, p + 46 + nLen));
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    mapa.set(nome, { metodo, tamanho, inicio });
    p += 46 + nLen + eLen + cLen;
  }
  return {
    nomes: [...mapa.keys()],
    ler: async (nome) => {
      const e = mapa.get(nome);
      if (!e) return null;
      const bruto = dados.subarray(e.inicio, e.inicio + e.tamanho);
      if (e.metodo === 0) return new TextDecoder("utf-8").decode(bruto);
      if (e.metodo !== 8) throw new ZipInvalido(`Compressão ${e.metodo} não suportada.`);
      const fluxo = new Blob([bruto.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(fluxo).text();
    },
  };
}
