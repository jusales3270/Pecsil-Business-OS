import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Package, RefreshCw, Search } from 'lucide-react';
import { useStore } from '@/store';
import { supabase } from '@/lib/supabase';
import type { Divisao, PedidoMaterial } from '@/types';
import CotacaoModal from '@/components/CotacaoModal';
import ConviteFornecedorModal from '@/components/ConviteFornecedorModal';
import DivisaoTabs from '@/components/DivisaoTabs';
import PedidoModal, { type Ramo } from '@/components/PedidoModal';
import { ROTULO_ESTADO, estadoDosItens } from '../../../../lib/compras/ramos';

/**
 * Pedidos de material: do Almoxarifado (Henrique, para Usinagem ou Fundição) e da
 * Fundição (Guilherme, pelo painel dela). Separados por divisão como as cotações.
 * Clicar no pedido abre os itens em lista: os marcados vão a um fornecedor, para cotar
 * (ramo "aguardando preço") ou em compra imediata. A situação de cada item e do pedido
 * acompanha as cotações sozinha (o banco atualiza e avisa quem pediu a cada passo).
 */

type Filtro = 'abertos' | 'andamento' | 'todos';
type Convite = { id: string; material_request_id: string; ramo_id: string | null; fornecedor: string; situacao: 'aberto' | 'respondido' | 'cancelado'; expira_em: string; cotacao_id: number | null; aberto_em: string | null; respondido_em: string | null };

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

/** Divisão da aba: pedidos antigos "Geral" ficam junto da Usinagem. */
const divisaoDaAba = (p: PedidoMaterial): Divisao => (p.divisao === 'FUNDICAO' ? 'FUNDICAO' : 'USINAGEM');
const ORIGEM: Record<PedidoMaterial['origem'], string> = { ALMOXARIFADO: 'Almoxarifado', FUNDICAO: 'Fundição' };

type Row = {
  id: string; numero: number; divisao: PedidoMaterial['divisao']; origem: PedidoMaterial['origem'] | null; urgencia: PedidoMaterial['urgencia']; observacao: string | null;
  status: PedidoMaterial['status']; created_at: string; requested_by_name: string | null; precisa_ate: string | null;
  material_request_items: { id: string; produto: string; quantidade: number; unidade: string; observacao: string | null; ordem: number; material_id: string | null; materials: MatRow | MatRow[] | null }[] | null;
};
type MatRow = { codigo: string; descricao: string; unidade: string };
type RamoRow = { id: string; material_request_id: string; fornecedor: string; supplier_id: string | null; situacao: Ramo['situacao']; cotacao_id: number | null; criado_por_nome: string | null; created_at: string; compras_ramo_itens: { item_id: string }[] | null };
const COR_ESTADO: Record<string, string> = { aberto: 'text-amber-700', em_cotacao: 'text-blue-700', aprovado: 'text-emerald-700', comprado: 'text-violet-700', rejeitado: 'text-red-700' };
const umMaterial = (id: string | null, m: MatRow | MatRow[] | null) => { const x = Array.isArray(m) ? m[0] : m; return id && x ? { id, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade } : null; };

