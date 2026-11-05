import { deflateRawSync } from "node:zlib";

/** Arquivos pequenos gerados no teste, com diretório ZIP explícito para testar metadados falsos. */
export function zipPequeno(entradas) {
  const locais = [], centrais = [];
  let offset = 0;
  for (const entrada of entradas) {
    const nome = Buffer.from(entrada.nome), conteudo = Buffer.from(entrada.texto ?? "");
    const metodo = entrada.metodo ?? 8;
    const dados = metodo === 0 ? conteudo : deflateRawSync(conteudo);
    const expandido = entrada.declarado ?? conteudo.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(expandido, 22); local.writeUInt16LE(nome.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(expandido, 24); central.writeUInt16LE(nome.length, 28); central.writeUInt32LE(offset, 42);
    locais.push(local, nome, dados); centrais.push(central, nome);
    offset += local.length + nome.length + dados.length;
  }
  const central = Buffer.concat(centrais), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(central.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, central, fim]);
}
