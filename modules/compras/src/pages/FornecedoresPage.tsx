import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, Merge, Building2, Phone, Mail, MapPin, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useStore, formatCurrency, formatDate, formatUnitPrice, calcularTotal } from '@/store';
import type { Cotacao } from '@/types';
import DetalhesCotacaoModal from '@/components/DetalhesCotacaoModal';
import SugestaoInput from '@/components/SugestaoInput';
import type { Suggestion } from '../../../../lib/compras/sugestoes-core';
import { priceHistory } from '../../../../lib/compras/fornecedores-core';

type Summary = {
  cotacoes: number;
  aprovadas: number;
  rejeitadas: number;
  compradas: number;
  pendentes: number;
  compras: number;
  totalComprado: number;
  primeiraCompra: string | null;
  ultimaCompra: string | null;
  divisoes: string[];
};

type Supplier = {
  id: string;
  name: string;
  taxId: string | null;
  active: boolean;
  legalName: string | null;
  tradeName: string | null;
  stateRegistration: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  paymentTerms: string | null;
  divisions: string[];
  category: string | null;
  notes: string | null;
  aliases: string[];
  summary: Summary;
};

type Duplicate = { a: string; b: string; score: number };
type Aba = 'cadastro' | 'compras' | 'cotacoes' | 'precos';

const DIVISOES: Record<string, string> = { USINAGEM: 'Usinagem', FUNDICAO: 'Fundição' };
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDENTE: { label: 'Pendente', cls: 'bg-[#fff3e0] text-[#e65100]' },
  APROVADO: { label: 'Aprovado', cls: 'bg-[#e8f5e9] text-green-700' },
  REJEITADO: { label: 'Rejeitado', cls: 'bg-[#ffebee] text-red-700' },
  COMPRADO: { label: 'Comprado', cls: 'bg-[#e3f2fd] text-blue-700' },
};

const formatDoc = (digits: string | null) => {
  if (!digits) return '';
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return digits;
};

const buscar = () =>
  fetch('/api/compras/fornecedores', { cache: 'no-store' })
    .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
    .catch(() => ({ ok: false, body: { error: 'Falha ao carregar.' } }));

const fieldCls =
  'px-3 py-2 rounded-lg border border-black/[0.08] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-[#f5f5f5] disabled:text-[#757575]';
const inputCls = `w-full ${fieldCls}`;

