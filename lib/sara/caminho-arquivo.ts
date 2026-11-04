const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Storage URLs normalize dot segments and escaped separators. Validate the raw object key,
 * never normalize/decode it into an apparently safe path. Server-generated SARA names use
 * only letters, digits, spaces, underscores, hyphens and dots in the final filename.
 */
export function caminhoArquivoSaraValido(caminho: unknown, organizacao: string, documento: string): caminho is string {
  if (!UUID.test(organizacao) || !UUID.test(documento) || typeof caminho !== "string" || caminho.length > 512) return false;
  const segmentos = caminho.split("/");
  if (segmentos.length !== 3 || segmentos[0] !== organizacao || segmentos[1] !== documento) return false;
  const arquivo = segmentos[2];
  // The allowlist also rejects %, backslashes, URL delimiters, control characters and encoded traversal.
  return arquivo.length <= 240 && /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(arquivo) && !/[. ]$/.test(arquivo);
}
