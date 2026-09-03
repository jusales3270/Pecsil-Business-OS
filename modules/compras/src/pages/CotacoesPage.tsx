import { useState, useMemo, useEffect } from 'react';
import { useStore, formatCurrency, isProductFullyPurchased, getStatusDisplay, calcularTotalPendente } from '@/store';
import type { Cotacao } from '@/types';
import {
  Plus,
  Search,
  FilterX,
  Eye,
  Pencil,
  Trash2,
  ShoppingCart,
  Calendar,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import CotacaoModal from '@/components/CotacaoModal';
import DetalhesCotacaoModal from '@/components/DetalhesCotacaoModal';
import CompraModal from '@/components/CompraModal';
import DivisaoTabs from '@/components/DivisaoTabs';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'PENDENTE', label: 'Pendente' },
  { value: 'APROVADO', label: 'Aprovado' },
  { value: 'REJEITADO', label: 'Rejeitado' },
  { value: 'COMPRADO', label: 'Comprado' },
];

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

const calcularTotalProdutos = (prods: any[], cotacaoId?: number, compras?: any[], pendingOnly?: boolean) => {
  return prods.reduce((sum, p) => {
    // In pendingOnly mode, skip non-pending items
    if (pendingOnly && p.status && p.status !== 'PENDENTE') return sum;
    // Skip purchased products when cotacaoId and compras are provided
    if (cotacaoId && compras && p.produto && isProductFullyPurchased(p.produto, p.quantidade, cotacaoId, compras)) return sum;
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

const formatProdutosQtd = (prods: any[], cotacaoId?: number, compras?: any[]) => {
  if (prods.length > 1) {
    // Count only non-purchased items
    const remaining = cotacaoId && compras
      ? prods.filter(p => !p.produto || !isProductFullyPurchased(p.produto, p.quantidade, cotacaoId, compras))
      : prods;
    const purchased = prods.length - remaining.length;
    if (purchased > 0) {
      return `${remaining.length} restante${remaining.length !== 1 ? 's' : ''} / ${prods.length} itens`;
    }
    return `${prods.length} itens`;
  }
  return prods[0] ? `${prods[0].quantidade} ${prods[0].unidade}` : '0 un';
};

export default function CotacoesPage() {
  const { user, cotacoes, compras, deleteCotacao, currentDivisao, dashboardAction, setDashboardAction, revertCotacaoParaPendente, activeCotacaoIdForModal, setActiveCotacaoIdForModal } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPageNum] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCotacao, setEditingCotacao] = useState<Cotacao | null>(null);
  const [detailModal, setDetailModal] = useState<Cotacao | null>(null);
  const [compraModal, setCompraModal] = useState<Cotacao | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Cotacao | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (activeCotacaoIdForModal) {
      const found = cotacoes.find(c => c.id === activeCotacaoIdForModal);
      if (found) {
        setDetailModal(found);
      }
      setActiveCotacaoIdForModal(null);
    }
  }, [activeCotacaoIdForModal, setActiveCotacaoIdForModal, cotacoes]);

  useEffect(() => {
    if (dashboardAction) {
      const found = cotacoes.find(c => c.id === dashboardAction.cotacaoId);
      if (found) {
        if (dashboardAction.type === 'VIEW') {
          setDetailModal(found);
        } else if (dashboardAction.type === 'EDIT') {
          // Open edit modal directly
          setEditingCotacao(found);
          setModalOpen(true);
        } else if (dashboardAction.type === 'DELETE') {
          setDeleteConfirm(found);
        }
      }
      setDashboardAction(null);
    }
  }, [dashboardAction, setDashboardAction, cotacoes]);

  const itemsPerPage = 20;

  const filtered = cotacoes
    .filter(c => {
      if (!user) return false;
      if (c.userId !== user.id) return false;
      if (c.deletedAt !== null) return false;
      if (c.divisao !== currentDivisao) return false;
      if (statusFilter) {
        if (statusFilter === 'REJEITADO') {
          const hasRejectedProduct = c.produtos && c.produtos.length > 0 && c.produtos.some(p => p.status === 'REJEITADO');
          if (c.status !== 'REJEITADO' && !hasRejectedProduct) return false;
        } else if (statusFilter === 'APROVADO') {
          const hasApprovedProduct = c.produtos && c.produtos.length > 0 && c.produtos.some(p => p.status === 'APROVADO');
          if (c.status !== 'APROVADO' && !(c.status === 'PENDENTE' && hasApprovedProduct)) return false;
        } else if (statusFilter === 'PENDENTE') {
          const hasApprovedProduct = c.produtos && c.produtos.length > 0 && c.produtos.some(p => p.status === 'APROVADO');
          if (c.status !== 'PENDENTE' || hasApprovedProduct) return false;
        } else {
          if (c.status !== statusFilter) return false;
        }
      }
      if (dateFrom) {
        const from = new Date(dateFrom + 'T00:00:00');
        if (new Date(c.createdAt) < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo + 'T23:59:59');
        if (new Date(c.createdAt) > to) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const matchesSupplier = c.fornecedor.toLowerCase().includes(s);
        const matchesProducts = c.produtos && c.produtos.length > 0
          ? c.produtos.some(p => p.produto.toLowerCase().includes(s))
          : (c.produto?.toLowerCase().includes(s) || false);
        return matchesSupplier || matchesProducts;
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Counts for the division tabs
  const divisaoCounts = useMemo(() => {
    if (!user) return { USINAGEM: 0, FUNDICAO: 0 };
    const userCotacoes = cotacoes.filter(c => c.userId === user.id && c.deletedAt === null);
    return {
      USINAGEM: userCotacoes.filter(c => c.divisao === 'USINAGEM').length,
      FUNDICAO: userCotacoes.filter(c => c.divisao === 'FUNDICAO').length,
    };
  }, [user, cotacoes]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const handleDelete = async (cotacao: Cotacao) => {
    try {
      await deleteCotacao(cotacao.id);
      setDeleteConfirm(null);
      toast.success(`Cotação #${cotacao.id} excluída com sucesso!`);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir cotação no banco de dados.');
    }
  };

  const handleEdit = (cotacao: Cotacao) => {
    setEditingCotacao(cotacao);
    setModalOpen(true);
  };

  const handleComprar = (cotacao: Cotacao) => {
    const hasApprovedProducts = cotacao.produtos && cotacao.produtos.some(p => p.status === 'APROVADO');
    if (cotacao.status !== 'APROVADO' && !hasApprovedProducts) {
      toast.error('Apenas cotações com itens APROVADOS podem ser compradas.');
      return;
    }
    setCompraModal(cotacao);
  };

  const handleRevert = async (cotacao: Cotacao) => {
    if (confirm(`Tem certeza que deseja reverter a cotação #${cotacao.id} para a aprovação dos gestores?`)) {
      try {
        await revertCotacaoParaPendente(cotacao.id);
        toast.success(`Cotação #${cotacao.id} enviada de volta para aprovação!`);
      } catch (err) {
        console.error(err);
        toast.error('Erro ao reverter cotação.');
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Division Tabs */}
      <DivisaoTabs counts={divisaoCounts} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#212121]">Minhas Cotações</h2>
        <button
          onClick={() => { setEditingCotacao(null); setModalOpen(true); }}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors active:scale-[0.98]"
        >
          <Plus size={16} />
          Nova Cotação
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575]" />
          <input
            type="text"
            placeholder="Buscar por fornecedor ou produto..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPageNum(1); }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-black/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPageNum(1); }}
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
              onChange={e => { setDateFrom(e.target.value); setPageNum(1); }}
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
              onChange={e => { setDateTo(e.target.value); setPageNum(1); }}
              className="pl-8 pr-2 py-2 rounded-lg border border-black/[0.08] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              title="Data final"
            />
          </div>
        </div>
        {(search || statusFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter(''); setDateFrom(''); setDateTo(''); setPageNum(1); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-black/[0.08] text-sm text-[#757575] hover:bg-gray-50 transition-colors"
          >
            <FilterX size={14} />
            Limpar
          </button>
        )}
      </div>

      {/* Table - Desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-black/[0.08] shadow-sm overflow-hidden">
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
                <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#757575]">
                    Nenhuma cotação encontrada
                  </td>
                </tr>
              ) : (
                paginated.map(c => (
                  <tr key={c.id} className="border-b border-black/[0.04] hover:bg-[#fafafa] transition-colors">
                    <td className="py-3 px-4 font-medium text-[#212121]">#{c.id}</td>
                    <td className="py-3 px-4 text-[#212121] max-w-[180px] truncate">{c.fornecedor}</td>
                    <td className="py-3 px-4 text-[#212121] max-w-[220px] truncate" title={getFilteredProdutos(c, statusFilter).map(p => p.produto).join(', ')}>
                      {formatProdutosDesc(getFilteredProdutos(c, statusFilter))}
                    </td>
                    <td className="py-3 px-4 text-right text-[#212121]">{formatProdutosQtd(getFilteredProdutos(c, statusFilter), c.id, c.status !== 'COMPRADO' ? compras : undefined)}</td>
                    <td className="py-3 px-4 text-right font-medium text-primary">
                      {formatCurrency(
                        c.status === 'COMPRADO'
                          ? calcularTotalProdutos(getFilteredProdutos(c, statusFilter))
                          : calcularTotalPendente(c)
                      )}
                    </td>
                    <td className="py-3 px-4"><StatusBadge cotacao={c} compras={compras} /></td>
                    <td className="py-3 px-4 font-medium text-primary">
                      <div className="flex items-center gap-1">
                        <IconButton icon={<Eye size={14} />} onClick={() => setDetailModal(c)} title="Ver detalhes" />
                        <IconButton icon={<Pencil size={14} />} onClick={() => handleEdit(c)} title="Editar" />
                        <IconButton icon={<Trash2 size={14} />} onClick={() => setDeleteConfirm(c)} title="Excluir" danger />
                        {(c.status === 'APROVADO' || (c.status === 'PENDENTE' && c.produtos && c.produtos.some(p => p.status === 'APROVADO'))) && (
                          <>
                            <IconButton icon={<ShoppingCart size={14} />} onClick={() => handleComprar(c)} title="Comprar" primary />
                            <IconButton icon={<RotateCcw size={14} />} onClick={() => handleRevert(c)} title="Reverter para aprovação" />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.08]">
            <span className="text-xs text-[#757575]">
              Mostrando {(page - 1) * itemsPerPage + 1}-{Math.min(page * itemsPerPage, filtered.length)} de {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPageNum(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1.5 rounded text-sm border border-black/[0.08] disabled:opacity-40 hover:bg-gray-50"
              >
                Anterior
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setPageNum(i + 1)}
                  className={`w-8 h-8 rounded text-sm font-medium transition-colors ${
                    page === i + 1 ? 'bg-primary text-white' : 'hover:bg-gray-50'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => setPageNum(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1.5 rounded text-sm border border-black/[0.08] disabled:opacity-40 hover:bg-gray-50"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {paginated.length === 0 ? (
          <div className="bg-white rounded-xl border border-black/[0.08] p-8 text-center text-[#757575]">
            Nenhuma cotação encontrada
          </div>
        ) : (
          paginated.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[#212121]">#{c.id}</span>
                <StatusBadge cotacao={c} compras={compras} />
              </div>
              <p className="text-sm text-[#212121] font-medium mb-0.5">{c.fornecedor}</p>
              <p className="text-xs text-[#757575] mb-2">{formatProdutosDesc(getFilteredProdutos(c, statusFilter))}</p>
              <div className="flex items-center justify-between text-xs text-[#757575] mb-3">
                <span>{formatProdutosQtd(getFilteredProdutos(c, statusFilter), c.id, c.status !== 'COMPRADO' ? compras : undefined)}</span>
                <span className="font-semibold text-primary">
                  {formatCurrency(
                    c.status === 'COMPRADO'
                      ? calcularTotalProdutos(getFilteredProdutos(c, statusFilter))
                      : calcularTotalPendente(c)
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-black/[0.06]">
                <button
                  onClick={() => setDetailModal(c)}
                  className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-[#f5f5f5] text-[#212121] hover:bg-[#e8e8e8] transition-colors"
                >
                  <Eye size={13} /> Ver
                </button>
                <button
                  onClick={() => handleEdit(c)}
                  className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-[#e8eaf6] text-primary hover:bg-[#c5cae9] transition-colors"
                >
                  <Pencil size={13} /> Editar
                </button>
                <button
                  onClick={() => setDeleteConfirm(c)}
                  className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-[#ffebee] text-[#c62828] hover:bg-[#ffcdd2] transition-colors"
                >
                  <Trash2 size={13} /> Excluir
                </button>
                {(c.status === 'APROVADO' || (c.status === 'PENDENTE' && c.produtos && c.produtos.some(p => p.status === 'APROVADO'))) && (
                  <>
                    <button
                      onClick={() => handleComprar(c)}
                      className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-[#e8f5e9] text-[#2e7d32] hover:bg-[#c8e6c9] transition-colors"
                    >
                      <ShoppingCart size={13} /> Comprar
                    </button>
                    <button
                      onClick={() => handleRevert(c)}
                      className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                    >
                      <RotateCcw size={13} /> Reverter
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modals */}
      {modalOpen && (
        <CotacaoModal
          cotacao={editingCotacao}
          onClose={() => { setModalOpen(false); setEditingCotacao(null); }}
        />
      )}

      {detailModal && (
        <DetalhesCotacaoModal
          cotacao={detailModal}
          onClose={() => setDetailModal(null)}
          onComprar={(detailModal.status === 'APROVADO' || (detailModal.produtos && detailModal.produtos.some(p => p.status === 'APROVADO'))) ? () => { setDetailModal(null); setCompraModal(detailModal); } : undefined}
          onlyRejected={statusFilter === 'REJEITADO'}
        />
      )}

      {compraModal && (
        <CompraModal
          cotacao={compraModal}
          onClose={() => setCompraModal(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-[#212121] mb-2">Confirmar exclusão</h3>
            <p className="text-sm text-[#757575] mb-1">
              Tem certeza que deseja excluir a cotação <strong>#{deleteConfirm.id}</strong>?
            </p>
            <p className="text-sm text-[#212121] font-medium mb-4">
              {deleteConfirm.fornecedor} — {formatProdutosDesc(getFilteredProdutos(deleteConfirm, statusFilter))}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-black/[0.08] text-sm font-medium text-[#212121] hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#c62828] text-white text-sm font-medium hover:bg-[#b71c1c] transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ cotacao, compras }: { cotacao: Cotacao; compras?: any[] }) {
  const display = getStatusDisplay(cotacao, compras);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${display.bg} ${display.text}`}>
      {display.label}
    </span>
  );
}

function IconButton({ icon, onClick, title, danger, primary }: {
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
        danger
          ? 'text-[#c62828] hover:bg-[#ffebee]'
          : primary
          ? 'text-[#2e7d32] hover:bg-[#e8f5e9]'
          : 'text-[#757575] hover:bg-[#f5f5f5]'
      }`}
    >
      {icon}
    </button>
  );
}
