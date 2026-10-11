/**
 * PNG mínimo (8 bits, cinza ou RGB, sem entrelaçar), sem biblioteca: é só para entregar ao OCR
 * as imagens que o pdfjs tira das páginas escaneadas. Roda só no servidor.
 */
import { crc32, deflateSync } from "node:zlib";

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bloco(tipo: string, dados: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(dados.length, 0);
  cab.write(tipo, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cab.subarray(4), dados])) >>> 0, 0);
  return Buffer.concat([cab, dados, crc]);
}

/** `canais`: 1 = cinza, 3 = RGB. `pixels` tem largura × altura × canais bytes. */
export function pngDe(largura: number, altura: number, canais: 1 | 3, pixels: Uint8Array): Buffer {
  const linha = largura * canais;
  if (pixels.length < linha * altura) throw new Error("Imagem incompleta.");
  const cru = Buffer.alloc((linha + 1) * altura);
  for (let y = 0; y < altura; y++) {
    cru[y * (linha + 1)] = 0; // filtro "nenhum"
    cru.set(pixels.subarray(y * linha, (y + 1) * linha), y * (linha + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = canais === 1 ? 0 : 2; // 0 = cinza, 2 = RGB
  return Buffer.concat([ASSINATURA, bloco("IHDR", ihdr), bloco("IDAT", deflateSync(cru)), bloco("IEND", Buffer.alloc(0))]);
}
