import { useId, useMemo, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { Cotacao } from '@/types';
import { temOrdemDeCompra } from '@/store';
import { numeroDaBusca, sugestoesPorNumero, type Sugestao } from '../../../../lib/compras/busca-numero';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** As compras em que procurar o número (as da pessoa, das duas divisões). */
  compras: readonly Cotacao[];
  /** Escolheu a cotação: abre os detalhes. */
  onCotacao: (c: Cotacao) => void;
  /** Escolheu a OC: abre a Ordem de Compra. */
  onOC: (c: Cotacao) => void;
  placeholder?: string;
}

const DIVISAO: Record<string, string> = { USINAGEM: 'Usinagem', FUNDICAO: 'Fundição' };

/**
 * A busca de "Minhas Cotações". Texto continua filtrando a tabela por fornecedor ou produto; número abre a
 * lista das compras com aquele número (lib/compras/busca-numero.ts). Compra que já tem OC vem duas vezes, como
 * cotação e como OC, para a pessoa escolher o que abrir. ↑/↓ escolhem, Enter abre, Esc fecha.
 */
export default function BuscaCompraInput({ value, onChange, compras, onCotacao, onOC, placeholder }: Props) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const listId = useId();
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);

  const numero = numeroDaBusca(value);
  const lista = useMemo<Sugestao<Cotacao>[]>(() => (numero ? sugestoesPorNumero([...compras], numero, temOrdemDeCompra) : []), [numero, compras]);
  const visivel = aberto && numero !== null;

  const escolher = (s: Sugestao<Cotacao>) => {
    setAberto(false);
    if (s.tipo === 'oc') onOC(s.compra); else onCotacao(s.compra);
  };

  const produto = (c: Cotacao) => {
    const itens = c.produtos && c.produtos.length > 0 ? c.produtos.map(p => p.produto) : [c.produto ?? ''];
    return itens.length > 1 ? `${itens[0]} (+${itens.length - 1} itens)` : itens[0];
  };

  return (
    <div className="relative flex-1 min-w-[200px] max-w-[400px]">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575]" />
      <input
        type="text"
        role="combobox"
        aria-expanded={visivel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visivel && lista.length ? `${listId}-${ativo}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setAtivo(0); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onBlur={() => { fechar.current = setTimeout(() => setAberto(false), 150); }}
        onKeyDown={(e) => {
          if (!visivel || !lista.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => (i + 1) % lista.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => (i - 1 + lista.length) % lista.length); }
          else if (e.key === 'Enter') { e.preventDefault(); escolher(lista[Math.min(ativo, lista.length - 1)]); }
          else if (e.key === 'Escape') { e.stopPropagation(); setAberto(false); }
        }}
        className="w-full pl-9 pr-3 py-2 rounded-lg border border-black/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
      />
      {visivel && (
        <ul id={listId} role="listbox" aria-label="Cotações e OCs com este número"
          className="absolute left-0 right-0 z-[60] mt-1 max-h-80 overflow-y-auto rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg">
          {lista.length === 0 && <li className="px-3 py-2 text-sm text-[#757575]">Nenhuma cotação ou OC sua com o nº {numero}.</li>}
          {lista.map((s, i) => (
            <li
              key={`${s.tipo}-${s.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => { e.preventDefault(); if (fechar.current) clearTimeout(fechar.current); escolher(s); }}
              onMouseEnter={() => setAtivo(i)}
              className={`cursor-pointer px-3 py-2 ${i === ativo ? 'bg-blue-50' : ''}`}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium text-[#212121]">
                {s.tipo === 'oc' && <FileText size={13} className="text-primary" aria-hidden />}
                {s.tipo === 'oc' ? `OC nº ${s.id}` : `Cotação nº ${s.id}`}
                <span className="font-normal text-[11px] text-[#757575]">{s.tipo === 'oc' ? '· abrir a Ordem de Compra' : '· ver os detalhes'}</span>
              </div>
              <div className="truncate text-[11px] text-[#757575]">
                {s.compra.fornecedor} · {produto(s.compra)}{DIVISAO[s.compra.divisao] ? ` · ${DIVISAO[s.compra.divisao]}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
