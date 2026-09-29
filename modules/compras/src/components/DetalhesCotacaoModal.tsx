import { useState } from 'react';
import { useStore, formatAmount, formatUnitPrice, formatDate, formatDateTime, isProductFullyPurchased, calcularTotalRestante, getStatusDisplay, calcularTotalPendente } from '@/store';
import type { Cotacao, StatusProduto } from '@/types';
import { X, ShoppingCart, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import CompraModal from './CompraModal';

interface Props {
  cotacao: Cotacao;
  onClose: () => void;
  onComprar?: () => void;
  onlyRejected?: boolean;
}

export default function DetalhesCotacaoModal({ cotacao, onClose, onComprar, onlyRejected }: Props) {
  const caps = useStore((state) => state.caps);
  const { user, cotacoes, compras, decidirProduto, revertProdutoParaPendente } = useStore();
  const [compraItemId, setCompraItemId] = useState<string | null>(null);

  // Look up latest state from the store to ensure real-time reactive updates
  const currentCotacao = cotacoes.find(c => c.id === cotacao.id) || cotacao;

  const sc = getStatusDisplay(currentCotacao, compras);

  const getTotals = () => {
    let bruto = 0;
    let icms = 0;
    let ipi = 0;
    let total = 0;

    let list = currentCotacao.produtos && currentCotacao.produtos.length > 0
      ? currentCotacao.produtos
      : [{
          id: 'legacy-' + currentCotacao.id,
          produto: currentCotacao.produto || '',
          valorUnit: currentCotacao.valorUnit || 0,
          quantidade: currentCotacao.quantidade || 0,
          unidade: currentCotacao.unidade || 'kg',
          icms: currentCotacao.icms || 0,
          ipi: currentCotacao.ipi || 0,
          prazo: currentCotacao.prazo || 'À vista',
          obs: currentCotacao.obs || '',
          status: (currentCotacao.status === 'PENDENTE' ? 'PENDENTE' : (currentCotacao.status === 'REJEITADO' ? 'REJEITADO' : 'APROVADO')) as StatusProduto,
          motivoRejeicao: currentCotacao.motivoRejeicao || undefined,
        }];

    if (onlyRejected) {
      list = list.filter(p => p.status === 'REJEITADO');
    }

    list.forEach(p => {
      if (!onlyRejected && p.status === 'REJEITADO') return;
      const b = p.valorUnit * p.quantidade;
      const ic = b * (p.icms / 100);
      const ip = b * (p.ipi / 100);
      bruto += b;
      icms += ic;
      ipi += ip;
      total += (b + ip);
    });

    return { bruto, icms, ipi, total, list };
  };

  const { bruto, icms, ipi, total, list } = getTotals();
  const isAlreadyComprado = currentCotacao.status === 'COMPRADO';
  const totalRestante = isAlreadyComprado ? total : calcularTotalRestante(currentCotacao, compras);
  const hasPurchasedItems = !isAlreadyComprado && currentCotacao.produtos && currentCotacao.produtos.some(p => 
    p.status !== 'REJEITADO' && isProductFullyPurchased(p.produto, p.quantidade, currentCotacao.id, compras)
  );

  const handleDecidirItem = (produtoId: string, status: 'APROVADO' | 'REJEITADO') => {
    let motivo = '';
    if (status === 'REJEITADO') {
      const resp = prompt('Motivo da rejeição deste item (opcional):');
      if (resp === null) return;
      motivo = resp.trim();
    }
    decidirProduto(currentCotacao.id, produtoId, status, motivo);
    toast.success(`Item atualizado para ${status === 'APROVADO' ? 'APROVADO' : 'REJEITADO'}!`);
  };



  const handleRevertItem = async (produtoId: string) => {
    if (confirm('Tem certeza que deseja reverter este item específico para a aprovação dos gestores?')) {
      try {
        await revertProdutoParaPendente(currentCotacao.id, produtoId);
        toast.success('Item revertido para pendente com sucesso!');
      } catch (err) {
        console.error(err);
        toast.error('Erro ao reverter item.');
      }
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[620px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.08]">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[#212121]">Cotação #{currentCotacao.id}</h2>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${sc.bg} ${sc.text}`}>
              {sc.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#757575] hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <DetailItem label="Fornecedor" value={currentCotacao.fornecedor} />
            <DetailItem label="Divisão" value={currentCotacao.divisao === 'USINAGEM' ? 'Usinagem' : 'Fundição'} />
            <DetailItem label="Data de Criação" value={formatDate(currentCotacao.createdAt)} />
          </div>

          {/* Produtos List */}
          <div className="space-y-2 border-t border-black/[0.06] pt-4">
            <h3 className="text-xs font-semibold text-[#757575] uppercase tracking-wider mb-2">
              Produtos no Orçamento ({list.length})
            </h3>
            <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
              {list.map((p, idx) => {
                const itemBruto = p.valorUnit * p.quantidade;
                const itemTotal = itemBruto + itemBruto * (p.ipi / 100);
                  const isPending = !p.status || p.status === 'PENDENTE';
                const isRejected = p.status === 'REJEITADO';
                const isPurchased = !isAlreadyComprado && !isRejected && isProductFullyPurchased(p.produto, p.quantidade, currentCotacao.id, compras);

                return (
                  <div 
                    key={p.id || idx} 
                    className={`border rounded-lg p-3 space-y-2 transition-all ${
                      isPurchased
                        ? 'bg-blue-50/70 border-blue-200 opacity-75'
                        : isRejected 
                        ? 'bg-red-50/70 border-red-200 text-red-900 shadow-sm' 
                        : 'bg-slate-50 border-black/[0.06]'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-center gap-2">
                        <p className={`font-semibold text-xs ${isPurchased ? 'text-blue-700' : isRejected ? 'text-red-700' : 'text-[#212121]'}`}>
                          {idx + 1}. {p.produto}
                        </p>
                        {isPurchased && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                            <CheckCircle size={10} />
                            Comprado
                          </span>
                        )}
                      </div>
                      <span className={`font-bold text-xs flex-shrink-0 ${isPurchased ? 'text-blue-600 line-through' : isRejected ? 'text-red-600 line-through' : 'text-primary'}`}>
                        {formatAmount(itemTotal)}
                      </span>
                    </div>
                    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] ${isPurchased ? 'text-blue-700/80' : isRejected ? 'text-red-700/80' : 'text-[#757575]'}`}>
                      <div>Qtd: <strong className={isPurchased ? 'text-blue-900' : isRejected ? 'text-red-900' : 'text-[#212121]'}>{p.quantidade} {p.unidade}</strong></div>
                      <div>Unitário: <strong className={isPurchased ? 'text-blue-900' : isRejected ? 'text-red-900' : 'text-[#212121]'}>{formatUnitPrice(p.valorUnit)}</strong></div>
                      <div>ICMS: <strong className={isPurchased ? 'text-blue-900' : isRejected ? 'text-red-900' : 'text-[#212121]'}>{p.icms}%</strong></div>
                      <div>IPI: <strong className={isPurchased ? 'text-blue-900' : isRejected ? 'text-red-900' : 'text-[#212121]'}>{p.ipi}%</strong></div>
                    </div>
                    {p.prazo && (
                      <div className={`text-[11px] ${isRejected ? 'text-red-700/80' : 'text-[#757575]'}`}>
                        Prazo de Pagamento: <strong className={isRejected ? 'text-red-900' : 'text-[#212121]'}>{p.prazo}</strong>
                      </div>
                    )}
                    {p.obs && (
                      <div className={`text-[11px] border p-1.5 rounded ${isRejected ? 'bg-red-100/30 border-red-200 text-red-900' : 'bg-white border-black/[0.04] text-[#212121]'}`}>
                        Obs: {p.obs}
                      </div>
                    )}

                    {isPurchased && (
                      <div className="mt-1 bg-blue-100/50 border border-blue-200 rounded p-2 text-[10px] text-blue-800 font-medium flex items-center gap-1.5">
                        <CheckCircle size={12} className="text-blue-600 flex-shrink-0" />
                        Item já comprado — o valor de {formatAmount(itemTotal)} foi descontado do total restante desta cotação.
                      </div>
                    )}

                    {isRejected && (
                      <div className="mt-1 bg-red-100/50 border border-red-200 rounded p-2 text-[10px] text-red-800 font-medium">
                        ⚠️ **Item Rejeitado**: O valor de {formatAmount(itemTotal)} (impostos inclusos) foi **desconsiderado** do total geral deste orçamento.
                      </div>
                    )}

                    {/* Decisions display & approval buttons */}
                    <div className={`flex items-center justify-between pt-2 border-t mt-2 ${isRejected ? 'border-red-200' : 'border-black/[0.04]'}`}>
                      {isPending ? (
                        <>
                          <span className="text-[10px] text-amber-600 font-medium">Aguardando decisão</span>
                          {user?.role === 'GESTOR' && caps.aprovar && currentCotacao.status === 'PENDENTE' && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleDecidirItem(p.id, 'APROVADO')}
                                className="px-3 py-1.5 rounded-md bg-[#e8f5e9] text-green-700 border border-green-200 hover:bg-green-100 text-xs font-semibold transition-colors"
                              >
                                ✓ Aprovar Item
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDecidirItem(p.id, 'REJEITADO')}
                                className="px-3 py-1.5 rounded-md bg-[#ffebee] text-red-700 border border-red-200 hover:bg-red-100 text-xs font-semibold transition-colors"
                              >
                                ✗ Rejeitar Item
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${
                            p.status === 'APROVADO' 
                              ? 'bg-green-50 text-green-700 border border-green-200' 
                              : 'bg-red-100 text-red-700 border border-red-300'
                          }`}>
                            {p.status === 'APROVADO' ? 'Aprovado' : 'Rejeitado'}
                          </span>
                          {p.motivoRejeicao && (
                            <span className={`text-[10px] italic ${isRejected ? 'text-red-700' : 'text-[#757575]'}`}>
                              ({p.motivoRejeicao})
                            </span>
                          )}
                          {user?.role === 'ORCAMENTISTA' && caps.comprar && p.status === 'APROVADO' && !isPurchased && (currentCotacao.status === 'APROVADO' || (currentCotacao.status === 'PENDENTE' && currentCotacao.produtos && currentCotacao.produtos.some(item => item.status === 'APROVADO'))) && (
                            <button
                              type="button"
                              onClick={() => setCompraItemId(p.id)}
                              className="ml-1 px-2 py-0.5 rounded bg-[#e8f5e9] text-[#2e7d32] hover:bg-[#c8e6c9] text-[9px] font-semibold border border-green-200 transition-colors flex items-center gap-1"
                              title="Comprar este item"
                            >
                              <ShoppingCart size={10} />
                              Comprar
                            </button>
                          )}
                          {user?.role === 'ORCAMENTISTA' && caps.cotar && p.status === 'APROVADO' && (
                            <button
                              type="button"
                              onClick={() => handleRevertItem(p.id)}
                              className="ml-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 text-[9px] font-semibold border border-amber-200 transition-colors"
                              title="Reverter item para aprovação"
                            >
                              Reverter Item
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totais do Orçamento */}
          <div className="p-3 bg-[#f8f9fa] rounded-lg border border-black/[0.08]">
            <p className="text-xs text-[#757575] uppercase mb-1 font-semibold">Total Geral do Orçamento</p>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="text-[#757575]">Bruto: <strong className="text-[#212121]">{formatAmount(bruto)}</strong></span>
              <span className="text-[#757575]">ICMS: <strong className="text-[#212121]">{formatAmount(icms)}</strong></span>
              <span className="text-[#757575]">IPI: <strong className="text-[#212121]">{formatAmount(ipi)}</strong></span>
              <span className="text-lg font-bold text-primary ml-auto">{formatAmount(total)}</span>
            </div>
            {/* Total Pendente - when some items have been decided */}
            {(() => {
              const hasDecision = currentCotacao.produtos && currentCotacao.produtos.some(p => p.status === 'APROVADO' || p.status === 'REJEITADO');
              const totalPend = calcularTotalPendente(currentCotacao);
              if (hasDecision && currentCotacao.status !== 'COMPRADO') {
                return (
                  <div className="mt-2 pt-2 border-t border-black/[0.06] flex items-center justify-between">
                    <span className="text-xs text-amber-700 font-semibold uppercase flex items-center gap-1.5">
                      ⏳ Total Pendente (itens sem decisão)
                    </span>
                    <span className="text-lg font-bold text-amber-700">{formatAmount(totalPend)}</span>
                  </div>
                );
              }
              return null;
            })()}
            {hasPurchasedItems && (
              <div className="mt-2 pt-2 border-t border-black/[0.06] flex items-center justify-between">
                <span className="text-xs text-blue-700 font-semibold uppercase flex items-center gap-1.5">
                  <CheckCircle size={13} />
                  Total Restante (sem itens comprados)
                </span>
                <span className="text-lg font-bold text-blue-700">{formatAmount(totalRestante)}</span>
              </div>
            )}
          </div>

          {/* Decision History */}
          {currentCotacao.dataDecisao && (
            <div className="space-y-2 pt-2 border-t border-black/[0.06]">
              <p className="text-xs text-[#757575] uppercase font-medium">Histórico de Decisão</p>
              <div className="p-3 bg-[#f8f9fa] rounded-lg border border-black/[0.08]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <span className="text-[#757575]">Decidido por: <strong className="text-[#212121]">{currentCotacao.aprovadoPor}</strong></span>
                  <span className="text-[#757575]">Data: <strong className="text-[#212121]">{formatDateTime(currentCotacao.dataDecisao)}</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* Rejection reason */}
          {currentCotacao.motivoRejeicao && (
            <div className="p-3 bg-[#ffebee]/50 rounded-lg border border-[#c62828]/20">
              <p className="text-xs text-[#c62828] uppercase font-medium mb-1">Motivo da Rejeição (Geral)</p>
              <p className="text-xs text-[#c62828]">{currentCotacao.motivoRejeicao}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/[0.08]">

          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-black/[0.08] text-sm font-medium text-[#212121] hover:bg-gray-50 transition-colors"
          >
            Fechar
          </button>
          {onComprar && caps.comprar && user?.role === 'ORCAMENTISTA' && (currentCotacao.status === 'APROVADO' || (currentCotacao.status === 'PENDENTE' && currentCotacao.produtos && currentCotacao.produtos.some(p => p.status === 'APROVADO'))) && (
            <button
              onClick={onComprar}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#2e7d32] text-white text-sm font-medium hover:bg-[#1b5e20] transition-colors active:scale-[0.98]"
            >
              <ShoppingCart size={16} />
              Comprar
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // If purchasing a single item, show CompraModal for that item
  if (compraItemId) {
    return (
      <CompraModal
        cotacao={currentCotacao}
        onClose={() => setCompraItemId(null)}
        singleProductId={compraItemId}
      />
    );
  }

  return modalContent;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[#757575] uppercase mb-0.5">{label}</p>
      <p className="text-xs font-semibold text-[#212121] truncate">{value}</p>
    </div>
  );
}
