/** sha256 de um arquivo no próprio navegador (nada sobe para comparar com o que já está guardado). */
export async function sha256Hex(dados: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
