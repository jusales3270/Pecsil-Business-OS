/** Pedaços comuns às telas de cadastro (fornecedores, clientes, centros de custo). */

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** CNPJ (14 dígitos) ou CPF (11) com a pontuação de sempre. */
export function formatTaxId(digits: string | null) {
  if (!digits) return null;
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return digits;
}

/** Envia e devolve a mensagem de erro, ou null quando deu certo. */
export async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data.error ?? "Não foi possível salvar.";
}
