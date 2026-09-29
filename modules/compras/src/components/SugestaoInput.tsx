import { useId, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { isExactOnly, rankSuggestions, type Suggestion } from '../../../../lib/compras/sugestoes-core';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Chamado ao escolher uma sugestão (clique ou Enter). */
  onPick?: (suggestion: Suggestion) => void;
  suggestions: readonly Suggestion[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Título da lista (ex.: "Fornecedores cadastrados"). */
  label?: string;
}

/**
 * Campo de texto com sugestões do que já está cadastrado. Digitar 2+ letras
 * abre a lista; ↑/↓ escolhem, Enter aplica, Esc fecha. Continua aceitando
 * texto livre — a sugestão só evita criar outra grafia do que já existe.
 */
export default function SugestaoInput({ value, onChange, onPick, suggestions, placeholder, className, autoFocus, label }: Props) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const listId = useId();
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lista = useMemo(() => {
    const ranked = rankSuggestions(value, suggestions);
    return isExactOnly(value, ranked) ? [] : ranked;
  }, [value, suggestions]);
  const visivel = aberto && lista.length > 0;

  const escolher = (s: Suggestion) => {
    onChange(s.value);
    onPick?.(s);
    setAberto(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={visivel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visivel ? `${listId}-${ativo}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          setAtivo(0);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => {
          // O clique na lista acontece depois do blur: dá tempo de ele valer.
          fechar.current = setTimeout(() => setAberto(false), 150);
        }}
        onKeyDown={(e) => {
          if (!visivel) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAtivo((i) => (i + 1) % lista.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAtivo((i) => (i - 1 + lista.length) % lista.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            escolher(lista[Math.min(ativo, lista.length - 1)]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setAberto(false);
          }
        }}
      />
      {visivel && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-[60] mt-1 max-h-72 overflow-y-auto rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg"
        >
          {label && (
            <li className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#757575]" aria-hidden="true">
              <History size={11} /> {label}
            </li>
          )}
          {lista.map((s, i) => (
            <li
              key={`${s.value}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => {
                e.preventDefault();
                if (fechar.current) clearTimeout(fechar.current);
                escolher(s);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={`cursor-pointer px-3 py-2 ${i === ativo ? 'bg-blue-50' : ''}`}
            >
              <div className="text-sm text-[#212121]">{s.value}</div>
              {s.hint && <div className="text-[11px] text-[#757575]">{s.hint}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
