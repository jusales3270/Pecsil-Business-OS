/** País do destinatário: vazio ou 1058 (Brasil) é operação no país; outro código do BACEN é exterior. Puro. */
export const exterior = (pais: string | null | undefined) => Boolean(pais && pais.replace(/\D/g, "") && pais.replace(/\D/g, "") !== "1058");
