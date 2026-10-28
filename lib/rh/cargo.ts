/**
 * Cargo digitado no cadastro do colaborador. O cadastro de cargos (positions) usa um código único por
 * empresa no formato "AJUDANTE-DE-FUNDICAO": maiúsculas, sem acento, hífen no lugar do resto. O mesmo
 * código acha o cargo que já existe com outra grafia ("auxiliar qa" = "Auxiliar QA") e evita duplicado.
 * Testado em tests/rh-cargo.test.mjs.
 */

/** Nome como fica gravado: sem espaços sobrando. */
export const nomeDoCargo = (nome: string | null | undefined) => String(nome ?? "").trim().replace(/\s+/g, " ");

export function codigoDoCargo(nome: string | null | undefined): string {
  return nomeDoCargo(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** O texto que a ficha mostra quando não há cargo: não é um cargo e nunca vira cadastro. */
export const SEM_CARGO = "Cargo não informado";
