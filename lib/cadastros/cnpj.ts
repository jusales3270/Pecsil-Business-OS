/** CNPJ para a tela: 00.000.000/0000-00 (o que não tem 14 dígitos volta como veio). */
export const cnpjFormatado = (c: string | null | undefined) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (c ?? "");
};
