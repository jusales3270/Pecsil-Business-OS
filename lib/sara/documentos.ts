import "server-only";

import { setorPorModulo } from "../documentos/setores";
import type { Ferramenta } from "./base";

/**
 * Leitura do Segundo Cérebro pela SARA: busca nos documentos do setor do módulo (os arquivos enviados e
 * lidos pela plataforma), com a sessão de quem pergunta — o banco só devolve o que a pessoa pode ver.
 * Devolve título, trecho e o link do arquivo. O texto dos documentos é dado, nunca instrução.
 */
export function ferramentaDeDocumentos(modulo: string, pode: (feature: string) => boolean): Ferramenta | null {
  const setor = setorPorModulo(modulo);
  if (!setor || ![setor.feature, ...(setor.outras ?? [])].some(pode)) return null;
  return {
    nome: "buscar_documentos_do_setor", rotulo: "documentos do setor", exige: [],
    descricao: `Busca nos documentos do setor ${setor.rotulo} guardados na plataforma (contratos, propostas, pedidos, relatórios, notas…): título, trecho onde aparece e o link do arquivo. Use para perguntas sobre o conteúdo dos documentos.`,
    esquema: { type: "object", properties: { busca: { type: "string", description: "Palavras para achar no texto dos documentos (aceita \"frase exata\" e -excluir)." } }, required: ["busca"] },
    rodar: async (sb, e) => {
      const busca = String(e.busca ?? "").trim().slice(0, 200);
      if (busca.length < 3) throw new Error("Diga ao menos 3 letras para buscar.");
      const { data, error } = await sb.rpc("company_document_search", { p_q: busca, p_setor: modulo, p_limite: 6 });
      if (error) throw new Error(error.message);
      const lista = ((data ?? []) as { id: string; title: string | null; original_name: string | null; created_at: string; trecho: string | null; como: string }[]);
      return {
        dados: { busca, encontrados: lista.map((d) => ({ titulo: d.title || d.original_name, enviado_em: d.created_at.slice(0, 10), trecho: (d.trecho ?? "").replace(/\[\[|\]\]/g, "").slice(0, 400), achado_por: d.como })),
          observacao: lista.length ? null : "Nenhum documento do setor tem essas palavras." },
        fontes: lista.map((d) => ({ rotulo: `Documento: ${d.title || d.original_name}`, link: `/api/documentos/${d.id}/baixar` })),
      };
    },
  };
}
