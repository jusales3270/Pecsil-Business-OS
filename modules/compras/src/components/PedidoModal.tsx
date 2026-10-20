import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Link2, Send, ShoppingCart, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Compra, Cotacao, PedidoMaterial } from '@/types';
import EscolherFornecedor, { type FornecedorEscolhido } from '@/components/EscolherFornecedor';
import { ROTULO_ESTADO, estadoDosItens, numeroBr, podeEncaminhar, type EstadoItem } from '../../../../lib/compras/ramos';
import { rotuloCompra } from '../../../../lib/compras/rotulo';

/**
 * Pedido de material aberto no Compras (pedido do proprietário, 20/10/2026): os itens em lista para
 * marcar. Os marcados vão a UM fornecedor: "Encaminhar para cotação" cria o ramo (aguardando preço) e
 * "Compra imediata" compra sem cotação, com quem autorizou escolhido na lista de quem aprova compras.
 */
export type Ramo = {
  id: string; materialRequestId: string; fornecedor: string; supplierId: string | null;
  situacao: 'aguardando' | 'cotado' | 'cancelado'; cotacaoId: number | null; itens: string[];
  criadoPorNome: string | null; createdAt: string;
};
export type ConviteDoPedido = { id: string; ramo_id: string | null; fornecedor: string; situacao: 'aberto' | 'respondido' | 'cancelado'; expira_em: string };

const COR: Record<EstadoItem, string> = {
  aberto: 'bg-amber-50 text-amber-700 border-amber-200',
  em_cotacao: 'bg-blue-50 text-blue-700 border-blue-200',
  aprovado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  comprado: 'bg-violet-50 text-violet-700 border-violet-200',
  rejeitado: 'bg-red-50 text-red-700 border-red-200',
};
const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Situação do item dentro de uma cotação, em palavras. */
function situacaoNaCotacao(c: Cotacao, statusItem: string | undefined): string {
  if (c.origem === 'direta') return `compra imediata${c.autorizadoPor ? ` · autorizada por ${c.autorizadoPor}` : ''}`;
  if (statusItem === 'REJEITADO') return 'rejeitado';
  if (statusItem === 'APROVADO') return c.status === 'COMPRADO' ? 'comprado' : 'aprovado';
  return 'aguardando aprovação';
}