export default function FornecedoresPage() {
  const { cotacoes, compras, fetchInitialData } = useStore();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [divisao, setDivisao] = useState('');
  const [ordem, setOrdem] = useState<'total' | 'ultima' | 'nome'>('total');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [mostrarDuplicados, setMostrarDuplicados] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const aplicar = useCallback((ok: boolean, body: { error?: string; suppliers?: Supplier[]; duplicates?: Duplicate[]; canEdit?: boolean }) => {
    if (ok) {
      setSuppliers(body.suppliers ?? []);
      setDuplicates(body.duplicates ?? []);
      setCanEdit(Boolean(body.canEdit));
      setErro('');
    } else {
      setErro(body.error === 'FORBIDDEN' ? 'Sem permissão para ver fornecedores.' : body.error || 'Falha ao carregar.');
    }
    setLoading(false);
  }, []);

  const carregar = useCallback(async () => {
    const { ok, body } = await buscar();
    aplicar(ok, body);
  }, [aplicar]);

  useEffect(() => {
    let ativo = true;
    buscar().then(({ ok, body }) => {
      if (ativo) aplicar(ok, body);
    });
    return () => {
      ativo = false;
    };
  }, [aplicar]);

  const porId = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    return suppliers
      .filter((s) => mostrarInativos || s.active)
      .filter((s) => !divisao || s.divisions.includes(divisao) || s.summary.divisoes.includes(divisao))
      .filter((s) => {
        if (!termo) return true;
        return (
          s.name.toLowerCase().includes(termo) ||
          (s.legalName ?? '').toLowerCase().includes(termo) ||
          (s.tradeName ?? '').toLowerCase().includes(termo) ||
          s.aliases.some((a) => a.toLowerCase().includes(termo)) ||
          (!!digitos && (s.taxId ?? '').includes(digitos))
        );
      })
      .sort((a, b) => {
        if (ordem === 'nome') return a.name.localeCompare(b.name, 'pt-BR');
        if (ordem === 'ultima') return (b.summary.ultimaCompra ?? '').localeCompare(a.summary.ultimaCompra ?? '');
        return b.summary.totalComprado - a.summary.totalComprado;
      });
  }, [suppliers, busca, divisao, ordem, mostrarInativos]);

  const totalGeral = useMemo(() => lista.reduce((sum, s) => sum + s.summary.totalComprado, 0), [lista]);
  const duplicadosValidos = duplicates.filter((d) => porId.has(d.a) && porId.has(d.b));

  const unificar = async (keepId: string, dropId: string) => {
    const keep = porId.get(keepId), drop = porId.get(dropId);
    if (!keep || !drop) return;
    if (!window.confirm(`Unificar "${drop.name}" em "${keep.name}"?\n\nAs cotações e compras de "${drop.name}" passam para "${keep.name}", e o nome "${drop.name}" continua reconhecido em lançamentos futuros.`)) return;
    const res = await fetch('/api/compras/fornecedores/unificar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keepId, dropId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error || 'Não foi possível unificar.');
      return;
    }
    toast.success(`"${drop.name}" unificado em "${keep.name}".`);
    await Promise.all([carregar(), fetchInitialData()]);
  };

  const selecionado = selecionadoId ? porId.get(selecionadoId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#212121]">Fornecedores</h2>
          <p className="text-sm text-[#757575]">
            {lista.length} fornecedor{lista.length === 1 ? '' : 'es'} · {formatCurrency(totalGeral)} em compras registradas
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setNovo(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} /> Novo fornecedor
          </button>
        )}
      </div>

      {duplicadosValidos.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <button
            type="button"
            onClick={() => setMostrarDuplicados((v) => !v)}
            className="flex w-full items-center gap-2 text-left text-sm font-medium text-amber-700"
          >
            <AlertTriangle size={16} />
            Possíveis duplicados ({duplicadosValidos.length}) — o mesmo fornecedor escrito de jeitos diferentes
            <span className="ml-auto text-xs underline">{mostrarDuplicados ? 'ocultar' : 'ver'}</span>
          </button>
          {mostrarDuplicados && (
            <ul className="mt-3 space-y-2">
              {duplicadosValidos.map((d) => {
                const a = porId.get(d.a)!, b = porId.get(d.b)!;
                return (
                  <li key={`${d.a}-${d.b}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm border border-black/[0.06]">
                    <span className="font-medium text-[#212121]">{a.name}</span>
                    <span className="text-xs text-[#757575]">({a.summary.compras} compras)</span>
                    <span className="text-[#757575]">×</span>
                    <span className="font-medium text-[#212121]">{b.name}</span>
                    <span className="text-xs text-[#757575]">({b.summary.compras} compras)</span>
                    {canEdit && (
                      <span className="ml-auto flex gap-2">
                        <button type="button" onClick={() => unificar(a.id, b.id)} className="flex items-center gap-1 rounded-md border border-black/[0.08] px-2 py-1 text-xs hover:bg-gray-50">
                          <Merge size={12} /> Manter “{a.name}”
                        </button>
                        <button type="button" onClick={() => unificar(b.id, a.id)} className="flex items-center gap-1 rounded-md border border-black/[0.08] px-2 py-1 text-xs hover:bg-gray-50">
                          <Merge size={12} /> Manter “{b.name}”
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-[420px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575]" />
          <input
            type="text"
            placeholder="Buscar por nome, apelido ou CNPJ..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className={`${inputCls} pl-9`}
          />
        </div>
        <select value={divisao} onChange={(e) => setDivisao(e.target.value)} className={fieldCls}>
          <option value="">Todas as divisões</option>
          <option value="USINAGEM">Usinagem</option>
          <option value="FUNDICAO">Fundição</option>
        </select>
        <select value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} className={fieldCls}>
          <option value="total">Maior total comprado</option>
          <option value="ultima">Compra mais recente</option>
          <option value="nome">Nome (A–Z)</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-[#757575]">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
          Mostrar inativos
        </label>
      </div>

      <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm overflow-hidden">
        {loading ? (
          <p className="py-12 text-center text-sm text-[#757575]">Carregando fornecedores…</p>
        ) : erro ? (
          <p className="py-12 text-center text-sm text-red-700">{erro}</p>
        ) : lista.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#757575]">Nenhum fornecedor encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.08] bg-[#fafafa]">
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Fornecedor</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Cidade/UF</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Divisões</th>
                  <th className="text-right py-3 px-4 font-medium text-[#757575] text-xs uppercase">Cotações</th>
                  <th className="text-right py-3 px-4 font-medium text-[#757575] text-xs uppercase">Compras</th>
                  <th className="text-right py-3 px-4 font-medium text-[#757575] text-xs uppercase">Total comprado</th>
                  <th className="text-left py-3 px-4 font-medium text-[#757575] text-xs uppercase">Última compra</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((s) => {
                  const divs = [...new Set([...s.divisions, ...s.summary.divisoes])];
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelecionadoId(s.id)}
                      className="border-b border-black/[0.04] last:border-0 hover:bg-[#fafafa] cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-[#212121] flex items-center gap-2">
                          {s.name}
                          {!s.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-[#757575]">Inativo</span>}
                        </div>
                        <div className="text-xs text-[#757575]">
                          {s.taxId ? formatDoc(s.taxId) : 'Sem CNPJ'}
                          {s.aliases.length > 0 && ` · também “${s.aliases.join('”, “')}”`}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#757575]">{s.city ? `${s.city}${s.state ? `/${s.state}` : ''}` : '—'}</td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1">
                          {divs.map((d) => (
                            <span key={d} className="rounded bg-[#e3f2fd] px-1.5 py-0.5 text-[10px] font-medium text-blue-700">{DIVISOES[d] ?? d}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-[#212121]">{s.summary.cotacoes}</td>
                      <td className="py-3 px-4 text-right text-[#212121]">{s.summary.compras}</td>
                      <td className="py-3 px-4 text-right font-medium text-primary">{formatCurrency(s.summary.totalComprado)}</td>
                      <td className="py-3 px-4 text-[#757575]">{s.summary.ultimaCompra ? formatDate(s.summary.ultimaCompra) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selecionado && (
        <FornecedorPainel
          key={selecionado.id}
          fornecedor={selecionado}
          canEdit={canEdit}
          cotacoes={cotacoes.filter((c) => c.supplierId === selecionado.id && !c.deletedAt)}
          compras={compras.filter((c) => c.supplierId === selecionado.id)}
          onClose={() => setSelecionadoId(null)}
          onSaved={carregar}
        />
      )}

      {novo && (
        <NovoFornecedor
          existentes={suppliers}
          onExisting={(id) => {
            setNovo(false);
            setSelecionadoId(id);
          }}
          onClose={() => setNovo(false)}
          onCreated={async (id) => {
            setNovo(false);
            await carregar();
            setSelecionadoId(id);
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Painel do fornecedor: cadastro, compras, cotações e preços
   ------------------------------------------------------------------------- */

type FormState = Record<string, string> & { divisions: string };

const toForm = (s: Supplier): FormState => ({
  name: s.name,
  taxId: formatDoc(s.taxId),
  legalName: s.legalName ?? '',
  tradeName: s.tradeName ?? '',
  stateRegistration: s.stateRegistration ?? '',
  contactName: s.contactName ?? '',
  phone: s.phone ?? '',
  email: s.email ?? '',
  address: s.address ?? '',
  city: s.city ?? '',
  state: s.state ?? '',
  postalCode: s.postalCode ? s.postalCode.replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
  paymentTerms: s.paymentTerms ?? '',
  category: s.category ?? '',
  notes: s.notes ?? '',
  divisions: s.divisions.join(','),
});

function FornecedorPainel({
  fornecedor,
  canEdit,
  cotacoes,
  compras,
  onClose,
  onSaved,
}: {
  fornecedor: Supplier;
  canEdit: boolean;
  cotacoes: Cotacao[];
  compras: ReturnType<typeof useStore.getState>['compras'];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [aba, setAba] = useState<Aba>('compras');
  const [form, setForm] = useState<FormState>(() => toForm(fornecedor));
  const [salvando, setSalvando] = useState(false);
  const [ativo, setAtivo] = useState(fornecedor.active);
  const [detalhe, setDetalhe] = useState<Cotacao | null>(null);

  const comprasOrdenadas = useMemo(
    () => [...compras].sort((a, b) => (b.dataCompra ?? '').localeCompare(a.dataCompra ?? '') || b.id - a.id),
    [compras],
  );
  const cotacoesOrdenadas = useMemo(() => [...cotacoes].sort((a, b) => b.id - a.id), [cotacoes]);
  const precos = useMemo(
    () =>
      priceHistory(
        compras.map((c) => ({ produto: c.produto, valorUnit: c.valorUnit, quantidade: c.quantidade, unidade: c.unidade, data: c.dataCompra ?? c.createdAt ?? '' })),
      ),
    [compras],
  );
  const totalCompras = compras.reduce((sum, c) => sum + (c.total || 0), 0);

  const set = (campo: string, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));
  const divs = form.divisions ? form.divisions.split(',') : [];
  const toggleDiv = (d: string) => set('divisions', (divs.includes(d) ? divs.filter((x) => x !== d) : [...divs, d]).join(','));

  const salvar = async () => {
    setSalvando(true);
    const { divisions, ...texto } = form;
    const res = await fetch(`/api/compras/fornecedores/${fornecedor.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...texto, divisions: divisions ? divisions.split(',') : [], active: ativo }),
    });
    const body = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) {
      toast.error(body.error || 'Não foi possível salvar.');
      return;
    }
    toast.success('Cadastro salvo.');
    await onSaved();
  };

  const campo = (label: string, key: string, props: { placeholder?: string; span?: boolean } = {}) => (
    <label className={`flex flex-col gap-1 ${props.span ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-medium text-[#757575]">{label}</span>
      <input className={inputCls} value={form[key]} placeholder={props.placeholder} disabled={!canEdit} onChange={(e) => set(key, e.target.value)} />
    </label>
  );

  const ABAS: { id: Aba; label: string }[] = [
    { id: 'compras', label: `Compras (${compras.length})` },
    { id: 'cotacoes', label: `Cotações (${cotacoes.length})` },
    { id: 'precos', label: `Preços (${precos.length})` },
    { id: 'cadastro', label: 'Cadastro' },
  ];

  return (
    <>
    {/* Janela central: só fecha no X (clique fora não fecha — não se perde o que foi digitado). */}
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl" role="dialog" aria-modal="true">
        <div className="sticky top-0 z-10 rounded-t-xl border-b border-black/[0.08] bg-white px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#e3f2fd] p-2 text-blue-700"><Building2 size={20} /></div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-[#212121] truncate">{fornecedor.name}</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#757575]">
                {fornecedor.taxId && <span>{formatDoc(fornecedor.taxId)}</span>}
                {fornecedor.contactName && <span>{fornecedor.contactName}</span>}
                {fornecedor.phone && <span className="flex items-center gap-1"><Phone size={11} />{fornecedor.phone}</span>}
                {fornecedor.email && <span className="flex items-center gap-1"><Mail size={11} />{fornecedor.email}</span>}
                {fornecedor.city && <span className="flex items-center gap-1"><MapPin size={11} />{fornecedor.city}{fornecedor.state ? `/${fornecedor.state}` : ''}</span>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#757575] hover:bg-gray-50" aria-label="Fechar"><X size={18} /></button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Indicador label="Total comprado" valor={formatCurrency(totalCompras)} />
            <Indicador label="Compras" valor={String(compras.length)} />
            <Indicador label="Cotações" valor={`${cotacoes.length} · ${fornecedor.summary.rejeitadas} rejeitada${fornecedor.summary.rejeitadas === 1 ? '' : 's'}`} />
            <Indicador label="Última compra" valor={fornecedor.summary.ultimaCompra ? formatDate(fornecedor.summary.ultimaCompra) : '—'} />
          </div>
          <nav className="mt-4 flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-1 w-max max-w-full overflow-x-auto">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAba(a.id)}
                aria-current={aba === a.id ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
                  aba === a.id
                    ? 'bg-[var(--tint-blue)] text-[var(--accent-blue)] shadow-xs border border-[var(--accent-blue)] ring-1 ring-[var(--accent-blue)]'
                    : 'border border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {a.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="px-6 py-5">
          {aba === 'compras' && (
            comprasOrdenadas.length === 0 ? <Vazio texto="Nenhuma compra registrada com este fornecedor." /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-[#fafafa]">
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Data</th>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">NF</th>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Produto</th>
                    <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Qtd</th>
                    <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Unitário</th>
                    <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {comprasOrdenadas.map((c) => (
                    <tr key={c.id} className="border-b border-black/[0.04]">
                      <td className="py-2 px-3 text-[#757575] whitespace-nowrap">{c.dataCompra ? formatDate(c.dataCompra) : '—'}</td>
                      <td className="py-2 px-3 text-[#757575]">{c.nf || '—'}</td>
                      <td className="py-2 px-3 text-[#212121]">{c.produto}</td>
                      <td className="py-2 px-3 text-right text-[#212121] whitespace-nowrap">{c.quantidade} {c.unidade}</td>
                      <td className="py-2 px-3 text-right text-[#212121] whitespace-nowrap">{formatUnitPrice(c.valorUnit)}</td>
                      <td className="py-2 px-3 text-right font-medium text-primary whitespace-nowrap">{formatCurrency(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {aba === 'cotacoes' && (
            cotacoesOrdenadas.length === 0 ? <Vazio texto="Nenhuma cotação com este fornecedor." /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-[#fafafa]">
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">ID</th>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Data</th>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Divisão</th>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Itens</th>
                    <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Total</th>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cotacoesOrdenadas.map((c) => {
                    const st = STATUS[c.status] ?? { label: c.status, cls: 'bg-gray-100 text-[#757575]' };
                    const itens = c.produtos?.length ? c.produtos : [];
                    return (
                      <tr key={c.id} onClick={() => setDetalhe(c)} className="border-b border-black/[0.04] hover:bg-[#fafafa] cursor-pointer">
                        <td className="py-2 px-3 font-medium text-[#212121]">#{c.id}</td>
                        <td className="py-2 px-3 text-[#757575] whitespace-nowrap">{formatDate(c.createdAt)}</td>
                        <td className="py-2 px-3 text-[#757575]">{DIVISOES[c.divisao] ?? c.divisao}</td>
                        <td className="py-2 px-3 text-[#212121]">
                          {itens.length ? `${itens[0].produto}${itens.length > 1 ? ` (+${itens.length - 1})` : ''}` : c.produto}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-primary whitespace-nowrap">{formatCurrency(calcularTotal(c))}</td>
                        <td className="py-2 px-3"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}

          {aba === 'precos' && (
            precos.length === 0 ? <Vazio texto="Sem compras para comparar preços." /> : (
              <>
                <p className="mb-3 text-xs text-[#757575]">Preço unitário pago em cada produto, das compras registradas. Use para comparar ao cotar.</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-[#fafafa]">
                      <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Produto</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Último</th>
                      <th className="text-left py-2 px-3 text-xs font-medium uppercase text-[#757575]">Em</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Menor</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Maior</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Variação</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase text-[#757575]">Compras</th>
                    </tr>
                  </thead>
                  <tbody>
                    {precos.map((p) => (
                      <tr key={p.produto} className="border-b border-black/[0.04]">
                        <td className="py-2 px-3 text-[#212121]">{p.produto}</td>
                        <td className="py-2 px-3 text-right font-medium text-[#212121] whitespace-nowrap">{formatUnitPrice(p.ultimo)}{p.unidade ? ` /${p.unidade}` : ''}</td>
                        <td className="py-2 px-3 text-[#757575] whitespace-nowrap">{p.ultimaData ? formatDate(p.ultimaData) : '—'}</td>
                        <td className="py-2 px-3 text-right text-[#757575] whitespace-nowrap">{formatUnitPrice(p.menor)}</td>
                        <td className="py-2 px-3 text-right text-[#757575] whitespace-nowrap">{formatUnitPrice(p.maior)}</td>
                        <td className={`py-2 px-3 text-right font-medium whitespace-nowrap ${p.variacao == null ? 'text-[#757575]' : p.variacao > 0 ? 'text-red-700' : p.variacao < 0 ? 'text-green-700' : 'text-[#757575]'}`}>
                          {p.variacao == null ? '—' : `${p.variacao > 0 ? '+' : ''}${p.variacao.toLocaleString('pt-BR')}%`}
                        </td>
                        <td className="py-2 px-3 text-right text-[#757575]">{p.compras}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          )}

          {aba === 'cadastro' && (
            <div className="space-y-5">
              {!canEdit && <p className="rounded-lg bg-[#f5f5f5] px-3 py-2 text-xs text-[#757575]">Somente leitura: editar exige a permissão Compras › Fornecedores (operar).</p>}
              <Secao titulo="Identificação">
                {campo('Nome de exibição', 'name')}
                {campo('CNPJ / CPF', 'taxId', { placeholder: '00.000.000/0000-00' })}
                {campo('Razão social', 'legalName')}
                {campo('Nome fantasia', 'tradeName')}
                {campo('Inscrição estadual', 'stateRegistration')}
                {campo('Prazo de pagamento padrão', 'paymentTerms', { placeholder: 'Ex.: 30/60 DDL' })}
              </Secao>
              <Secao titulo="Contato comercial">
                {campo('Vendedor / contato', 'contactName')}
                {campo('Telefone / WhatsApp', 'phone')}
                {campo('E-mail', 'email', { span: true })}
              </Secao>
              <Secao titulo="Endereço">
                {campo('Endereço', 'address', { span: true })}
                {campo('Cidade', 'city')}
                {campo('UF', 'state', { placeholder: 'SP' })}
                {campo('CEP', 'postalCode', { placeholder: '00000-000' })}
              </Secao>
              <Secao titulo="Classificação">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-[#757575]">Atende</span>
                  <div className="flex gap-2">
                    {Object.entries(DIVISOES).map(([d, label]) => (
                      <button
                        key={d}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => toggleDiv(d)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          divs.includes(d) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-black/[0.08] text-[#757575] hover:bg-gray-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {campo('Categoria (o que fornece)', 'category', { placeholder: 'Ex.: Bronze, embalagens, ferramentas' })}
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs font-medium text-[#757575]">Observações</span>
                  <textarea className={`${inputCls} min-h-[80px]`} value={form.notes} disabled={!canEdit} onChange={(e) => set('notes', e.target.value)} />
                </label>
                <label className="flex items-center gap-2 text-sm text-[#212121]">
                  <input type="checkbox" checked={ativo} disabled={!canEdit} onChange={(e) => setAtivo(e.target.checked)} />
                  Fornecedor ativo
                </label>
              </Secao>
              {fornecedor.aliases.length > 0 && (
                <p className="text-xs text-[#757575]">Também reconhecido como: {fornecedor.aliases.join(', ')}</p>
              )}
              {canEdit && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={salvar}
                    disabled={salvando}
                    className="bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    {salvando ? 'Salvando…' : 'Salvar cadastro'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    {/* Fora do fundo do painel: um clique no modal não pode fechar o painel. */}
    {detalhe && <DetalhesCotacaoModal cotacao={detalhe} onClose={() => setDetalhe(null)} />}
    </>
  );
}

function Indicador({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-black/[0.06] bg-[#fafafa] px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-[#757575]">{label}</div>
      <div className="text-sm font-semibold text-[#212121]">{valor}</div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-3 border-b border-black/[0.06] pb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">{titulo}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="py-10 text-center text-sm text-[#757575]">{texto}</p>;
}

/* ---------------------------------------------------------------------------
   Novo fornecedor
   ------------------------------------------------------------------------- */

function NovoFornecedor({
  existentes,
  onExisting,
  onClose,
  onCreated,
}: {
  existentes: Supplier[];
  onExisting: (id: string) => void;
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  // O que já existe aparece ao digitar: escolher abre o cadastro em vez de duplicar.
  const sugestoes = useMemo<Suggestion[]>(
    () =>
      existentes.map((f) => ({
        value: f.name,
        alsoMatches: f.aliases,
        weight: f.summary.compras,
        hint: `Já cadastrado · ${f.summary.compras} compra${f.summary.compras === 1 ? '' : 's'}${f.active ? '' : ' · inativo'} — abrir`,
        meta: { id: f.id },
      })),
    [existentes],
  );
  const [nome, setNome] = useState('');
  const [doc, setDoc] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    setSalvando(true);
    setErro('');
    const res = await fetch('/api/compras/fornecedores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: nome, taxId: doc }),
    });
    const body = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) {
      setErro(body.error || 'Não foi possível cadastrar.');
      return;
    }
    toast.success('Fornecedor cadastrado. Complete o cadastro na aba Cadastro.');
    await onCreated(body.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6" role="dialog" aria-modal="true">
        <h3 className="text-lg font-semibold text-[#212121] mb-1">Novo fornecedor</h3>
        <p className="text-sm text-[#757575] mb-4">Os demais dados (contato, endereço, prazo) ficam na aba Cadastro.</p>
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#757575]">Nome *</span>
            <SugestaoInput
              value={nome}
              onChange={setNome}
              onPick={(s) => onExisting(String((s.meta as { id: string }).id))}
              suggestions={sugestoes}
              label="Já cadastrados"
              className={inputCls}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#757575]">CNPJ / CPF</span>
            <input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Opcional" />
          </label>
          {erro && <p className="text-xs text-red-700">{erro}</p>}
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-black/[0.08] text-sm font-medium text-[#212121] hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={criar}
            disabled={!nome.trim() || salvando}
            className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
          >
            {salvando ? 'Cadastrando…' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
