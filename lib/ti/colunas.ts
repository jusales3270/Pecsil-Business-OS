/** Colunas lidas pelas telas do módulo de TI (sem dado pessoal: o responsável é só o nome). */
export const COLUNAS_ATIVO = "id, numero, tipo, nome, local, responsavel, fabricante, modelo, numero_serie, patrimonio, ip, sistema_operacional, critico, situacao, vigia_alvo, observacao, updated_at";
export const COLUNAS_CHAMADO = "id, numero, titulo, descricao, categoria, prioridade, situacao, ativo_id, local, solicitante_id, solicitante_nome, responsavel_id, responsavel_nome, prazo, primeira_resposta_em, resolvido_em, solucao, created_at, updated_at, ti_ativos(numero, nome)";