export default function PedidoModal({ pedido, cotacoes, compras, ramos, convites, podeCotar, podeComprar, podeCadastrar, onClose, onMudou, onLancarPrecos, onMandarLink }: {
  pedido: PedidoMaterial; cotacoes: Cotacao[]; compras: Compra[]; ramos: Ramo[]; convites: ConviteDoPedido[];
  podeCotar: boolean; podeComprar: boolean; podeCadastrar: boolean;
  onClose: () => void; onMudou: () => void; onLancarPrecos: (r: Ramo) => void; onMandarLink: (r: Ramo) => void;
}) {
  const ligadas = useMemo(() => cotacoes.filter((c) => c.materialRequestId === pedido.id && !c.deletedAt), [cotacoes, pedido.id]);
  const estados = useMemo(() => estadoDosItens(pedido.itens.map((i) => i.id), ligadas, compras, ramos), [pedido.itens, ligadas, compras, ramos]);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [fornecedor, setFornecedor] = useState<FornecedorEscolhido | null>(null);
  const [modo, setModo] = useState<'itens' | 'imediata'>('itens');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const disponiveis = pedido.itens.filter((i) => podeEncaminhar(estados[i.id]));
  const todos = disponiveis.length > 0 && disponiveis.every((i) => marcados.includes(i.id));
  const alternar = (id: string) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const aguardando = ramos.filter((r) => r.situacao === 'aguardando');

  // Onde está cada item: ramos aguardando preço e cotações/OCs com ele.
  const ondeEsta = (itemId: string) => [
    ...aguardando.filter((r) => r.itens.includes(itemId)).map((r) => `${r.fornecedor} · aguardando preço`),
    ...ligadas.flatMap((c) => (c.produtos ?? []).filter((p) => p.pedidoItemId === itemId).map((p) => `${rotuloCompra(c, { curto: true })} · ${c.fornecedor} · ${situacaoNaCotacao(c, p.status)}`)),
  ];

  const encaminhar = async () => {
    if (!fornecedor) return;
    setOcupado(true); setErro('');
    const r = await fetch('/api/compras/ramos', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'criar', pedido: pedido.id, itens: marcados, fornecedorId: fornecedor.id }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setOcupado(false);
    if (!r.ok) { setErro(r.body?.error ?? 'Não foi possível encaminhar.'); return; }
    toast.success(`${marcados.length} item(ns) encaminhado(s) a ${fornecedor.nome}: aguardando preço.`);
    setMarcados([]); setFornecedor(null);
    onMudou();
  };
  const cancelarRamo = async (r: Ramo) => {
    setOcupado(true); setErro('');
    const x = await fetch('/api/compras/ramos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'cancelar', id: r.id }) })
      .then(async (y) => ({ ok: y.ok, body: await y.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setOcupado(false);
    if (!x.ok) { setErro(x.body?.error ?? 'Não foi possível cancelar.'); return; }
    toast.success(`Encaminhamento a ${r.fornecedor} cancelado.`);
    onMudou();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-label={`Pedido ${pedido.numero}`}>
      <div className="flex max-h-[92vh] w-full max-w-[760px] flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.08] px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#212121]">
              Pedido #{pedido.numero}
              {pedido.urgencia === 'urgente' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 align-middle text-[11px] font-bold text-red-700">URGENTE</span>}
            </h2>
            <p className="text-xs text-[#757575]">{pedido.origem === 'FUNDICAO' ? 'Fundição' : 'Almoxarifado'} · {pedido.solicitante ?? '—'} · {data(pedido.createdAt)}</p>
            {pedido.precisaAte && <p className="text-xs font-semibold text-amber-700">A produção precisa até {pedido.precisaAte.split('-').reverse().join('/')}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#757575] hover:bg-gray-100"><X size={18} /></button>
        </div>

        {modo === 'itens' ? (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {pedido.observacao && <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-[#555]">{pedido.observacao}</p>}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#212121]">Itens do pedido</h3>
                  {podeCotar && disponiveis.length > 1 && (
                    <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setMarcados(todos ? [] : disponiveis.map((i) => i.id))}>
                      {todos ? 'Desmarcar todos' : 'Marcar todos'}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-black/[0.06] rounded-lg border border-black/[0.08]">
                  {pedido.itens.map((i) => {
                    const estado = estados[i.id] ?? 'aberto';
                    const pode = podeCotar && podeEncaminhar(estado);
                    const onde = ondeEsta(i.id);
                    return (
                      <li key={i.id}>
                        <label className={`flex items-start gap-3 px-3 py-2.5 ${pode ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-primary,#2563eb)]" disabled={!pode} checked={marcados.includes(i.id)} onChange={() => alternar(i.id)} aria-label={`Marcar ${i.produto}`} />
                          <span className="min-w-0 flex-1">
                            <span className="text-sm text-[#212121]"><b>{i.quantidade.toLocaleString('pt-BR')} {i.unidade}</b> · {i.produto}</span>
                            {i.observacao && <span className="text-xs text-[#757575]"> — {i.observacao}</span>}
                            {onde.map((o, k) => <span key={k} className="block text-xs text-[#757575]">→ {o}</span>)}
                          </span>
                          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${COR[estado]}`}>{ROTULO_ESTADO[estado]}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {aguardando.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-[#212121]">Aguardando preço</h3>
                  {aguardando.map((r) => {
                    const link = convites.find((c) => c.ramo_id === r.id && c.situacao === 'aberto' && new Date(c.expira_em) >= new Date());
                    return (
                      <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#212121]">{r.fornecedor}</p>
                          <p className="text-xs text-[#757575]">
                            {pedido.itens.filter((i) => r.itens.includes(i.id)).map((i) => i.produto).join(', ')} · desde {data(r.createdAt)}
                            {link ? ` · link aberto até ${data(link.expira_em)}` : ''}
                          </p>
                        </div>
                        {podeCotar && (
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => onLancarPrecos(r)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Lançar preços</button>
                            <button type="button" onClick={() => onMandarLink(r)} className="flex items-center gap-1 rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"><Link2 size={13} /> Mandar link</button>
                            <button type="button" disabled={ocupado} onClick={() => void cancelarRamo(r)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">Cancelar</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              )}
            </div>

            {podeCotar && (
              <div className="space-y-3 border-t border-black/[0.08] bg-slate-50 px-6 py-4">
                {erro && <p className="text-xs font-semibold text-red-600" role="alert">{erro}</p>}
                {marcados.length ? (
                  <>
                    <p className="text-xs font-semibold text-[#555]">{marcados.length} item(ns) marcado(s) · fornecedor</p>
                    <EscolherFornecedor valor={fornecedor} onEscolher={setFornecedor} podeCadastrar={podeCadastrar} />
                    <div className="flex flex-wrap justify-end gap-2">
                      {podeComprar && (
                        <button type="button" disabled={!fornecedor || ocupado} onClick={() => { setErro(''); setModo('imediata'); }}
                          className="flex items-center gap-1.5 rounded-lg border border-violet-500 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40">
                          <ShoppingCart size={15} /> Compra imediata
                        </button>
                      )}
                      <button type="button" disabled={!fornecedor || ocupado} onClick={() => void encaminhar()}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
                        <Send size={15} /> {ocupado ? 'Encaminhando…' : 'Encaminhar para cotação'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-[#757575]">{disponiveis.length ? 'Marque os itens que vão para o mesmo fornecedor. Depois escolha o fornecedor e encaminhe para cotar, ou faça a compra imediata.' : 'Todos os itens deste pedido já foram comprados.'}</p>
                )}
              </div>
            )}
          </>
        ) : (
          fornecedor && (
            <CompraImediata pedido={pedido} itens={pedido.itens.filter((i) => marcados.includes(i.id))} fornecedor={fornecedor}
              onVoltar={() => setModo('itens')}
              onFeita={(oc, autorizador) => {
                toast.success(`OC nº ${oc} registrada · compra imediata autorizada por ${autorizador}.`);
                setMarcados([]); setFornecedor(null); setModo('itens'); onMudou();
              }} />
          )
        )}
      </div>
    </div>
  );
}

type Autorizador = { id: string; nome: string };

/** Compra imediata: primeiro quem autorizou (da lista de quem aprova compras), depois os preços. */
function CompraImediata({ pedido, itens, fornecedor, onVoltar, onFeita }: {
  pedido: PedidoMaterial; itens: PedidoMaterial['itens']; fornecedor: FornecedorEscolhido;
  onVoltar: () => void; onFeita: (oc: number, autorizador: string) => void;
}) {
  const [autorizadores, setAutorizadores] = useState<Autorizador[] | null>(null);
  const [autorizador, setAutorizador] = useState<Autorizador | null>(null);
  const [linhas, setLinhas] = useState(() => itens.map((i) => ({ id: i.id, produto: i.produto, unidade: i.unidade, material: i.material ?? null, quantidade: String(i.quantidade).replace('.', ','), valor: '' })));
  const [freteTipo, setFreteTipo] = useState<'CIF' | 'FOB' | 'SEM'>('CIF');
  const [frete, setFrete] = useState('');
  const [entrega, setEntrega] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void fetch('/api/compras/autorizadores', { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then((r) => { if (!vivo) return; if (r.ok) setAutorizadores(r.body?.autorizadores ?? []); else setErro(r.body?.error ?? 'Não foi possível carregar quem autoriza.'); })
      .catch(() => { if (vivo) setErro('Não foi possível carregar quem autoriza.'); });
    return () => { vivo = false; };
  }, []);

  const precosOk = linhas.every((l) => numeroBr(l.quantidade) > 0 && numeroBr(l.valor) > 0);
  // Como na OC: o frete digitado soma no total (o tipo CIF/FOB é informativo).
  const total = linhas.reduce((s, l) => s + (numeroBr(l.quantidade) || 0) * (numeroBr(l.valor) || 0), 0) + (numeroBr(frete) || 0);
  const mudar = (id: string, campo: 'quantidade' | 'valor', v: string) => setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, [campo]: v } : l)));

  const comprar = async () => {
    if (!autorizador || !precosOk) return;
    setSalvando(true); setErro('');
    const r = await fetch('/api/compras/diretas', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: fornecedor.id, fornecedor: fornecedor.nome, material_request_id: pedido.id, autorizado_por_id: autorizador.id,
        frete_tipo: freteTipo, frete_valor: numeroBr(frete) || 0, prazo_entrega: entrega || null, observacao: observacao.trim(),
        itens: linhas.map((l) => ({ produto: l.produto, quantidade: numeroBr(l.quantidade), unidade: l.unidade, valor_unit: numeroBr(l.valor), material_id: l.material?.id ?? null, pedido_item_id: l.id })),
      }) }).then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setSalvando(false);
    if (!r.ok) { setErro(r.body?.error ?? 'Não foi possível registrar a compra.'); return; }
    onFeita(Number(r.body?.id), autorizador.nome);
  };

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16} /> Quem autorizou esta compra imediata?</p>
          <p className="text-xs text-amber-800">A compra imediata pula a cotação e a aprovação. Fica registrado no histórico quem registrou e quem autorizou, e quem autorizou recebe um aviso.</p>
          {!autorizadores && !erro && <p className="text-xs text-[#757575]">Carregando…</p>}
          {autorizadores && !autorizadores.length && <p className="text-xs font-semibold text-red-600">Ninguém tem a permissão de aprovar compras. Peça ao administrador.</p>}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Quem autorizou">
            {(autorizadores ?? []).map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={autorizador?.id === a.id} onClick={() => setAutorizador(a)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${autorizador?.id === a.id ? 'border-amber-600 bg-amber-50 text-amber-800 shadow-sm' : 'border-amber-200 bg-white text-[#555] hover:bg-slate-50'}`}>
                {autorizador?.id === a.id && <Check size={14} />} {a.nome}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-[#555]">Compra com <b className="text-[#212121]">{fornecedor.nome}</b> · pedido #{pedido.numero}</p>
          {/* Celular: um cartão por item (quantidade e preço à vista). */}
          <ul className="space-y-2 sm:hidden">
            {linhas.map((l) => (
              <li key={l.id} className="space-y-2 rounded-lg border border-black/[0.08] p-3">
                <p className="text-sm font-semibold text-[#212121]">{l.produto}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5 text-xs text-[#555]">Quantidade ({l.unidade})
                    <input value={l.quantidade} onChange={(e) => mudar(l.id, 'quantidade', e.target.value)} inputMode="decimal" aria-label={`Quantidade de ${l.produto}`} className="w-full rounded-md border border-black/[0.12] px-2 py-1.5 text-right text-sm" />
                  </label>
                  <label className="flex flex-col gap-0.5 text-xs text-[#555]">Valor unitário (R$)
                    <input value={l.valor} onChange={(e) => mudar(l.id, 'valor', e.target.value)} inputMode="decimal" placeholder="0,00" aria-label={`Valor unitário de ${l.produto}`} className="w-full rounded-md border border-black/[0.12] px-2 py-1.5 text-right text-sm" />
                  </label>
                </div>
                <p className="text-right text-xs text-[#555]">Total <b className="tabular-nums text-[#212121]">{dinheiro((numeroBr(l.quantidade) || 0) * (numeroBr(l.valor) || 0))}</b></p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-black/[0.08] sm:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-[#757575]">
                <tr><th className="px-3 py-2 font-semibold">Item</th><th className="px-3 py-2 text-right font-semibold">Quantidade</th><th className="px-3 py-2 font-semibold">Unid.</th><th className="px-3 py-2 text-right font-semibold">Valor unitário (R$)</th><th className="px-3 py-2 text-right font-semibold">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {linhas.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-[#212121]">{l.produto}</td>
                    <td className="px-3 py-2 text-right"><input value={l.quantidade} onChange={(e) => mudar(l.id, 'quantidade', e.target.value)} inputMode="decimal" aria-label={`Quantidade de ${l.produto} (tabela)`} className="w-24 rounded-md border border-black/[0.12] px-2 py-1 text-right" /></td>
                    <td className="px-3 py-2 text-[#555]">{l.unidade}</td>
                    <td className="px-3 py-2 text-right"><input value={l.valor} onChange={(e) => mudar(l.id, 'valor', e.target.value)} inputMode="decimal" placeholder="0,00" aria-label={`Valor unitário de ${l.produto} (tabela)`} className="w-28 rounded-md border border-black/[0.12] px-2 py-1 text-right" /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#212121]">{dinheiro((numeroBr(l.quantidade) || 0) * (numeroBr(l.valor) || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* O select fica dentro de um span: a regra geral de "rótulo + select na horizontal" não pega aqui. */}
          <label className="flex flex-col gap-0.5 text-xs text-[#555]">Frete
            <span className="block">
              <select value={freteTipo} onChange={(e) => setFreteTipo(e.target.value as 'CIF' | 'FOB' | 'SEM')} className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm">
                <option value="CIF">CIF (fornecedor paga)</option><option value="FOB">FOB (nós pagamos)</option><option value="SEM">Sem frete</option>
              </select>
            </span>
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-[#555]">Valor do frete<input value={frete} onChange={(e) => setFrete(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" /></label>
          <label className="flex flex-col gap-0.5 text-xs text-[#555]">Entrega prevista<input type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" /></label>
          <label className="flex flex-col gap-0.5 text-xs text-[#555] sm:col-span-3">Observação (sai na OC)<input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" /></label>
        </div>
      </div>
      <div className="space-y-2 border-t border-black/[0.08] bg-slate-50 px-6 py-4">
        {erro && <p className="text-xs font-semibold text-red-600" role="alert">{erro}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#555]">Total <b className="tabular-nums text-[#212121]">{dinheiro(total)}</b></p>
          <div className="flex gap-2">
            <button type="button" onClick={onVoltar} disabled={salvando} className="rounded-lg px-4 py-2 text-sm font-semibold text-[#555] hover:bg-slate-100">Voltar</button>
            <button type="button" disabled={!autorizador || !precosOk || salvando} onClick={() => void comprar()}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
              <ShoppingCart size={15} /> {salvando ? 'Registrando…' : 'Comprar'}
            </button>
          </div>
        </div>
        {(!autorizador || !precosOk) && <p className="text-right text-xs text-[#757575]">{!autorizador ? 'Escolha quem autorizou para liberar a compra.' : 'Preencha a quantidade e o valor de cada item.'}</p>}
      </div>
    </>
  );
}
