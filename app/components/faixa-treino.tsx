/**
 * Treino do orçamento ao faturamento (pedido do proprietário, 15/10/2026): faixa que deixa claro que
 * nada ali é de verdade, e o número do orçamento de treino (numeração própria T-1, T-2…).
 * Sai junto com o treino quando a plataforma entrar em produção.
 */
export const numeroOrcamento = (n: number, treino?: boolean) => (treino ? `T-${n}` : `#${n}`);

/** Escolha Reais × Treino, lembrada por pessoa e navegador (?treino=1 no endereço abre no treino). */
export const CHAVE_MODO_TREINO = "orcamentos_modo_treino";
export function lerModoTreino(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("treino") === "1") return true;
    return localStorage.getItem(CHAVE_MODO_TREINO) === "1";
  } catch { return false; }
}
export function gravarModoTreino(treino: boolean) {
  try { localStorage.setItem(CHAVE_MODO_TREINO, treino ? "1" : "0"); } catch { /* sem armazenamento: vale só nesta tela */ }
}

export function FaixaTreino({ texto }: { texto: string }) {
  return (
    <div className="nfe-faixa-treino" role="note">
      <b>TREINO — NÃO É DE VERDADE</b>
      <span>{texto}</span>
    </div>
  );
}
