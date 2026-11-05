/** Leitura limitada de ZIP para DOCX/XLSX, no navegador e no servidor. */
export class ZipInvalido extends Error {}

export type LimitesZip = {
  arquivo: number; entrada: number; expandido: number; entradas: number; razao: number; prazoMs: number;
};
export const LIMITES_ZIP: Readonly<LimitesZip> = Object.freeze({
  arquivo: 25_000_000, entrada: 32_000_000, expandido: 64_000_000, entradas: 1_000, razao: 1_000, prazoMs: 8_000,
});
export type EntradaZip = { metodo: number; tamanho: number; expandido: number; inicio: number };
export type Zip = { nomes: string[]; ler: (nome: string) => Promise<string | null> };
const EXCESSO = "O arquivo compactado ultrapassa os limites de leitura segura.";

/** Compartilhado com o leitor síncrono de extratos: valida antes de alocar/descompactar. */
export function prepararZip(dados: Uint8Array, opcoes: Partial<LimitesZip> = {}) {
  const limites = { ...LIMITES_ZIP, ...opcoes };
  if (Object.values(limites).some((n) => !Number.isFinite(n) || n <= 0)) throw new ZipInvalido("Limites de leitura inválidos.");
  const prazo = performance.now() + limites.prazoMs;
  const verificarPrazo = () => { if (performance.now() >= prazo) throw new ZipInvalido(EXCESSO); };
  if (dados.length > limites.arquivo || dados.length < 22) throw new ZipInvalido(dados.length < 22 ? "Não é um arquivo zip válido." : EXCESSO);
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  let fim = -1;
  for (let i = dados.length - 22; i >= Math.max(0, dados.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === dados.length) { fim = i; break; }
  }
  if (fim < 0) throw new ZipInvalido("Não é um arquivo zip válido.");
  const total = v.getUint16(fim + 10, true), tamanhoDiretorio = v.getUint32(fim + 12, true);
  let p = v.getUint32(fim + 16, true);
  if (v.getUint16(fim + 4, true) || v.getUint16(fim + 6, true) || v.getUint16(fim + 8, true) !== total || total === 0xffff || p === 0xffffffff || tamanhoDiretorio === 0xffffffff) throw new ZipInvalido("ZIP dividido ou ZIP64 não suportado.");
  if (total > limites.entradas) throw new ZipInvalido(EXCESSO);
  const fimDiretorio = p + tamanhoDiretorio;
  if (fimDiretorio !== fim) throw new ZipInvalido("Diretório do zip corrompido.");
  const mapa = new Map<string, EntradaZip>();
  const nomeDe = new TextDecoder("utf-8");
  let declarado = 0, emitido = 0;
  for (let k = 0; k < total; k++) {
    verificarPrazo();
    if (p + 46 > fimDiretorio || v.getUint32(p, true) !== 0x02014b50) throw new ZipInvalido("Diretório do zip corrompido.");
    const flags = v.getUint16(p + 8, true), metodo = v.getUint16(p + 10, true);
    const tamanho = v.getUint32(p + 20, true), expandido = v.getUint32(p + 24, true);
    const nLen = v.getUint16(p + 28, true), eLen = v.getUint16(p + 30, true), cLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    if (flags & 1 || (metodo !== 0 && metodo !== 8)) throw new ZipInvalido("ZIP criptografado ou com compressão não suportada.");
    if (tamanho === 0xffffffff || expandido === 0xffffffff || local === 0xffffffff || v.getUint16(p + 34, true)) throw new ZipInvalido("ZIP dividido ou ZIP64 não suportado.");
    if (p + 46 + nLen + eLen + cLen > fimDiretorio || local + 30 > v.getUint32(fim + 16, true) || v.getUint32(local, true) !== 0x04034b50) throw new ZipInvalido("Entrada do zip corrompida.");
    const nome = nomeDe.decode(dados.subarray(p + 46, p + 46 + nLen));
    const localNomeLen = v.getUint16(local + 26, true), localExtraLen = v.getUint16(local + 28, true);
    const inicio = local + 30 + localNomeLen + localExtraLen;
    if (!nome || mapa.has(nome) || nome.includes("\0") || inicio + tamanho > v.getUint32(fim + 16, true) || v.getUint16(local + 8, true) !== metodo || v.getUint16(local + 6, true) !== flags || nomeDe.decode(dados.subarray(local + 30, local + 30 + localNomeLen)) !== nome) throw new ZipInvalido("Entrada do zip corrompida.");
    declarado += expandido;
    if (expandido > limites.entrada || declarado > limites.expandido || expandido > Math.max(1, tamanho) * limites.razao || (metodo === 0 && tamanho !== expandido)) throw new ZipInvalido(EXCESSO);
    mapa.set(nome, { metodo, tamanho, expandido, inicio });
    p += 46 + nLen + eLen + cLen;
  }
  if (p !== fimDiretorio) throw new ZipInvalido("Diretório do zip corrompido.");
  return {
    mapa, prazo, verificarPrazo,
    teto: (e: EntradaZip) => Math.min(e.expandido, limites.entrada, limites.expandido - emitido, Math.max(1, e.tamanho) * limites.razao),
    contar: (e: EntradaZip, parcial: number, novos: number) => {
      verificarPrazo();
      emitido += novos;
      if (parcial > limites.entrada || emitido > limites.expandido || parcial > Math.max(1, e.tamanho) * limites.razao || parcial > e.expandido) throw new ZipInvalido(EXCESSO);
    },
  };
}

export function abrirZip(dados: Uint8Array, opcoes: Partial<LimitesZip> = {}): Zip {
  const z = prepararZip(dados, opcoes);
  return {
    nomes: [...z.mapa.keys()],
    ler: async (nome) => {
      z.verificarPrazo();
      const e = z.mapa.get(nome);
      if (!e) return null;
      const bruto = dados.subarray(e.inicio, e.inicio + e.tamanho);
      if (e.metodo === 0) {
        z.contar(e, bruto.length, bruto.length);
        return new TextDecoder("utf-8").decode(bruto);
      }
      const leitor = new Blob([bruto.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const partes: string[] = [], decoder = new TextDecoder("utf-8");
      let bytes = 0, timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const expirou = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ZipInvalido(EXCESSO)), Math.max(1, z.prazo - performance.now())); });
        for (;;) {
          const { done, value } = await Promise.race([leitor.read(), expirou]);
          z.verificarPrazo();
          if (done) break;
          bytes += value.byteLength;
          // Contar bytes REAIS antes de criar qualquer string. Cabeçalhos ZIP não são confiáveis.
          z.contar(e, bytes, value.byteLength);
          partes.push(decoder.decode(value, { stream: true }));
        }
        if (bytes !== e.expandido) throw new ZipInvalido("Tamanho da entrada do zip inválido.");
        partes.push(decoder.decode());
        return partes.join("");
      } catch (erro) {
        void leitor.cancel().catch(() => undefined);
        if (erro instanceof ZipInvalido) throw erro;
        throw new ZipInvalido("Não foi possível descompactar o arquivo.");
      } finally {
        clearTimeout(timer);
        leitor.releaseLock();
      }
    },
  };
}
