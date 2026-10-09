import { useState, useEffect, useMemo } from 'react';
import { useStore, formatAmount, formatUnitPrice, formatCurrencyInput, normalizeCurrencyInput, parseCurrencyInput } from '@/store';
import type { Cotacao, Divisao, CotacaoProduto, PedidoMaterial, FreteTipo } from '@/types';
import { X, Cog, Flame, Plus, Trash2, Edit, Lock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import SugestaoInput from '@/components/SugestaoInput';
import { useSugestoesCompras } from '@/hooks/useSugestoesCompras';

interface Props {
  cotacao: Cotacao | null;
  onClose: () => void;
  /** Cotação nascendo de um pedido do Almoxarifado: itens à mão e o vínculo gravado. */
  pedido?: PedidoMaterial | null;
}

const UNIDADES = ['kg', 'un', 'l', 'm', 'cx', 'ton'];

export default function CotacaoModal({ cotacao, onClose, pedido = null }: Props) {
  const { user, addCotacao, updateCotacao, currentDivisao } = useStore();
  const { fornecedores: sugestoesFornecedor, supplierIdPorNome, produtosPara } = useSugestoesCompras();

  const [fornecedor, setFornecedor] = useState('');
  const [divisao, setDivisao] = useState<Divisao>(
    pedido && (pedido.divisao === 'USINAGEM' || pedido.divisao === 'FUNDICAO') ? pedido.divisao : (currentDivisao as Divisao),
  );
  // Produtos já comprados deste fornecedor aparecem primeiro nas sugestões.
  const sugestoesProduto = useMemo(() => produtosPara(supplierIdPorNome(fornecedor)), [produtosPara, supplierIdPorNome, fornecedor]);
  const [produtos, setProdutos] = useState<CotacaoProduto[]>([]);
  // Approved/purchased items are stored separately and shown as read-only
  const [approvedProdutos, setApprovedProdutos] = useState<CotacaoProduto[]>([]);

  // Product draft form
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState({
    produto: '',
    valorUnit: '',
    quantidade: '',
    unidade: 'kg',
    icms: '0',
    ipi: '0',
    prazo: '',
    obs: '',
  });
  const [productErrors, setProductErrors] = useState<Record<string, string>>({});
  // Dados do pedido que saem na Ordem de Compra.
  const [pedidoOc, setPedidoOc] = useState({ freteTipo: 'CIF' as FreteTipo, freteValor: '', seguroValor: '', outrasDespesas: '', prazoEntrega: '', observacao: '' });
  const valorCampo = (v?: number) => (v ? normalizeCurrencyInput(String(v)) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (cotacao) {
      setFornecedor(cotacao.fornecedor);
      setDivisao(cotacao.divisao);
      setPedidoOc({
        freteTipo: cotacao.freteTipo ?? 'CIF',
        freteValor: valorCampo(cotacao.freteValor),
        seguroValor: valorCampo(cotacao.seguroValor),
        outrasDespesas: valorCampo(cotacao.outrasDespesas),
        prazoEntrega: cotacao.prazoEntrega ?? '',
        observacao: cotacao.observacao ?? '',
      });
      if (cotacao.produtos && cotacao.produtos.length > 0) {
        // Separate approved/purchased items (read-only) from editable items
        const approved = cotacao.produtos.filter(p => p.status === 'APROVADO');
        const editable = cotacao.produtos.filter(p => p.status !== 'APROVADO');
        setApprovedProdutos(approved);
        setProdutos(editable);
      } else if (cotacao.produto) {
        // Fallback backward compatibility
        setApprovedProdutos([]);
        setProdutos([
          {
            id: 'legacy-' + cotacao.id,
            produto: cotacao.produto,
            valorUnit: cotacao.valorUnit || 0,
            quantidade: cotacao.quantidade || 0,
            unidade: cotacao.unidade || 'kg',
            icms: cotacao.icms || 0,
            ipi: cotacao.ipi || 0,
            prazo: cotacao.prazo || 'À vista',
            obs: cotacao.obs || '',
          },
        ]);
      }
    }
  }, [cotacao]);

  const handleNewProductClick = () => {
    setEditingProductId('new-' + Date.now());
    setProductForm({
      produto: '',
      valorUnit: '',
      quantidade: '',
      unidade: 'un',
      icms: '0',
      ipi: '0',
      prazo: '',
      obs: '',
    });
    setProductErrors({});
  };

  // Item do pedido do Almoxarifado: abre o formulário já com produto, quantidade e unidade.
  const cotarItemDoPedido = (item: PedidoMaterial['itens'][number]) => {
    setEditingProductId(`new-pedido-${pedido?.itens.indexOf(item) ?? 0}-${produtos.length}`);
    setProductForm({
      produto: item.produto,
      valorUnit: '',
      quantidade: String(item.quantidade),
      unidade: UNIDADES.includes(item.unidade.toLowerCase()) ? item.unidade.toLowerCase() : 'un',
      icms: '0',
      ipi: '0',
      prazo: '',
      obs: item.observacao ?? '',
    });
    setProductErrors({});
  };
  const jaNoOrcamento = (produto: string) => produtos.some((p) => p.produto.trim().toLowerCase() === produto.trim().toLowerCase());

  const handleEditProductClick = (p: CotacaoProduto) => {
    setEditingProductId(p.id);
    setProductForm({
      produto: p.produto,
      valorUnit: normalizeCurrencyInput(String(p.valorUnit || 0)),
      quantidade: String(p.quantidade),
      unidade: p.unidade,
      icms: String(p.icms),
      ipi: String(p.ipi),
      prazo: p.prazo,
      obs: p.obs,
    });
    setProductErrors({});
  };

  const handleDeleteProduct = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering edit
    setProdutos(prev => prev.filter(p => p.id !== id));
    if (editingProductId === id) {
      setEditingProductId(null);
    }
    toast.success('Produto removido do orçamento.');
  };

  const validateProduct = () => {
    const e: Record<string, string> = {};
    if (!productForm.produto.trim()) e.produto = 'Produto é obrigatório';
    else if (productForm.produto.length > 300) e.produto = 'Máximo 300 caracteres';

    const vUnit = parseCurrencyInput(productForm.valorUnit);
    if (!productForm.valorUnit || isNaN(vUnit) || vUnit <= 0) {
      e.valorUnit = 'Deve ser maior que 0';
    }

    const qty = parseFloat(productForm.quantidade);
    if (!productForm.quantidade || isNaN(qty) || qty <= 0) {
      e.quantidade = 'Deve ser maior que 0';
    }

    if (!productForm.prazo.trim()) {
      e.prazo = 'Prazo de pagamento é obrigatório';
    }

    setProductErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSaveProduct = () => {
    if (!validateProduct()) return;
    if (!editingProductId) return;

    const newProd: CotacaoProduto = {
      id: editingProductId.startsWith('new-') ? 'prod-' + Date.now() : editingProductId,
      produto: productForm.produto.trim(),
      valorUnit: parseCurrencyInput(productForm.valorUnit),
      quantidade: parseFloat(productForm.quantidade),
      unidade: productForm.unidade,
      icms: parseFloat(productForm.icms) || 0,
      ipi: parseFloat(productForm.ipi) || 0,
      prazo: productForm.prazo,
      obs: productForm.obs.trim(),
    };

    setProdutos(prev => {
      const exists = prev.some(p => p.id === newProd.id);
      if (exists) {
        return prev.map(p => (p.id === newProd.id ? newProd : p));
      } else {
        return [...prev, newProd];
      }
    });

    setEditingProductId(null);
    toast.success('Produto salvo com sucesso!');
  };

  // Overall totals
  const calcOverallTotals = () => {
    let bruto = 0;
    let icms = 0;
    let ipi = 0;
    let total = 0;

    produtos.forEach(p => {
      const b = p.valorUnit * p.quantidade;
      const ic = b * (p.icms / 100);
      const ip = b * (p.ipi / 100);
      bruto += b;
      icms += ic;
      ipi += ip;
      total += (b + ip);
    });

    return { bruto, icms, ipi, total };
  };

  const bd = calcOverallTotals();
  const despesas = ['freteValor', 'seguroValor', 'outrasDespesas'].reduce((soma, k) => soma + (parseCurrencyInput(pedidoOc[k as 'freteValor']) || 0), 0);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fornecedor.trim()) e.fornecedor = 'Fornecedor é obrigatório';
    else if (fornecedor.length > 200) e.fornecedor = 'Máximo 200 caracteres';

    if (produtos.length === 0) {
      e.produtos = 'Adicione pelo menos um produto ao orçamento';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      if (errors.produtos || produtos.length === 0) {
        toast.error('Adicione pelo menos um produto.');
      } else {
        toast.error('Preencha os campos obrigatórios.');
      }
      return;
    }
    if (!user) return;

    // We maintain first product fields on root for legacy DB/backward compatibility
    const firstP = produtos[0];
    const data = {
      fornecedor: fornecedor.trim(),
      divisao,
      produtos,
      materialRequestId: pedido?.id ?? cotacao?.materialRequestId ?? null,
      freteTipo: pedidoOc.freteTipo,
      freteValor: parseCurrencyInput(pedidoOc.freteValor) || 0,
      seguroValor: parseCurrencyInput(pedidoOc.seguroValor) || 0,
      outrasDespesas: parseCurrencyInput(pedidoOc.outrasDespesas) || 0,
      prazoEntrega: pedidoOc.prazoEntrega || null,
      observacao: pedidoOc.observacao.trim() || null,
      // Legacy fields
      produto: firstP.produto,
      valorUnit: firstP.valorUnit,
      quantidade: firstP.quantidade,
      unidade: firstP.unidade,
      icms: firstP.icms,
      ipi: firstP.ipi,
      prazo: firstP.prazo,
      obs: firstP.obs,
      userId: user.id,
    };

    try {
      if (cotacao) {
        // Merge approved items (preserved as-is) with editable items
        // approvedProdutos comes from the separate state — never duplicated
        const mergedProdutos = [
          // Approved items: preserve their original status and data exactly
          ...approvedProdutos.map(p => ({
            id: p.id,
            produto: p.produto,
            valorUnit: p.valorUnit,
            quantidade: p.quantidade,
            unidade: p.unidade,
            icms: p.icms,
            ipi: p.ipi,
            prazo: p.prazo,
            obs: p.obs,
            status: p.status as 'APROVADO',
            motivoRejeicao: p.motivoRejeicao,
          })),
          // Editable items: preserve existing status or default to PENDENTE
          ...produtos.map(p => ({
            id: p.id,
            produto: p.produto,
            valorUnit: p.valorUnit,
            quantidade: p.quantidade,
            unidade: p.unidade,
            icms: p.icms,
            ipi: p.ipi,
            prazo: p.prazo,
            obs: p.obs,
            status: (p.status === 'REJEITADO' ? 'PENDENTE' : (p.status || 'PENDENTE')) as 'PENDENTE',
            motivoRejeicao: undefined,
          }))
        ];

        // Determine overall cotacao status:
        // If there are pending items, cotacao stays PENDENTE
        // If all approved (no pending/rejected), keep APROVADO
        const hasPendingItems = mergedProdutos.some(p => !p.status || p.status === 'PENDENTE');
        const hasApprovedItems = mergedProdutos.some(p => p.status === 'APROVADO');
        const newCotacaoStatus = hasPendingItems ? 'PENDENTE' : (hasApprovedItems ? 'APROVADO' : 'PENDENTE');

        await updateCotacao(cotacao.id, {
          ...data,
          produtos: mergedProdutos,
          status: newCotacaoStatus,
          // Only clear approval metadata if there are pending items
          aprovadoPor: hasPendingItems ? cotacao.aprovadoPor : cotacao.aprovadoPor,
          motivoRejeicao: hasPendingItems ? null : cotacao.motivoRejeicao,
          dataDecisao: hasPendingItems ? cotacao.dataDecisao : cotacao.dataDecisao,
        });
        toast.success(`Cotação #${cotacao.id} atualizada e reenviada!`);
      } else {
        const c = await addCotacao(data);
        toast.success(`Cotação #${c.id} criada! Aguardando aprovação do gestor.`);
      }
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar cotação no banco de dados.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[640px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.08]">
          <h2 className="text-lg font-semibold text-[#212121]">
            {cotacao ? `Editar Cotação #${cotacao.id}` : 'Nova Cotação'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#757575] hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Divisão Segmented Control */}
          <div>
            <label className="text-sm font-medium text-[#212121] mb-2 block">Divisão</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDivisao('USINAGEM')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border-2 transition-all duration-200 ${
                  divisao === 'USINAGEM'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm'
                    : 'border-black/[0.08] text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Cog size={16} />
                Usinagem
              </button>
              <button
                type="button"
                onClick={() => setDivisao('FUNDICAO')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border-2 transition-all duration-200 ${
                  divisao === 'FUNDICAO'
                    ? 'bg-orange-50 border-orange-500 text-orange-700 shadow-sm'
                    : 'border-black/[0.08] text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Flame size={16} />
                Fundição
              </button>
            </div>
          </div>

          {/* Fornecedor */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-[#212121] mb-1.5">
              Fornecedor <span className="text-red-500">*</span>
            </label>
            <SugestaoInput
              value={fornecedor}
              onChange={setFornecedor}
              suggestions={sugestoesFornecedor}
              label="Fornecedores cadastrados"
              placeholder="Digite para buscar nos fornecedores cadastrados"
              className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${
                errors.fornecedor ? 'border-red-400 focus:border-red-400' : 'border-black/[0.08] focus:border-primary'
              }`}
            />
            {errors.fornecedor && <p className="text-xs text-red-500 mt-1">{errors.fornecedor}</p>}
          </div>

          {pedido && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#212121]">
                  Pedido do Almoxarifado #{pedido.numero}
                  {pedido.urgencia === 'urgente' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">URGENTE</span>}
                </p>
                <span className="text-xs text-[#757575]">{pedido.solicitante ?? 'Almoxarifado'}</span>
              </div>
              {pedido.observacao && <p className="text-xs text-[#555]">{pedido.observacao}</p>}
              <ul className="space-y-1">
                {pedido.itens.map((item, idx) => {
                  const feito = jaNoOrcamento(item.produto);
                  return (
                    <li key={idx} className="flex items-center justify-between gap-2 text-xs">
                      <span className={feito ? 'text-[#757575] line-through' : 'text-[#212121]'}>
                        {item.quantidade.toLocaleString('pt-BR')} {item.unidade} · {item.produto}
                      </span>
                      {feito
                        ? <span className="flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle size={13} /> no orçamento</span>
                        : <button type="button" disabled={editingProductId !== null} onClick={() => cotarItemDoPedido(item)} className="rounded-md bg-primary/10 px-2 py-1 font-semibold text-primary hover:bg-primary/20 disabled:opacity-40">Cotar item</button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Seção de Produtos */}
          <div className="border-t border-black/[0.06] pt-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-[#212121]">Produtos no Orçamento</label>
              {editingProductId === null && (
                <button
                  type="button"
                  onClick={handleNewProductClick}
                  className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-primary/20 transition-all active:scale-[0.98]"
                >
                  <Plus size={14} />
                  Novo Produto
                </button>
              )}
            </div>

            {/* List of products */}
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {/* Read-only approved/purchased items */}
              {approvedProdutos.length > 0 && (
                <>
                  {approvedProdutos.map((p, idx) => {
                    const itemBruto = p.valorUnit * p.quantidade;
                    const itemTotal = itemBruto + itemBruto * (p.ipi / 100);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-green-200 bg-green-50/50 text-xs"
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <p className="font-semibold text-[#212121] truncate flex items-center gap-1.5">
                            {idx + 1}. {p.produto}
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                              <CheckCircle size={10} />
                              {p.status === 'APROVADO' ? 'Aprovado' : p.status}
                            </span>
                          </p>
                          <p className="text-[10px] text-[#757575] mt-0.5">
                            {p.quantidade} {p.unidade} &times; {formatUnitPrice(p.valorUnit)}
                            {p.icms > 0 && ` | ICMS: ${p.icms}%`}
                            {p.ipi > 0 && ` | IPI: ${p.ipi}%`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-green-700 text-sm flex-shrink-0 line-through opacity-60">
                            {formatAmount(itemTotal)}
                          </span>
                          <Lock size={13} className="text-green-600/50" />
                        </div>
                      </div>
                    );
                  })}
                  {produtos.length > 0 && (
                    <div className="border-t border-dashed border-black/[0.08] my-1" />
                  )}
                </>
              )}

              {/* Editable items */}
              {produtos.length === 0 && approvedProdutos.length === 0 ? (
                <p className="text-xs text-[#757575] italic py-3 text-center bg-gray-50 rounded-lg border border-dashed border-black/[0.08]">
                  Nenhum produto adicionado. Clique em "Novo Produto" para começar.
                </p>
              ) : (
                produtos.map((p, idx) => {
                  const itemBruto = p.valorUnit * p.quantidade;
                  const itemTotal = itemBruto + itemBruto * (p.ipi / 100);
                  const isEditingThis = editingProductId === p.id;
                  const displayIdx = approvedProdutos.length + idx + 1;
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleEditProductClick(p)}
                      className={`flex items-center justify-between p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                        isEditingThis
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-black/[0.06] hover:bg-slate-50 hover:border-black/10'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <p className="font-semibold text-[#212121] truncate">
                          {displayIdx}. {p.produto}
                        </p>
                        <p className="text-[10px] text-[#757575] mt-0.5">
                          {p.quantidade} {p.unidade} &times; {formatUnitPrice(p.valorUnit)}
                          {p.icms > 0 && ` | ICMS: ${p.icms}%`}
                          {p.ipi > 0 && ` | IPI: ${p.ipi}%`}
                          {p.obs && ` | ${p.obs}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-primary text-sm flex-shrink-0">
                          {formatAmount(itemTotal)}
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditProductClick(p);
                            }}
                            className="p-1 rounded text-[#757575] hover:bg-black/[0.04] hover:text-primary transition-colors"
                            title="Editar produto"
                          >
                            <Edit size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteProduct(p.id, e)}
                            className="p-1 rounded text-[#757575] hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="Remover produto"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Collapsible Dropdown / Drawer for product form */}
            {editingProductId !== null && (
              <div className="bg-slate-50 border border-primary/20 rounded-xl p-4 mt-3 space-y-4 animate-in fade-in slide-in-from-top-4 duration-200">
                <div className="flex items-center justify-between border-b border-black/[0.06] pb-2">
                  <h3 className="font-semibold text-primary text-xs uppercase tracking-wider">
                    {editingProductId.startsWith('new-') ? 'Novo Produto' : 'Editar Produto'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingProductId(null)}
                    className="text-[#757575] hover:text-red-500 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Produto */}
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[#212121] mb-1">
                      Produto / Descrição <span className="text-red-500">*</span>
                    </label>
                    <SugestaoInput
                      value={productForm.produto}
                      onChange={v => setProductForm(f => ({ ...f, produto: v }))}
                      onPick={s => {
                        const unidade = (s.meta as { unidade?: string | null } | undefined)?.unidade;
                        if (unidade && UNIDADES.includes(unidade)) setProductForm(f => ({ ...f, unidade }));
                      }}
                      suggestions={sugestoesProduto}
                      label="Produtos do histórico"
                      placeholder="Digite para buscar no histórico de produtos"
                      className={`w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${
                        productErrors.produto ? 'border-red-400 focus:border-red-400' : 'border-black/[0.08] focus:border-primary'
                      }`}
                    />
                    {productErrors.produto && <p className="text-[10px] text-red-500 mt-0.5">{productErrors.produto}</p>}
                  </div>

                  {/* Valor Unit */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[#212121] mb-1">
                      Valor Unitário (R$) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={productForm.valorUnit}
                      onChange={e => {
                        const masked = formatCurrencyInput(e.target.value, 3);
                        setProductForm(f => ({ ...f, valorUnit: masked }));
                      }}
                      onBlur={e => {
                        const normalized = normalizeCurrencyInput(e.target.value);
                        setProductForm(f => ({ ...f, valorUnit: normalized }));
                      }}
                      placeholder="0,00"
                      className={`w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${
                        productErrors.valorUnit ? 'border-red-400 focus:border-red-400' : 'border-black/[0.08] focus:border-primary'
                      }`}
                    />
                    {productErrors.valorUnit && <p className="text-[10px] text-red-500 mt-0.5">{productErrors.valorUnit}</p>}
                  </div>

                  {/* Quantidade */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[#212121] mb-1">
                      Quantidade <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={productForm.quantidade}
                      onChange={e => setProductForm(f => ({ ...f, quantidade: e.target.value }))}
                      placeholder="0"
                      className={`w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${
                        productErrors.quantidade ? 'border-red-400 focus:border-red-400' : 'border-black/[0.08] focus:border-primary'
                      }`}
                    />
                    {productErrors.quantidade && <p className="text-[10px] text-red-500 mt-0.5">{productErrors.quantidade}</p>}
                  </div>

                  {/* Unidade */}
                  <div>
                    <label className="text-xs font-medium text-[#212121] mb-1 block">Unidade</label>
                    <select
                      value={productForm.unidade}
                      onChange={e => setProductForm(f => ({ ...f, unidade: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>

                  {/* Prazo */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[#212121] mb-1">
                      Prazo de Pagamento <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={productForm.prazo}
                      onChange={e => setProductForm(f => ({ ...f, prazo: e.target.value }))}
                      placeholder="Ex: 30 DDL, À vista"
                      className={`w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${
                        productErrors.prazo ? 'border-red-400 focus:border-red-400' : 'border-black/[0.08] focus:border-primary'
                      }`}
                    />
                    {productErrors.prazo && <p className="text-[10px] text-red-500 mt-0.5">{productErrors.prazo}</p>}
                  </div>

                  {/* ICMS */}
                  <div>
                    <label className="text-xs font-medium text-[#212121] mb-1 block">ICMS (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={productForm.icms}
                      onChange={e => setProductForm(f => ({ ...f, icms: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  {/* IPI */}
                  <div>
                    <label className="text-xs font-medium text-[#212121] mb-1 block">IPI (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={productForm.ipi}
                      onChange={e => setProductForm(f => ({ ...f, ipi: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  {/* Observações */}
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-[#212121] mb-1 block">Observações do Produto</label>
                    <textarea
                      value={productForm.obs}
                      onChange={e => setProductForm(f => ({ ...f, obs: e.target.value }))}
                      placeholder="Observações adicionais (opcional)"
                      rows={2}
                      maxLength={1000}
                      className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                    />
                  </div>
                </div>

                {/* Subtotal preview */}
                <div className="p-3 bg-white border border-black/[0.06] rounded-lg flex items-center justify-between text-xs">
                  <span className="text-[#757575]">Subtotal deste produto:</span>
                  <span className="font-bold text-primary">
                    {(() => {
                      const v = parseCurrencyInput(productForm.valorUnit) || 0;
                      const q = parseFloat(productForm.quantidade) || 0;
                      const ip = parseFloat(productForm.ipi) || 0;
                      const bruto = v * q;
                      const total = bruto + bruto * (ip / 100);
                      return formatAmount(total);
                    })()}
                  </span>
                </div>

                {/* Controls */}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingProductId(null)}
                    className="px-3 py-1.5 rounded-lg border border-black/[0.08] text-xs text-[#212121] hover:bg-white transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveProduct}
                    className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    Salvar Produto
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Entrega e frete: saem na Ordem de Compra e somam no total do pedido */}
          <div className="border-t border-black/[0.06] pt-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-[#212121]">Entrega e frete</label>
              <p className="text-[11px] text-[#757575]">Saem na ordem de compra. Frete, seguro e outras despesas cobrados pelo fornecedor somam no total do pedido.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#212121] mb-1 block">Frete</label>
                <select
                  value={pedidoOc.freteTipo}
                  onChange={e => setPedidoOc(f => ({ ...f, freteTipo: e.target.value as FreteTipo }))}
                  aria-label="Frete"
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="CIF">CIF — por conta do fornecedor</option>
                  <option value="FOB">FOB — por conta da PecSil</option>
                  <option value="SEM">Sem frete</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#212121] mb-1 block">Prazo de entrega</label>
                <input
                  type="date"
                  value={pedidoOc.prazoEntrega}
                  onChange={e => setPedidoOc(f => ({ ...f, prazoEntrega: e.target.value }))}
                  aria-label="Prazo de entrega"
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              {([['freteValor', 'Valor do frete (R$)'], ['seguroValor', 'Seguro (R$)'], ['outrasDespesas', 'Outras despesas (R$)']] as const).map(([campo, rotulo]) => (
                <div key={campo}>
                  <label className="text-xs font-medium text-[#212121] mb-1 block">{rotulo}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pedidoOc[campo]}
                    onChange={e => { const v = formatCurrencyInput(e.target.value, 2); setPedidoOc(f => ({ ...f, [campo]: v })); }}
                    onBlur={e => { const v = e.target.value ? normalizeCurrencyInput(e.target.value, 2, 2) : ''; setPedidoOc(f => ({ ...f, [campo]: v })); }}
                    placeholder="0,00"
                    aria-label={rotulo}
                    className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-[#212121] mb-1 block">Observação para o fornecedor</label>
                <textarea
                  value={pedidoOc.observacao}
                  onChange={e => setPedidoOc(f => ({ ...f, observacao: e.target.value }))}
                  placeholder="Sai no campo Observação da ordem de compra (opcional)"
                  rows={2}
                  maxLength={2000}
                  aria-label="Observação para o fornecedor"
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>
            </div>
          </div>

          {/* Total Preview */}
          {produtos.length > 0 && (
            <div className="p-4 bg-[#f8f9fa] border border-black/[0.08] rounded-lg">
              <p className="text-xs font-medium text-[#757575] mb-2">Resumo Geral do Orçamento</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-[#757575]">
                  Bruto: <strong className="text-[#212121]">{formatAmount(bd.bruto)}</strong>
                </span>
                <span className="text-[#757575]">
                  ICMS: <strong className="text-[#212121]">{formatAmount(bd.icms)}</strong>
                </span>
                <span className="text-[#757575]">
                  IPI: <strong className="text-[#212121]">{formatAmount(bd.ipi)}</strong>
                </span>
                <span className="text-lg font-bold text-primary ml-auto">
                  Total: {formatAmount(bd.total)}
                </span>
              </div>
              {despesas > 0 && (
                <div className="mt-2 pt-2 border-t border-black/[0.06] flex items-center justify-between text-sm">
                  <span className="text-[#757575]">Frete e despesas: <strong className="text-[#212121]">{formatAmount(despesas)}</strong></span>
                  <span className="font-bold text-primary">Total do pedido: {formatAmount(bd.total + despesas)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/[0.08] bg-white rounded-b-xl">
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
            {cotacao ? 'Salvar Alterações' : 'Salvar Cotação'}
          </button>
        </div>
      </div>
    </div>
  );
}
