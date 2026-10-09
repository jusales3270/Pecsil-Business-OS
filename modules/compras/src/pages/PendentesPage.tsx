import { useState, useMemo, useEffect } from 'react';
import { useStore, totalDoPedido, formatCurrency, formatAmount, formatCotacaoProdutosDesc, formatCotacaoProdutosQtd } from '@/store';
import type { Cotacao } from '@/types';
import { Eye, CheckCircle, XCircle, Scale, Search, Calendar, FilterX } from 'lucide-react';
import { toast } from 'sonner';
import DetalhesCotacaoModal from '@/components/DetalhesCotacaoModal';
import DivisaoTabs from '@/components/DivisaoTabs';

export default function PendentesPage() {
  const { cotacoes, approveCotacao, rejectCotacao, currentDivisao, activeCotacaoIdForModal, setActiveCotacaoIdForModal } = useStore();
  const [detailModal, setDetailModal] = useState<Cotacao | null>(null);
  const [rejectModal, setRejectModal] = useState<Cotacao | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [confirmModal, setConfirmModal] = useState<Cotacao | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (activeCotacaoIdForModal) {
      const found = cotacoes.find(c => c.id === activeCotacaoIdForModal && c.status === 'PENDENTE');
      if (found) {
        setDetailModal(found);
      }
      setActiveCotacaoIdForModal(null);
    }
  }, [activeCotacaoIdForModal, setActiveCotacaoIdForModal, cotacoes]);

  const pendentes = cotacoes
    .filter(c => {
      if (c.status !== 'PENDENTE' || c.deletedAt !== null) return false;
      if (c.divisao !== currentDivisao) return false;
      if (search) {
        const s = search.toLowerCase();
        const matchesSupplier = c.fornecedor.toLowerCase().includes(s);
        const matchesProducts = c.produtos && c.produtos.length > 0
          ? c.produtos.some(p => p.produto.toLowerCase().includes(s))
          : (c.produto?.toLowerCase().includes(s) || false);
        if (!matchesSupplier && !matchesProducts) return false;
      }
      if (dateFrom) {
        const from = new Date(dateFrom + 'T00:00:00');
        if (new Date(c.createdAt) < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo + 'T23:59:59');
        if (new Date(c.createdAt) > to) return false;
      }
      return true;
    })
    .sort((a, b) => totalDoPedido(b) - totalDoPedido(a));

  const totalPendente = pendentes.reduce((sum, c) => sum + totalDoPedido(c), 0);

  // Counts for division tabs
  const divisaoCounts = useMemo(() => {
    const allPendentes = cotacoes.filter(c => c.status === 'PENDENTE' && c.deletedAt === null);
    return {
      USINAGEM: allPendentes.filter(c => c.divisao === 'USINAGEM').length,
      FUNDICAO: allPendentes.filter(c => c.divisao === 'FUNDICAO').length,
    };
  }, [cotacoes]);

  const hasFilters = search || dateFrom || dateTo;

  const clearFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const handleApprove = async (cotacao: Cotacao) => {
    if (totalDoPedido(cotacao) > 5000) {
      setConfirmModal(cotacao);
    } else {
      try {
        await approveCotacao(cotacao.id);
        toast.success(`Cotação #${cotacao.id} aprovada com sucesso!`);
      } catch (err) {
        console.error(err);
        toast.error('Erro ao aprovar cotação no banco de dados.');
      }
    }
  };

  const handleConfirmApprove = async () => {
    if (confirmModal) {
      try {
        await approveCotacao(confirmModal.id);
        toast.success(`Cotação #${confirmModal.id} aprovada com sucesso!`);
        setConfirmModal(null);
      } catch (err) {
        console.error(err);
        toast.error('Erro ao aprovar cotação no banco de dados.');
      }
    }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    if (!rejectReason.trim() || rejectReason.trim().length < 10) {
      setRejectError('O motivo deve ter pelo menos 10 caracteres');
      return;
    }
    try {
      await rejectCotacao(rejectModal.id, rejectReason.trim());
      toast.warning(`Cotação #${rejectModal.id} rejeitada. Orçamentista será notificado.`);
      setRejectModal(null);
      setRejectReason('');
      setRejectError('');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao rejeitar cotação no banco de dados.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Division Tabs */}
      <DivisaoTabs counts={divisaoCounts} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[#212121]">Pendentes de Aprovação</h2>
          {pendentes.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-primary text-white text-xs font-medium">
              {pendentes.length}
            </span>
          )}
        </div>
      </div>

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

      {/* Highlight Banner */}
      <div
        className="rounded-xl p-5 text-white shadow-md"
        style={{
          background: 'linear-gradient(90deg, #1e40af 0%, #2563eb 55%, #60a5fa 100%)',
        }}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-400/20 flex items-center justify-center flex-shrink-0">
            <Scale size={24} className="text-amber-400" />
          </div>
          <div>
            <p className="text-xl md:text-2xl font-bold">
              {formatAmount(totalPendente)} — {pendentes.length} {pendentes.length === 1 ? 'cotação' : 'cotações'} aguardando aprovação
            </p>
            <p className="text-sm text-white/70 mt-1">Cotações pendentes precisam de sua decisão</p>
          </div>
        </div>
      </div>

      {/* Table - Desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-black/[0.08] shadow-sm overflow-hidden">
        {pendentes.length === 0 ? (
          <div className="py-12 text-center text-[#757575]">
            <CheckCircle size={40} className="mx-auto mb-3 text-green-500" />
            <p className="text-sm font-medium">Nenhuma cotação pendente</p>
            <p className="text-xs mt-1">Todas as cotações foram analisadas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.08] bg-[#fafafa]">
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Fornecedor</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Produto</th>
                  <th className="text-right py-3 px-4 font-medium text-[#757575] text-xs uppercase">Qtd</th>
                  <th className="text-right py-3 px-4 font-medium text-[#757575] text-xs uppercase">Total</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Prazo</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pendentes.map(c => {
                  const total = totalDoPedido(c);
                  const isHighValue = total > 10000;
                  return (
                    <tr key={c.id} className="border-b border-black/[0.04] hover:bg-[#fafafa] transition-colors">
                      <td className="py-3 px-4 text-[#212121]">
                        <div className="flex items-center gap-2">
                          {c.fornecedor}
                          {isHighValue && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-400 text-[#212121]">
                              Alto Valor
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#212121] max-w-[250px] truncate" title={c.produtos?.map(p => p.produto).join(', ') || c.produto}>
                        {formatCotacaoProdutosDesc(c)}
                      </td>
                      <td className="py-3 px-4 text-right text-[#212121]">{formatCotacaoProdutosQtd(c)}</td>
                      <td className="py-3 px-4 text-right font-medium text-primary">{formatAmount(total)}</td>
                      <td className="py-3 px-4 text-[#757575]">{c.prazo}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setDetailModal(c)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#757575] hover:bg-[#f5f5f5] transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => handleApprove(c)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#e8f5e9] text-green-700 hover:bg-green-100 transition-colors"
                            title="Aprovar"
                            aria-label="Aprovar"
                          >
                            <CheckCircle size={17} />
                          </button>
                          <button
                            onClick={() => { setRejectModal(c); setRejectReason(''); setRejectError(''); }}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#ffebee] text-red-700 hover:bg-red-100 transition-colors"
                            title="Rejeitar"
                            aria-label="Rejeitar"
                          >
                            <XCircle size={17} />
                          </button>
                        </div>
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
        {pendentes.length === 0 ? (
          <div className="bg-white rounded-xl border border-black/[0.08] p-8 text-center text-[#757575]">
            <CheckCircle size={40} className="mx-auto mb-3 text-green-500" />
            <p className="text-sm font-medium">Nenhuma cotação pendente</p>
          </div>
        ) : (
          pendentes.map(c => {
            const total = totalDoPedido(c);
            const isHighValue = total > 10000;
            return (
              <div key={c.id} className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#757575]">#{c.id}</span>
                  {isHighValue && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-400 text-[#212121]">
                      Alto Valor
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-[#212121]">{c.fornecedor}</p>
                <p className="text-xs text-[#757575] mb-2">{formatCotacaoProdutosDesc(c)}</p>
                <div className="flex items-center justify-between text-xs text-[#757575] mb-3">
                  <span>{formatCotacaoProdutosQtd(c)}</span>
                  <span>{c.prazo}</span>
                  <span className="font-semibold text-primary">{formatAmount(total)}</span>
                </div>
                <div className="flex items-center gap-2 pt-3 border-t border-black/[0.06]">
                  <button
                    onClick={() => setDetailModal(c)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#f5f5f5] text-[#212121] hover:bg-[#e8e8e8]"
                  >
                    <Eye size={13} /> Ver
                  </button>
                  <button
                    onClick={() => handleApprove(c)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#e8f5e9] text-green-700 hover:bg-green-100 font-semibold"
                  >
                    <CheckCircle size={13} /> Aprovar
                  </button>
                  <button
                    onClick={() => { setRejectModal(c); setRejectReason(''); setRejectError(''); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#ffebee] text-red-700 hover:bg-red-100 font-semibold"
                  >
                    <XCircle size={13} /> Rejeitar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Detail Modal */}
      {detailModal && (
        <DetalhesCotacaoModal
          cotacao={detailModal}
          onClose={() => setDetailModal(null)}
        />
      )}

      {/* Confirm Approval Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-[#212121] mb-2">Confirmar Aprovação</h3>
            <p className="text-sm text-[#757575] mb-1">
              Esta cotação tem valor acima de <strong>{formatCurrency(5000)}</strong>.
            </p>
            <p className="text-sm text-[#212121] font-medium mb-4">
              {confirmModal.fornecedor} — {formatAmount(totalDoPedido(confirmModal))}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-black/[0.08] text-sm font-medium text-[#212121] hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmApprove}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#2e7d32] text-white text-sm font-medium hover:bg-[#1b5e20]"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-[#212121] mb-1">Rejeitar Cotação #{rejectModal.id}</h3>
            <p className="text-sm text-[#757575] mb-4">{rejectModal.fornecedor} — {formatCotacaoProdutosDesc(rejectModal)}</p>

            <label className="text-sm font-medium text-[#212121] mb-1.5 block">
              Motivo da Rejeição <span className="text-red-500">*</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={e => {
                setRejectReason(e.target.value);
                if (e.target.value.trim().length >= 10) setRejectError('');
              }}
              placeholder="Informe o motivo da rejeição (mín. 10 caracteres)"
              rows={3}
              className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 resize-none ${
                rejectError ? 'border-red-400' : 'border-black/[0.08]'
              }`}
            />
            {rejectError && <p className="text-xs text-red-500 mt-1">{rejectError}</p>}

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => { setRejectModal(null); setRejectReason(''); setRejectError(''); }}
                className="flex-1 px-4 py-2.5 rounded-lg border border-black/[0.08] text-sm font-medium text-[#212121] hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || rejectReason.trim().length < 10}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#c62828] text-white text-sm font-medium hover:bg-[#b71c1c] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirmar Rejeição
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
