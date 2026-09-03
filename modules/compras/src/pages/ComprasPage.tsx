import { useState, useMemo } from 'react';
import { useStore, formatCurrency, formatDate } from '@/store';
import { Search, ShoppingCart, Calendar, FilterX } from 'lucide-react';
import DivisaoTabs from '@/components/DivisaoTabs';

import { useEffect } from 'react';

export default function ComprasPage() {
  const { user, compras, cotacoes, currentDivisao, activeCotacaoIdForModal, setActiveCotacaoIdForModal } = useStore();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (activeCotacaoIdForModal) {
      setSearch(`#${activeCotacaoIdForModal}`);
      setActiveCotacaoIdForModal(null);
    }
  }, [activeCotacaoIdForModal, setActiveCotacaoIdForModal]);

  // Both Orçamentista and Gestor filter by division
  const filteredCompras = compras.filter(c => {
    if (!user) return false;
    const cot = cotacoes.find(ct => ct.id === c.cotacaoId);
    if (!cot) return false;
    if (user.role === 'ORCAMENTISTA' && cot.userId !== user.id) return false;
    // Filter by division for both roles
    if (cot.divisao !== currentDivisao) return false;
    // Date filter
    if (dateFrom) {
      const from = new Date(dateFrom + 'T00:00:00');
      if (new Date(c.dataCompra) < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59');
      if (new Date(c.dataCompra) > to) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      const matchId = s.startsWith('#')
        ? String(c.cotacaoId) === s.substring(1)
        : String(c.cotacaoId) === s;
      return matchId || c.fornecedor.toLowerCase().includes(s) || c.produto.toLowerCase().includes(s);
    }
    return true;
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Counts for division tabs
  const divisaoCounts = useMemo(() => {
    if (!user) return { USINAGEM: 0, FUNDICAO: 0 };
    const counts = { USINAGEM: 0, FUNDICAO: 0 };
    compras.forEach(c => {
      const cot = cotacoes.find(ct => ct.id === c.cotacaoId);
      if (!cot) return;
      if (user.role === 'ORCAMENTISTA' && cot.userId !== user.id) return;
      if (cot.divisao === 'USINAGEM') counts.USINAGEM++;
      if (cot.divisao === 'FUNDICAO') counts.FUNDICAO++;
    });
    return counts;
  }, [user, compras, cotacoes]);

  const hasFilters = search || dateFrom || dateTo;

  const clearFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-4">
      {/* Division Tabs */}
      <DivisaoTabs counts={divisaoCounts} />

      {/* Header */}
      <h2 className="text-lg font-semibold text-[#212121]">Compras Realizadas</h2>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575]" />
          <input
            type="text"
            placeholder="Buscar por fornecedor ou produto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-black/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#757575] pointer-events-none" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="pl-8 pr-2 py-2 rounded-lg border border-black/[0.08] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              title="Data inicial"
            />
          </div>
          <span className="text-xs text-[#757575]">até</span>
          <div className="relative">
            <Calendar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#757575] pointer-events-none" />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="pl-8 pr-2 py-2 rounded-lg border border-black/[0.08] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              title="Data final"
            />
          </div>
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-black/[0.08] text-sm text-[#757575] hover:bg-gray-50 transition-colors"
          >
            <FilterX size={14} />
            Limpar
          </button>
        )}
      </div>

      {/* Table - Desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-black/[0.08] shadow-sm overflow-hidden">
        {filteredCompras.length === 0 ? (
          <div className="py-12 text-center text-[#757575]">
            <ShoppingCart size={40} className="mx-auto mb-3 text-[#1565c0]" />
            <p className="text-sm font-medium">Nenhuma compra realizada</p>
            <p className="text-xs mt-1">As compras aparecerão aqui após serem registradas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.08] bg-[#fafafa]">
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">ID</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Fornecedor</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Produto</th>
                  <th className="text-right py-3 px-4 font-medium text-[#757575] text-xs uppercase">Qtd</th>
                  <th className="text-right py-3 px-4 font-medium text-[#757575] text-xs uppercase">Total</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Data</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">NF</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompras.map(c => (
                  <tr key={c.id} className="border-b border-black/[0.04] hover:bg-[#fafafa] transition-colors">
                    <td className="py-3 px-4 font-medium text-[#212121]">#{c.id}</td>
                    <td className="py-3 px-4 text-[#212121] max-w-[180px] truncate">{c.fornecedor}</td>
                    <td className="py-3 px-4 text-[#212121] max-w-[220px] truncate">{c.produto}</td>
                    <td className="py-3 px-4 text-right text-[#212121]">{c.quantidade} {c.unidade}</td>
                    <td className="py-3 px-4 text-right font-medium text-primary">{formatCurrency(c.total)}</td>
                    <td className="py-3 px-4 text-[#757575]">{formatDate(c.dataCompra)}</td>
                    <td className="py-3 px-4 text-[#757575]">{c.nf || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {filteredCompras.length === 0 ? (
          <div className="bg-white rounded-xl border border-black/[0.08] p-8 text-center text-[#757575]">
            <ShoppingCart size={40} className="mx-auto mb-3 text-[#1565c0]" />
            <p className="text-sm font-medium">Nenhuma compra realizada</p>
          </div>
        ) : (
          filteredCompras.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#757575]">#{c.id}</span>
                <span className="text-xs text-[#757575]">{formatDate(c.dataCompra)}</span>
              </div>
              <p className="text-sm font-medium text-[#212121]">{c.fornecedor}</p>
              <p className="text-xs text-[#757575] mb-2">{c.produto}</p>
              <div className="flex items-center justify-between text-xs text-[#757575]">
                <span>{c.quantidade} {c.unidade}</span>
                <span className="font-semibold text-primary">{formatCurrency(c.total)}</span>
              </div>
              {c.nf && <p className="text-xs text-[#757575] mt-1">NF: {c.nf}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
