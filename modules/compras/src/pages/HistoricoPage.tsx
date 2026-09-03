import { useState, useMemo, useEffect } from 'react';
import { useStore, formatCurrency, formatDateTime } from '@/store';
import type { Cotacao } from '@/types';
import { CheckCircle, XCircle, Search, Calendar, FilterX, Eye } from 'lucide-react';
import DivisaoTabs from '@/components/DivisaoTabs';
import DetalhesCotacaoModal from '@/components/DetalhesCotacaoModal';

export default function HistoricoPage() {
  const { cotacoes, currentDivisao, activeCotacaoIdForModal, setActiveCotacaoIdForModal } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detailModal, setDetailModal] = useState<Cotacao | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (activeCotacaoIdForModal) {
      const found = cotacoes.find(c => c.id === activeCotacaoIdForModal && c.status !== 'PENDENTE');
      if (found) {
        setDetailModal(found);
      }
      setActiveCotacaoIdForModal(null);
    }
  }, [activeCotacaoIdForModal, setActiveCotacaoIdForModal, cotacoes]);

  const STATUS_OPTIONS = [
    { value: '', label: 'Todos' },
    { value: 'APROVADO', label: 'Aprovado' },
    { value: 'REJEITADO', label: 'Rejeitado' },
    { value: 'COMPRADO', label: 'Comprado' },
  ];

  // Helper functions for list values filtering (only showing rejected items when filtering by REJEITADO)
  const getFilteredProdutos = (c: Cotacao, filter: string) => {
    if (filter === 'REJEITADO') {
      const rejected = c.produtos?.filter(p => p.status === 'REJEITADO') || [];
      if (rejected.length > 0) return rejected;

      if (c.status === 'REJEITADO') {
        return [{
          id: 'legacy-' + c.id,
          produto: c.produto || '',
          valorUnit: c.valorUnit || 0,
          quantidade: c.quantidade || 0,
          unidade: c.unidade || 'un',
          icms: c.icms || 0,
          ipi: c.ipi || 0,
          status: 'REJEITADO' as const,
        }];
      }
    }
    return c.produtos && c.produtos.length > 0 ? c.produtos : [{
      id: 'legacy-' + c.id,
      produto: c.produto || '',
      valorUnit: c.valorUnit || 0,
      quantidade: c.quantidade || 0,
      unidade: c.unidade || 'un',
      icms: c.icms || 0,
      ipi: c.ipi || 0,
    }];
  };

  const calcularTotalProdutos = (prods: any[]) => {
    return prods.reduce((sum, p) => {
      const bruto = p.valorUnit * p.quantidade;
      const ipi = bruto * (p.ipi / 100);
      return sum + parseFloat((bruto + ipi).toFixed(2));
    }, 0);
  };

  const formatProdutosDesc = (prods: any[]) => {
    if (prods.length > 1) {
      return `${prods[0].produto} (+${prods.length - 1} itens)`;
    }
    return prods[0]?.produto || '';
  };

  const formatProdutosQtd = (prods: any[]) => {
    if (prods.length > 1) {
      return `${prods.length} itens`;
    }
    return prods[0] ? `${prods[0].quantidade} ${prods[0].unidade}` : '0 un';
  };

  const filtered = cotacoes
    .filter(c => {
      if (c.deletedAt !== null) return false;
      if (c.status === 'PENDENTE') return false; // Only decided
      if (c.divisao !== currentDivisao) return false;
      if (statusFilter) {
        if (statusFilter === 'REJEITADO') {
          const hasRejectedProduct = c.produtos && c.produtos.length > 0 && c.produtos.some(p => p.status === 'REJEITADO');
          if (c.status !== 'REJEITADO' && !hasRejectedProduct) return false;
        } else {
          if (c.status !== statusFilter) return false;
        }
      }
      if (search) {
        const s = search.toLowerCase();
        const matchesSupplier = c.fornecedor.toLowerCase().includes(s);
        const matchesProducts = c.produtos && c.produtos.length > 0
          ? c.produtos.some(p => p.produto.toLowerCase().includes(s))
          : (c.produto?.toLowerCase().includes(s) || false);
        if (!matchesSupplier && !matchesProducts) return false;
      }
      if (dateFrom && c.dataDecisao) {
        const from = new Date(dateFrom + 'T00:00:00');
        if (new Date(c.dataDecisao) < from) return false;
      }
      if (dateTo && c.dataDecisao) {
        const to = new Date(dateTo + 'T23:59:59');
        if (new Date(c.dataDecisao) > to) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const da = a.dataDecisao ? new Date(a.dataDecisao).getTime() : 0;
      const db = b.dataDecisao ? new Date(b.dataDecisao).getTime() : 0;
      return db - da;
    });

  // Counts for division tabs
  const divisaoCounts = useMemo(() => {
    const decided = cotacoes.filter(c => c.deletedAt === null && c.status !== 'PENDENTE');
    return {
      USINAGEM: decided.filter(c => c.divisao === 'USINAGEM').length,
      FUNDICAO: decided.filter(c => c.divisao === 'FUNDICAO').length,
    };
  }, [cotacoes]);

  const hasFilters = search || statusFilter || dateFrom || dateTo;

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-4">
      {/* Division Tabs */}
      <DivisaoTabs counts={divisaoCounts} />

      {/* Header */}
      <h2 className="text-lg font-semibold text-[#212121]">Histórico de Decisões</h2>

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
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-black/[0.08] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
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
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-[#757575]">
            <ClockIcon />
            <p className="text-sm font-medium">Nenhuma decisão registrada</p>
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
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Decidido Por</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Data</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const prods = getFilteredProdutos(c, statusFilter);
                  return (
                    <tr key={c.id} className="border-b border-black/[0.04] hover:bg-[#fafafa] transition-colors">
                      <td className="py-3 px-4 font-medium text-[#212121]">#{c.id}</td>
                      <td className="py-3 px-4 text-[#212121] max-w-[180px] truncate">{c.fornecedor}</td>
                      <td className="py-3 px-4 text-[#212121] max-w-[220px] truncate" title={prods.map(p => p.produto).join(', ')}>
                        {formatProdutosDesc(prods)}
                      </td>
                      <td className="py-3 px-4 text-right text-[#212121]">{formatProdutosQtd(prods)}</td>
                      <td className="py-3 px-4 text-right font-medium text-primary">{formatCurrency(calcularTotalProdutos(prods))}</td>
                      <td className="py-3 px-4">
                        <DecisionStatus status={c.status} cotacao={c} />
                      </td>
                      <td className="py-3 px-4 text-[#757575]">{c.aprovadoPor || '—'}</td>
                      <td className="py-3 px-4 text-[#757575] whitespace-nowrap">
                        {c.dataDecisao ? formatDateTime(c.dataDecisao) : '—'}
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          onClick={() => setDetailModal(c)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#757575] hover:bg-gray-100 transition-colors"
                          title="Ver detalhes"
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-black/[0.08] p-8 text-center text-[#757575]">
            <ClockIcon />
            <p className="text-sm font-medium">Nenhuma decisão registrada</p>
          </div>
        ) : (
          filtered.map(c => {
            const prods = getFilteredProdutos(c, statusFilter);
            return (
              <div key={c.id} className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-4 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#757575]">#{c.id}</span>
                  <DecisionStatus status={c.status} cotacao={c} />
                </div>
                <p className="text-sm font-medium text-[#212121]">{c.fornecedor}</p>
                <p className="text-xs text-[#757575]">{formatProdutosDesc(prods)}</p>
                <div className="flex items-center justify-between text-xs text-[#757575] pt-1">
                  <span>{formatProdutosQtd(prods)}</span>
                  <span className="font-semibold text-primary">{formatCurrency(calcularTotalProdutos(prods))}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-[#757575] pt-1.5 border-t border-black/[0.04] mt-1.5">
                  <span>Decidido por: <strong>{c.aprovadoPor || '—'}</strong></span>
                  {c.dataDecisao && <span>{formatDateTime(c.dataDecisao)}</span>}
                </div>
                <div className="flex pt-2 gap-2">
                  <button
                    onClick={() => setDetailModal(c)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#f5f5f5] text-[#212121] hover:bg-[#e8e8e8] transition-colors"
                  >
                    <Eye size={13} /> Ver detalhes
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Details Modal */}
      {detailModal && (
        <DetalhesCotacaoModal
          cotacao={detailModal}
          onClose={() => setDetailModal(null)}
          onlyRejected={statusFilter === 'REJEITADO'}
        />
      )}
    </div>
  );
}

function DecisionStatus({ status, cotacao }: { status: string; cotacao?: Cotacao }) {
  const isPartial = status === 'APROVADO' && cotacao?.produtos && cotacao.produtos.length > 0 && cotacao.produtos.some(p => p.status !== 'APROVADO');
  if (status === 'APROVADO') {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
        isPartial 
          ? 'bg-[#fffde7] text-[#f57f17] border border-[#f57f17]/20' 
          : 'bg-[#e8f5e9] text-[#2e7d32]'
      }`}>
        <CheckCircle size={10} /> {isPartial ? 'Aprovado (Parcial)' : 'Aprovado'}
      </span>
    );
  }
  if (status === 'REJEITADO') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ffebee] text-[#c62828]">
        <XCircle size={10} /> Rejeitado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#e3f2fd] text-[#1565c0]">
      Comprado
    </span>
  );
}

function ClockIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9e9e9e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
