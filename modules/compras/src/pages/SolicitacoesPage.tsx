import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, RefreshCw, Search } from 'lucide-react';
import { useStore } from '@/store';
import { supabase } from '@/lib/supabase';
import type { PedidoMaterial } from '@/types';
import CotacaoModal from '@/components/CotacaoModal';

/**
 * Pedidos de material do Almoxarifado. O almoxarife pede; quem cota abre a
 * cotação a partir do pedido ("Cotar"), e a situação do pedido acompanha a
 * cotação sozinha (o banco atualiza e avisa o almoxarife a cada passo).
 */

type Filtro = 'abertos' | 'andamento' | 'todos';

const SITUACAO: Record<PedidoMaterial['status'], { label: string; cls: string }> = {
  aberta: { label: 'Aguardando cotação', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  em_cotacao: { label: 'Em cotação', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  aprovada: { label: 'Aprovada', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejeitada: { label: 'Rejeitada', cls: 'bg-red-50 text-red-700 border-red-200' },
  comprada: { label: 'Comprada · a caminho', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  parcial: { label: 'Recebida em parte', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  recebida: { label: 'Recebida', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  cancelada: { label: 'Cancelada', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const FILTROS: { value: Filtro; label: string; status: PedidoMaterial['status'][] | null }[] = [
  { value: 'abertos', label: 'Para cotar', status: ['aberta', 'em_cotacao', 'rejeitada'] },
  { value: 'andamento', label: 'Aprovados e comprados', status: ['aprovada', 'comprada', 'parcial'] },
  { value: 'todos', label: 'Todos', status: null },
];

const DIVISAO: Record<PedidoMaterial['divisao'], string> = { USINAGEM: 'Usinagem', FUNDICAO: 'Fundição', GERAL: 'Geral' };

type Row = {
  id: string; numero: number; divisao: PedidoMaterial['divisao']; urgencia: PedidoMaterial['urgencia']; observacao: string | null;
  status: PedidoMaterial['status']; created_at: string; requested_by_name: string | null;
  material_request_items: { produto: string; quantidade: number; unidade: string; observacao: string | null; ordem: number }[] | null;
};

export default function SolicitacoesPage() {
  const caps = useStore((state) => state.caps);
  const cotacoes = useStore((state) => state.cotacoes);
  const fetchInitialData = useStore((state) => state.fetchInitialData);
  const [pedidos, setPedidos] = useState<PedidoMaterial[] | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('abertos');
  const [busca, setBusca] = useState('');
  const [cotando, setCotando] = useState<PedidoMaterial | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('material_requests')
      .select('id, numero, divisao, urgencia, observacao, status, created_at, requested_by_name, material_request_items(produto, quantidade, unidade, observacao, ordem)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { setErro('Não foi possível carregar os pedidos.'); return; }
    setErro('');
    setPedidos(((data ?? []) as Row[]).map((r) => ({
      id: r.id, numero: Number(r.numero), divisao: r.divisao, urgencia: r.urgencia, observacao: r.observacao, status: r.status,
      createdAt: r.created_at, solicitante: r.requested_by_name,
      itens: [...(r.material_request_items ?? [])].sort((a, b) => a.ordem - b.ordem).map((i) => ({ produto: i.produto, quantidade: Number(i.quantidade), unidade: i.unidade, observacao: i.observacao })),
    })));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const visiveis = useMemo(() => {
    const regra = FILTROS.find((f) => f.value === filtro)?.status;
    const termo = busca.trim().toLowerCase();
    return (pedidos ?? []).filter((p) => (!regra || regra.includes(p.status))
      && (!termo || String(p.numero).includes(termo) || p.itens.some((i) => i.produto.toLowerCase().includes(termo)) || (p.solicitante ?? '').toLowerCase().includes(termo)));
  }, [pedidos, filtro, busca]);

  const contagem = (f: Filtro) => {
    const regra = FILTROS.find((x) => x.value === f)?.status;
    return (pedidos ?? []).filter((p) => !regra || regra.includes(p.status)).length;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212121]">Pedidos do Almoxarifado</h1>
          <p className="text-sm text-[#757575]">Material que está faltando. Cote a partir do pedido: o almoxarife acompanha cada passo e é avisado.</p>
        </div>
        <button type="button" onClick={() => void carregar()} className="flex items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 py-2 text-xs font-semibold text-[#555] hover:bg-slate-50">
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button key={f.value} type="button" onClick={() => setFiltro(f.value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${filtro === f.value ? 'border-primary bg-primary/10 text-primary' : 'border-black/[0.08] text-[#555] hover:bg-slate-50'}`}>
            {f.label} · {contagem(f.value)}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-1.5">
          <Search size={14} className="text-[#999]" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número, item ou quem pediu" className="w-56 text-xs outline-none bg-transparent" />
        </label>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {pedidos === null && !erro && <p className="text-sm text-[#757575]">Carregando pedidos…</p>}
      {pedidos !== null && !visiveis.length && (
        <div className="rounded-xl border border-dashed border-black/[0.12] p-8 text-center">
          <Package size={26} className="mx-auto text-[#bbb]" />
          <p className="mt-2 text-sm font-semibold text-[#212121]">Nenhum pedido neste filtro</p>
          <p className="text-xs text-[#757575]">Quando o Almoxarifado pedir material, o pedido aparece aqui e você recebe um aviso no sino.</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visiveis.map((p) => {
          const ligadas = cotacoes.filter((c) => c.materialRequestId === p.id && !c.deletedAt);
          const podeCotar = caps?.cotar && ['aberta', 'em_cotacao', 'rejeitada', 'aprovada'].includes(p.status);
          return (
            <article key={p.id} className="flex flex-col gap-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[#212121]">
                    Pedido #{p.numero}
                    {p.urgencia === 'urgente' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">URGENTE</span>}
                  </p>
                  <p className="text-xs text-[#757575]">{DIVISAO[p.divisao]} · {p.solicitante ?? 'Almoxarifado'} · {new Date(p.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${SITUACAO[p.status].cls}`}>{SITUACAO[p.status].label}</span>
              </header>
              <ul className="space-y-1 text-xs text-[#212121]">
                {p.itens.map((i, idx) => <li key={idx}><b>{i.quantidade.toLocaleString('pt-BR')} {i.unidade}</b> · {i.produto}{i.observacao && <span className="text-[#757575]"> — {i.observacao}</span>}</li>)}
              </ul>
              {p.observacao && <p className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-[#555]">{p.observacao}</p>}
              {ligadas.length > 0 && (
                <p className="text-xs text-[#757575]">Cotações: {ligadas.map((c) => `#${c.id} ${c.fornecedor} (${c.status.toLowerCase()})`).join(' · ')}</p>
              )}
              {podeCotar && (
                <button type="button" onClick={() => setCotando(p)} className="mt-auto rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:opacity-90">
                  {ligadas.length ? 'Cotar com outro fornecedor' : 'Cotar'}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {cotando && (
        <CotacaoModal cotacao={null} pedido={cotando} onClose={() => { setCotando(null); void fetchInitialData(); void carregar(); }} />
      )}
    </div>
  );
}