export default function SolicitacoesPage() {
  const caps = useStore((state) => state.caps);
  const cotacoes = useStore((state) => state.cotacoes);
  const compras = useStore((state) => state.compras);
  const currentDivisao = useStore((state) => state.currentDivisao);
  const fetchInitialData = useStore((state) => state.fetchInitialData);
  const [pedidos, setPedidos] = useState<PedidoMaterial[] | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('abertos');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [cotando, setCotando] = useState<{ pedido: PedidoMaterial; ramo: Ramo } | null>(null);
  const [convidando, setConvidando] = useState<{ pedido: PedidoMaterial; ramo: Ramo } | null>(null);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [ramos, setRamos] = useState<Ramo[]>([]);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('material_requests')
      .select('id, numero, divisao, origem, urgencia, observacao, status, created_at, requested_by_name, precisa_ate, material_request_items(id, produto, quantidade, unidade, observacao, ordem, material_id, materials(codigo, descricao, unidade))')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { setErro('Não foi possível carregar os pedidos.'); return; }
    setErro('');
    // Convites por link (A-09) dos pedidos carregados.
    const ids = (data ?? []).map((r) => (r as { id: string }).id);
    if (ids.length) void fetch(`/api/compras/convites?pedidos=${ids.join(',')}`, { cache: 'no-store' }).then((x) => x.json()).then((b) => setConvites((b?.convites ?? []) as Convite[])).catch(() => setConvites([]));
    // Ramos (itens encaminhados a um fornecedor) dos pedidos carregados.
    if (ids.length) void supabase.from('compras_ramos').select('id, material_request_id, fornecedor, supplier_id, situacao, cotacao_id, criado_por_nome, created_at, compras_ramo_itens(item_id)')
      .in('material_request_id', ids).neq('situacao', 'cancelado')
      .then(({ data: rs }) => setRamos(((rs ?? []) as RamoRow[]).map((r) => ({ id: r.id, materialRequestId: r.material_request_id, fornecedor: r.fornecedor, supplierId: r.supplier_id,
        situacao: r.situacao, cotacaoId: r.cotacao_id, itens: (r.compras_ramo_itens ?? []).map((x) => x.item_id), criadoPorNome: r.criado_por_nome, createdAt: r.created_at }))));
    setPedidos(((data ?? []) as Row[]).map((r) => ({
      id: r.id, numero: Number(r.numero), divisao: r.divisao, origem: r.origem === 'FUNDICAO' ? 'FUNDICAO' : 'ALMOXARIFADO', urgencia: r.urgencia, observacao: r.observacao, status: r.status,
      createdAt: r.created_at, solicitante: r.requested_by_name, precisaAte: r.precisa_ate,
      itens: [...(r.material_request_items ?? [])].sort((a, b) => a.ordem - b.ordem).map((i) => ({ id: i.id, produto: i.produto, quantidade: Number(i.quantidade), unidade: i.unidade, observacao: i.observacao, material: umMaterial(i.material_id, i.materials) })),
    })));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  // Filtro de situação e busca; a divisão é a aba (Usinagem / Fundição), como nas cotações.
  const filtrados = useMemo(() => {
    const regra = FILTROS.find((f) => f.value === filtro)?.status;
    const termo = busca.trim().toLowerCase();
    return (pedidos ?? []).filter((p) => (!regra || regra.includes(p.status))
      && (!termo || String(p.numero).includes(termo) || p.itens.some((i) => i.produto.toLowerCase().includes(termo)) || (p.solicitante ?? '').toLowerCase().includes(termo)));
  }, [pedidos, filtro, busca]);
  const visiveis = useMemo(() => filtrados.filter((p) => divisaoDaAba(p) === currentDivisao), [filtrados, currentDivisao]);
  const porDivisao = useMemo(() => ({
    USINAGEM: filtrados.filter((p) => divisaoDaAba(p) === 'USINAGEM').length,
    FUNDICAO: filtrados.filter((p) => divisaoDaAba(p) === 'FUNDICAO').length,
  }), [filtrados]);

  const convitesDo = (id: string) => convites.filter((c) => c.material_request_id === id);
  const ramosDo = (id: string) => ramos.filter((r) => r.materialRequestId === id);
  const pedidoAberto = (pedidos ?? []).find((p) => p.id === aberto) ?? null;
  const recarregar = () => { void fetchInitialData(); void carregar(); };
  const cancelarConvite = async (id: string) => {
    const r = await fetch('/api/compras/convites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'cancelar', id }) });
    if (!r.ok) { setErro((await r.json().catch(() => null))?.error ?? 'Não foi possível cancelar o convite.'); return; }
    void carregar();
  };

  const contagem = (f: Filtro) => {
    const regra = FILTROS.find((x) => x.value === f)?.status;
    return (pedidos ?? []).filter((p) => divisaoDaAba(p) === currentDivisao && (!regra || regra.includes(p.status))).length;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212121]">Pedidos almoxarifado</h1>
          <p className="text-sm text-[#757575]">Material que está faltando, pedido pelo Almoxarifado ou pela Fundição. Cote a partir do pedido: quem pediu acompanha cada passo e é avisado.</p>
        </div>
        <button type="button" onClick={() => void carregar()} className="flex items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 py-2 text-xs font-semibold text-[#555] hover:bg-slate-50">
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      <DivisaoTabs counts={porDivisao} />

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
          <p className="text-xs text-[#757575]">{currentDivisao === 'FUNDICAO' ? 'Quando o Almoxarifado ou a Fundição pedirem material para a Fundição' : 'Quando o Almoxarifado pedir material para a Usinagem'}, o pedido aparece aqui e você recebe um aviso no sino.</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visiveis.map((p) => {
          const ligadas = cotacoes.filter((c) => c.materialRequestId === p.id && !c.deletedAt);
          const estados = estadoDosItens(p.itens.map((i) => i.id), ligadas, compras, ramosDo(p.id));
          const fornecedoresDo = (itemId: string) => [...new Set([
            ...ramosDo(p.id).filter((r) => r.situacao === 'aguardando' && r.itens.includes(itemId)).map((r) => r.fornecedor),
            ...ligadas.filter((c) => (c.produtos ?? []).some((x) => x.pedidoItemId === itemId)).map((c) => c.fornecedor),
          ])];
          const abrir = () => setAberto(p.id);
          return (
            <article key={p.id} role="button" tabIndex={0} aria-label={`Abrir o pedido ${p.numero}`} onClick={abrir} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } }}
              className="flex cursor-pointer flex-col gap-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[#212121]">
                    Pedido #{p.numero}
                    {p.urgencia === 'urgente' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">URGENTE</span>}
                  </p>
                  <p className="text-xs text-[#757575]">{ORIGEM[p.origem]} · {p.solicitante ?? '—'} · {new Date(p.createdAt).toLocaleDateString('pt-BR')}</p>
                  {p.precisaAte && <p className="text-xs font-semibold text-amber-700">A produção precisa até {p.precisaAte.split('-').reverse().join('/')}</p>}
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${SITUACAO[p.status].cls}`}>{SITUACAO[p.status].label}</span>
              </header>
              <ul className="space-y-1.5 text-xs text-[#212121]">
                {p.itens.map((i) => {
                  const estado = estados[i.id] ?? 'aberto';
                  const quem = fornecedoresDo(i.id);
                  return (
                    <li key={i.id}>
                      <b>{i.quantidade.toLocaleString('pt-BR')} {i.unidade}</b> · {i.produto}{i.observacao && <span className="text-[#757575]"> — {i.observacao}</span>}
                      <span className={`block text-[11px] font-semibold ${COR_ESTADO[estado]}`}>{ROTULO_ESTADO[estado]}{quem.length ? ` · ${quem.join(', ')}` : ''}</span>
                    </li>
                  );
                })}
              </ul>
              {/* Resposta do fornecedor pelo link: aparece aqui, sem aviso no sino, enquanto a cotação aguarda aprovação. */}
              {convitesDo(p.id).filter((c) => c.situacao === 'respondido').map((c) => {
                const cot = ligadas.find((x) => x.id === c.cotacao_id);
                if (cot && cot.status !== 'PENDENTE') return null;
                const n = cot?.produtos?.length ?? 0;
                return (
                  <p key={c.id} className="flex items-start gap-1.5 rounded-lg border border-green-200 bg-green-50 px-2.5 py-2 text-xs text-green-700">
                    <CheckCircle size={14} className="mt-px shrink-0" />
                    <span><b>{c.fornecedor} respondeu pelo link</b> · cotação nº {c.cotacao_id}{n ? ` · ${n} item(ns)` : ''}{c.respondido_em ? ` · ${new Date(c.respondido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}. Aguardando aprovação.</span>
                  </p>
                );
              })}
              {p.observacao && <p className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-[#555]">{p.observacao}</p>}
              {ligadas.length > 0 && (
                <p className="text-xs text-[#757575]">Cotações: {ligadas.map((c) => `#${c.id} ${c.fornecedor} (${c.origem === 'direta' ? 'compra imediata' : c.status.toLowerCase()})`).join(' · ')}</p>
              )}
              {convitesDo(p.id).some((c) => c.situacao !== 'respondido') && (
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-[#555]">Convites por link</p>
                  {convitesDo(p.id).filter((c) => c.situacao !== 'respondido').map((c) => (
                    <p key={c.id} className="flex flex-wrap items-center gap-x-2 text-[#757575]">
                      <span className="text-[#212121]">{c.fornecedor}</span>
                      {c.situacao === 'respondido' ? <span className="text-emerald-700">respondeu · cotação #{c.cotacao_id}</span>
                        : c.situacao === 'cancelado' ? <span>cancelado</span>
                        : new Date(c.expira_em) < new Date() ? <span>venceu em {new Date(c.expira_em).toLocaleDateString('pt-BR')}</span>
                        : <><span className="text-blue-700">aberto até {new Date(c.expira_em).toLocaleDateString('pt-BR')}{c.aberto_em ? ' · já abriu o link' : ''}</span>
                          {caps?.cotar && <button type="button" className="font-semibold text-red-600 hover:underline" onClick={(e) => { e.stopPropagation(); void cancelarConvite(c.id); }}>Cancelar</button>}</>}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-auto">
                <span className="block w-full rounded-lg bg-primary px-3 py-2 text-center text-xs font-semibold text-white">
                  {caps?.cotar && p.itens.some((i) => estados[i.id] !== 'comprado') ? 'Abrir pedido: cotar ou comprar' : 'Ver pedido'}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {pedidoAberto && (
        <PedidoModal pedido={pedidoAberto} cotacoes={cotacoes} compras={compras} ramos={ramosDo(pedidoAberto.id)} convites={convitesDo(pedidoAberto.id)}
          podeCotar={Boolean(caps?.cotar)} podeComprar={Boolean(caps?.cotar || caps?.comprar)} podeCadastrar={Boolean(caps?.editarFornecedores)}
          onClose={() => setAberto(null)} onMudou={recarregar}
          onLancarPrecos={(ramo) => setCotando({ pedido: pedidoAberto, ramo })}
          onMandarLink={(ramo) => setConvidando({ pedido: pedidoAberto, ramo })} />
      )}
      {convidando && (
        <ConviteFornecedorModal pedido={convidando.pedido} ramo={{ id: convidando.ramo.id, fornecedor: convidando.ramo.fornecedor, supplierId: convidando.ramo.supplierId, itens: convidando.ramo.itens.length }}
          onClose={(mudou) => { setConvidando(null); if (mudou) void carregar(); }} />
      )}
      {cotando && (
        <CotacaoModal cotacao={null} pedido={cotando.pedido} ramo={{ id: cotando.ramo.id, fornecedor: cotando.ramo.fornecedor, itemIds: cotando.ramo.itens }}
          onClose={() => { setCotando(null); recarregar(); }} />
      )}
    </div>
  );
}
