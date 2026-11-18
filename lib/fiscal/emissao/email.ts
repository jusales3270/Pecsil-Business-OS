/** Um ou mais e-mails (separados por ; ou ,), cada um podendo vir como "Nome <email>", como o GRV manda e a SEFAZ aceita. Puro. */
export function emailsValidos(t: string): boolean {
  const partes = t.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  return partes.length > 0 && partes.every((x) => /^(?:[^<>]*<)?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/.test(x));
}
