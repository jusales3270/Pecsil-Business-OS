import { useState } from 'react';
import { useStore, calcularTotal, formatCurrency, formatCurrencyInput, parseCurrencyInput, isProductFullyPurchased } from '@/store';
import type { Cotacao } from '@/types';
import { X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  cotacao: Cotacao;
  onClose: () => void;
  singleProductId?: string;
}

interface PurchaseItem {
  id: string;
  produto: string;
  unidade: string;
  quantidadeAprovada: number;
  valorUnitAprovado: number;
  quantidadeComprada: string;
  valorUnitFinal: string;
  selected: boolean;
}

export default function CompraModal({ cotacao, onClose, singleProductId }: Props) {
  const { comprarCotacao, compras } = useStore();

  const [nf, setNf] = useState('');
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().split('T')[0]);
  const [obs, setObs] = useState('');

  // Normalize products to a list of items for batch input
  const allApprovedProducts = (cotacao.produtos && cotacao.produtos.length > 0
    ? cotacao.produtos.filter(p => !p.status || p.status === 'APROVADO')
    : [{
        id: 'legacy-' + cotacao.id,
        produto: cotacao.produto || '',
        unidade: cotacao.unidade || 'kg',
        quantidade: cotacao.quantidade || 0,
        valorUnit: cotacao.valorUnit || 0,
      }]
  );

  // If a single product ID is specified, filter to only that item
  // Also filter out products that have already been fully purchased
  const filteredProducts = (singleProductId
    ? allApprovedProducts.filter(p => String(p.id) === String(singleProductId))
    : allApprovedProducts
  ).filter(p => !isProductFullyPurchased(p.produto, p.quantidade, cotacao.id, compras));

  const initialItems: PurchaseItem[] = filteredProducts.map(p => ({
    id: p.id || String(Math.random()),
    produto: p.produto,
    unidade: p.unidade,
    quantidadeAprovada: p.quantidade,
    valorUnitAprovado: p.valorUnit,
    quantidadeComprada: String(p.quantidade),
    valorUnitFinal: formatCurrencyInput(String((p.valorUnit * 100).toFixed(0))),
    selected: true,
  }));

  const [items, setItems] = useState<PurchaseItem[]>(initialItems);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleToggleSelect = (id: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item));
  };

  const handleUpdateItem = (id: string, field: 'quantidadeComprada' | 'valorUnitFinal', value: string) => {
    const updatedValue = field === 'valorUnitFinal' ? formatCurrencyInput(value) : value;
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: updatedValue } : item));
    // Clear error for this item
    if (errors[id]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // Calculate totals
  const overallTotalAprovado = calcularTotal(cotacao);
  
  const overallTotalCalculado = items
    .filter(item => item.selected)
    .reduce((sum, item) => {
      const q = parseFloat(item.quantidadeComprada) || 0;
      const v = parseCurrencyInput(item.valorUnitFinal) || 0;
      return sum + (q * v);
    }, 0);

  const handleSubmit = async () => {
    const selectedItems = items.filter(item => item.selected);
    if (selectedItems.length === 0) {
      toast.error('Selecione pelo menos um produto para comprar.');
      return;
    }

    if (!dataCompra) {
      toast.error('Informe a data da compra.');
      return;
    }

    // Validation
    const validationErrors: Record<string, string> = {};
    let hasError = false;

    selectedItems.forEach(item => {
      const qty = parseFloat(item.quantidadeComprada);
      if (isNaN(qty) || qty <= 0) {
        validationErrors[item.id] = 'Qtd inválida';
        hasError = true;
      } else if (qty > item.quantidadeAprovada) {
        validationErrors[item.id] = `Máx: ${item.quantidadeAprovada}`;
        hasError = true;
      }

      const val = parseCurrencyInput(item.valorUnitFinal);
      if (isNaN(val) || val < 0) {
        validationErrors[item.id] = 'Preço inválido';
        hasError = true;
      }
    });

    if (hasError) {
      setErrors(validationErrors);
      toast.error('Existem erros nos itens selecionados.');
      return;
    }

    try {
      // Save purchase for each selected item
      await Promise.all(selectedItems.map(async (item) => {
        const qty = parseFloat(item.quantidadeComprada);
        const val = parseCurrencyInput(item.valorUnitFinal);
        const totalItem = parseFloat((qty * val).toFixed(2));

        await comprarCotacao(cotacao.id, {
          fornecedor: cotacao.fornecedor,
          produto: item.produto,
          quantidade: qty,
          unidade: item.unidade,
          valorUnit: val,
          total: totalItem,
          nf: nf || null,
          dataCompra: new Date(dataCompra + 'T12:00:00').toISOString(),
          obs: obs || null,
        });
      }));

      toast.success(`Compra(s) registrada(s)! Total: ${formatCurrency(overallTotalCalculado)}`);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao registrar a compra no banco de dados.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[620px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.08]">
          <h2 className="text-lg font-semibold text-[#212121]">Registrar Compra — Cotação #{cotacao.id}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#757575] hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Info Banner */}
          <div className="p-3 bg-[#f8f9fa] rounded-lg border border-black/[0.08] text-xs flex justify-between items-center flex-wrap gap-2">
            <div>
              <span className="text-[#757575]">Fornecedor:</span>{' '}
              <span className="font-semibold text-[#212121]">{cotacao.fornecedor}</span>
            </div>
            <div>
              <span className="text-[#757575]">Total Aprovado:</span>{' '}
              <span className="font-bold text-primary">{formatCurrency(overallTotalAprovado)}</span>
            </div>
          </div>

          {/* Common Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="text-xs font-semibold text-[#212121] mb-1.5 block">Número da NF</label>
              <input
                type="text"
                value={nf}
                onChange={e => setNf(e.target.value)}
                placeholder="Número da nota fiscal"
                className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#212121] mb-1.5 block">
                Data da Compra <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={dataCompra}
                onChange={e => setDataCompra(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
              />
            </div>
          </div>

          {/* Products List for Purchase */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold text-[#212121] uppercase tracking-wider block">
              Produtos a Adquirir
            </label>
            <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
              {items.map(item => {
                const itemQty = parseFloat(item.quantidadeComprada) || 0;
                const itemPrice = parseCurrencyInput(item.valorUnitFinal) || 0;
                const itemSubtotal = itemQty * itemPrice;
                const errorText = errors[item.id];

                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border transition-all ${
                      item.selected
                        ? 'border-green-300 bg-green-50/20'
                        : 'border-black/[0.06] bg-slate-50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => handleToggleSelect(item.id)}
                        className="w-4 h-4 text-primary border-black/[0.12] rounded focus:ring-primary focus:ring-offset-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs text-[#212121] truncate">{item.produto}</p>
                        <p className="text-[10px] text-[#757575] mt-0.5">
                          Aprovado: {item.quantidadeAprovada} {item.unidade} &times;{' '}
                          {formatCurrency(item.valorUnitAprovado)}
                        </p>
                      </div>
                      <div className="text-right text-xs font-bold text-[#212121] flex-shrink-0">
                        {formatCurrency(itemSubtotal)}
                      </div>
                    </div>

                    {item.selected && (
                      <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-black/[0.04] animate-in fade-in duration-100">
                        <div>
                          <label className="text-[10px] font-semibold text-[#757575] mb-1 block">
                            Qtd Comprada ({item.unidade})
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            max={item.quantidadeAprovada}
                            value={item.quantidadeComprada}
                            onChange={e => handleUpdateItem(item.id, 'quantidadeComprada', e.target.value)}
                            className={`w-full px-2.5 py-1.5 rounded border text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                              errorText && errorText.includes('Qtd')
                                ? 'border-red-400 focus:border-red-400'
                                : 'border-black/[0.08] focus:border-primary'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-[#757575] mb-1 block">
                            Preço Unitário Final (R$)
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={item.valorUnitFinal}
                            onChange={e => handleUpdateItem(item.id, 'valorUnitFinal', e.target.value)}
                            className={`w-full px-2.5 py-1.5 rounded border text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                              errorText && errorText.includes('Preço')
                                ? 'border-red-400 focus:border-red-400'
                                : 'border-black/[0.08] focus:border-primary'
                            }`}
                          />
                        </div>
                        {errorText && (
                          <div className="col-span-2 flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
                            <p className="text-[10px] text-red-500">{errorText}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Observations */}
          <div>
            <label className="text-xs font-semibold text-[#212121] mb-1.5 block">Observações da Compra</label>
            <textarea
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder="Observações adicionais para este registro de compra"
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none bg-white"
            />
          </div>

          {/* Total Preview */}
          <div className="p-3 bg-[#e8f5e9]/30 rounded-lg border border-[#2e7d32]/20 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#2e7d32] uppercase">Total da Compra</span>
            <span className="text-lg font-bold text-primary">{formatCurrency(overallTotalCalculado)}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/[0.08]">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-black/[0.08] text-sm font-medium text-[#212121] hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors active:scale-[0.98]"
          >
            Confirmar Compra
          </button>
        </div>
      </div>
    </div>
  );
}
