"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Campo de material ligado ao catálogo do Almoxarifado (A-01 · PLANO-ALMOXARIFADO M2). Ao digitar,
 * busca no servidor pelo código (com ou sem traço) ou pelo nome. ↑/↓ escolhem, Enter aplica, Esc
 * fecha. Texto livre continua valendo: sem escolher, o item segue como hoje e fica "sem material".
 * Escolhido, mostra o código; mexer no texto desfaz a ligação.
 */
export type MaterialEscolhido = { id: string; codigo: string; descricao: string; unidade: string };

export function BuscaMaterial({ valor, material, onDigitar, onEscolher, placeholder, ariaLabel, autoFocus, disabled, origem }: {
  valor: string;
  material: MaterialEscolhido | null;
  onDigitar: (texto: string) => void;
  onEscolher: (m: MaterialEscolhido) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Como o material chegou (ex.: "pelo código do fornecedor"), mostrado ao lado do código. */
  origem?: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [lista, setLista] = useState<MaterialEscolhido[]>([]);
  const [buscando, setBuscando] = useState(false);
  const listId = useId();
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const termo = material ? "" : valor.trim();

  useEffect(() => {
    if (termo.length < 2) return;
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/almoxarifado/materiais?q=${encodeURIComponent(termo)}&limite=8`, { cache: "no-store" });
        const d = r.ok ? await r.json() : { materiais: [] };
        if (vivo) { setLista((d.materiais ?? []).map((m: MaterialEscolhido) => ({ id: m.id, codigo: m.codigo, descricao: m.descricao, unidade: m.unidade }))); setAtivo(0); }
      } catch { if (vivo) setLista([]); }
      if (vivo) setBuscando(false);
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo]);

  const opcoes = termo.length >= 2 ? lista : [];
  const visivel = aberto && !disabled && termo.length >= 2;
  const escolher = (k: number) => { const m = opcoes[k]; setAberto(false); if (m) onEscolher(m); };

  return (
    <div className="vnd-busca-produto almox-busca-material">
      <input
        type="text" role="combobox" aria-label={ariaLabel} aria-expanded={visivel} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={visivel && opcoes.length ? `${listId}-${ativo}` : undefined} autoComplete="off" value={valor} disabled={disabled}
        placeholder={placeholder ?? "Código ou nome do material: 2-01-00893, parafuso…"} autoFocus={autoFocus}
        onChange={(e) => { onDigitar(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onBlur={() => { fechar.current = setTimeout(() => setAberto(false), 150); }}
        onKeyDown={(e) => {
          if (!visivel || !opcoes.length) { if (e.key === "Escape") setAberto(false); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => (i + 1) % opcoes.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => (i - 1 + opcoes.length) % opcoes.length); }
          else if (e.key === "Enter") { e.preventDefault(); escolher(ativo); }
          else if (e.key === "Escape") { e.stopPropagation(); setAberto(false); }
        }}
      />
      {material
        ? <small className="almox-material-ligado" title={material.descricao}><span className="vnd-codigo">{material.codigo}</span> {material.unidade}{origem ? ` · ${origem}` : ""}</small>
        : valor.trim() ? <small className="almox-material-livre">sem material do catálogo</small> : null}
      {visivel && (
        <ul id={listId} role="listbox" aria-label={ariaLabel} className="vnd-busca-lista">
          {!opcoes.length && <li className="vnd-busca-vazio" aria-hidden="true">{buscando ? "Buscando…" : `Nenhum material com “${termo}”: segue como texto livre.`}</li>}
          {opcoes.map((m, k) => (
            <li key={m.id} id={`${listId}-${k}`} role="option" aria-selected={k === ativo} className={k === ativo ? "ativo" : undefined}
              onMouseDown={(e) => { e.preventDefault(); if (fechar.current) clearTimeout(fechar.current); escolher(k); }}
              onMouseEnter={() => setAtivo(k)}>
              <span className="vnd-codigo">{m.codigo}</span>
              <span className="vnd-busca-desc">{m.descricao}</span>
              <small>{m.unidade}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
