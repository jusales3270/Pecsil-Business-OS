"use client";

import { useId, useMemo, useRef, useState } from "react";
import { buscarProdutos } from "../../../../lib/comercial/busca-produto";
import type { Produto } from "./Produtos";

/**
 * Campo "Produto" do item do orçamento: ao digitar, abre a lista das peças cadastradas (código,
 * descrição, desenho, cliente). ↑/↓ escolhem, Enter aplica, Esc fecha. No fim da lista, "Cadastrar
 * produto" para a peça que ainda não existe (só para quem cadastra produtos).
 */
export function BuscaProduto({ valor, produtos, clienteId, nomeCliente, escolhido, disabled, podeCadastrar, labelledBy, onDigitar, onEscolher, onCadastrar }: {
  valor: string; produtos: Produto[]; clienteId: string | null; nomeCliente: (id: string | null) => string | null; escolhido: boolean; disabled?: boolean;
  podeCadastrar: boolean; labelledBy?: string; onDigitar: (texto: string) => void; onEscolher: (p: Produto) => void; onCadastrar: (texto: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const listId = useId();
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Já escolhido: a lista só reabre quando a pessoa mexe no texto.
  const lista = useMemo(() => (escolhido ? [] : buscarProdutos(produtos, valor, { clienteId })), [produtos, valor, clienteId, escolhido]);
  const comCadastro = podeCadastrar && !escolhido;
  const total = lista.length + (comCadastro ? 1 : 0);
  const visivel = aberto && !disabled && total > 0;

  const escolher = (k: number) => {
    setAberto(false);
    if (k < lista.length) onEscolher(lista[k]);
    else if (comCadastro) onCadastrar(valor);
  };

  return (
    <div className="vnd-busca-produto">
      <input
        type="text" role="combobox" aria-labelledby={labelledBy} aria-expanded={visivel} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={visivel ? `${listId}-${ativo}` : undefined} autoComplete="off" value={valor} disabled={disabled}
        placeholder="Digite o código ou a descrição: 5-01, ANEL…"
        className={valor.trim() && !escolhido ? "vnd-invalido" : undefined}
        onChange={(e) => { onDigitar(e.target.value); setAtivo(0); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onBlur={() => { fechar.current = setTimeout(() => setAberto(false), 150); }}
        onKeyDown={(e) => {
          if (!visivel) { if (e.key === "ArrowDown") { setAberto(true); e.preventDefault(); } return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => (i + 1) % total); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => (i - 1 + total) % total); }
          else if (e.key === "Enter") { e.preventDefault(); escolher(Math.min(ativo, total - 1)); }
          else if (e.key === "Escape") { e.stopPropagation(); setAberto(false); }
        }}
      />
      {visivel && (
        <ul id={listId} role="listbox" aria-labelledby={labelledBy} className="vnd-busca-lista">
          {lista.length === 0 && <li className="vnd-busca-vazio" aria-hidden="true">Nenhum produto com “{valor.trim()}”.</li>}
          {lista.map((p, k) => {
            const cliente = nomeCliente(p.customer_id);
            return (
              <li key={p.id} id={`${listId}-${k}`} role="option" aria-selected={k === ativo} className={k === ativo ? "ativo" : undefined}
                onMouseDown={(e) => { e.preventDefault(); if (fechar.current) clearTimeout(fechar.current); escolher(k); }}
                onMouseEnter={() => setAtivo(k)}>
                <span className="vnd-codigo">{p.codigo}</span>
                <span className="vnd-busca-desc">{p.descricao}</span>
                {(cliente || p.desenho_codigo) && <small>{[cliente, p.desenho_codigo && `desenho ${p.desenho_codigo}`].filter(Boolean).join(" · ")}</small>}
              </li>
            );
          })}
          {comCadastro && (
            <li id={`${listId}-${lista.length}`} role="option" aria-selected={ativo === lista.length} className={`vnd-busca-novo${ativo === lista.length ? " ativo" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); if (fechar.current) clearTimeout(fechar.current); escolher(lista.length); }}
              onMouseEnter={() => setAtivo(lista.length)}>
              + Cadastrar produto{valor.trim() ? ` “${valor.trim()}”` : ""}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
