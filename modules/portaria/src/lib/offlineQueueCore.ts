/**
 * Regras puras da fila offline da Portaria (sem banco nem localStorage).
 *
 * Uma operação feita sem conexão sobre um registro que também foi criado sem
 * conexão aponta para o id provisório do navegador ("temp-…"). Estas regras
 * garantem que a fila:
 * - descarta criar → (encerrar/editar) → excluir do mesmo registro provisório,
 *   que juntas não mudam nada (antes, a criação era gravada e o resto falhava,
 *   deixando no banco um registro "em andamento" que ninguém queria);
 * - troca o id provisório pelo real assim que a criação é gravada;
 * - não executa operação que aponta para um provisório sem criação na fila
 *   (nunca poderia dar certo).
 */

export type OperacaoFila = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  tempId?: string;
};

export const ehProvisorio = (id: unknown): id is string => typeof id === "string" && id.startsWith("temp-");

/** Remove os registros provisórios criados e excluídos antes de chegar ao banco. */
export function compactarFila<T extends OperacaoFila>(fila: T[]): { fila: T[]; descartadas: T[] } {
  const criados = new Set(fila.filter((op) => op.type.startsWith("insert_") && op.tempId).map((op) => op.tempId as string));
  const excluidos = new Set(
    fila
      .filter((op) => op.type.startsWith("delete_") && ehProvisorio(op.payload.id) && criados.has(op.payload.id))
      .map((op) => op.payload.id as string),
  );
  const descartadas: T[] = [];
  const restante = fila.filter((op) => {
    const alvo = op.type.startsWith("insert_") ? op.tempId : op.payload.id;
    if (typeof alvo === "string" && excluidos.has(alvo)) {
      descartadas.push(op);
      return false;
    }
    return true;
  });
  return { fila: restante, descartadas };
}

/**
 * Decide o que fazer com a operação que aponta para um registro:
 * - "executar" com o payload já com o id real;
 * - "aguardar": a criação do provisório ainda está pendente na fila;
 * - "orfa": provisório sem criação na fila — nunca vai dar certo.
 */
export function resolverAlvo(
  op: OperacaoFila,
  idsReais: ReadonlyMap<string, string>,
  criacoesPendentes: ReadonlySet<string>,
): { acao: "executar"; payload: Record<string, unknown> } | { acao: "aguardar" } | { acao: "orfa" } {
  const alvo = op.payload.id;
  if (!ehProvisorio(alvo)) return { acao: "executar", payload: op.payload };
  const real = idsReais.get(alvo);
  if (real) return { acao: "executar", payload: { ...op.payload, id: real } };
  if (criacoesPendentes.has(alvo)) return { acao: "aguardar" };
  return { acao: "orfa" };
}
