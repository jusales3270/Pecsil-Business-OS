import { useEffect, useState } from 'react';
import { Check, Copy, Link2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { PedidoMaterial } from '@/types';

/**
 * Convidar fornecedor por link (A-09). Gera um link só deste pedido e deste fornecedor, com validade;
 * o fornecedor responde sem login e a resposta vira uma cotação pendente ligada ao pedido. O link só
 * aparece aqui, na hora: o banco guarda apenas o hash.
 */

type Fornecedor = { id: string; nome: string; email: string | null; telefone: string | null };
type Gerado = { link: string; fornecedor: string; expiraEm: string };

export default function ConviteFornecedorModal({ pedido, onClose }: { pedido: PedidoMaterial; onClose: (mudou: boolean) => void }) {
  const [busca, setBusca] = useState('');
  const [opcoes, setOpcoes] = useState<Fornecedor[]>([]);
  const [escolhido, setEscolhido] = useState<Fornecedor | null>(null);
  const [dias, setDias] = useState(7);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [gerado, setGerado] = useState<Gerado | null>(null);
  const [copiado, setCopiado] = useState<'link' | 'mensagem' | null>(null);

  useEffect(() => {
    const termo = busca.trim();
    if (escolhido || termo.length < 2) { const t = setTimeout(() => setOpcoes([]), 0); return () => clearTimeout(t); }
    let vivo = true;
    const t = setTimeout(() => {
      void supabase.from('suppliers').select('id, name, trade_name, email, phone').eq('active', true).is('merged_into', null)
        .or(`name.ilike.%${termo.replace(/[%,()]/g, ' ')}%,trade_name.ilike.%${termo.replace(/[%,()]/g, ' ')}%`).order('name').limit(8)
        .then(({ data }) => { if (vivo) setOpcoes((data ?? []).map((s) => ({ id: s.id, nome: s.trade_name || s.name, email: s.email, telefone: s.phone }))); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, escolhido]);

  const gerar = async () => {
    setOcupado(true); setErro('');
    const r = await fetch('/api/compras/convites', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'criar', pedido: pedido.id, fornecedorId: escolhido?.id ?? null, fornecedor: escolhido?.nome ?? busca.trim(), dias }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setOcupado(false);
    if (!r.ok) { setErro(r.body?.error ?? 'Não foi possível gerar o link.'); return; }
    setGerado(r.body as Gerado);
  };
  const validade = gerado ? new Date(gerado.expiraEm).toLocaleDateString('pt-BR') : '';
  const mensagem = gerado
    ? `Olá! Temos um pedido de cotação (nº ${pedido.numero}) para ${gerado.fornecedor}. Responda pelo link, até ${validade}: ${gerado.link}`
    : '';
  const copiar = async (texto: string, qual: 'link' | 'mensagem') => {
    try { await navigator.clipboard.writeText(texto); setCopiado(qual); setTimeout(() => setCopiado(null), 2000); } catch { setErro('Não deu para copiar: selecione o texto e copie à mão.'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-label="Convidar fornecedor">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[560px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.08]">
          <h2 className="text-lg font-semibold text-[#212121]">Convidar fornecedor · pedido #{pedido.numero}</h2>
          <button type="button" onClick={() => onClose(Boolean(gerado))} aria-label="Fechar" className="w-8 h-8 rounded-lg flex items-center justify-center text-[#757575] hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {!gerado ? (
            <>
              <p className="text-xs text-[#757575]">O fornecedor recebe um link só deste pedido, responde sem login (preço, IPI, prazo, frete e pagamento, com o PDF da proposta) e a resposta vira uma cotação pendente aqui. O link aceita uma resposta.</p>
              <label className="block">
                <span className="text-xs font-semibold text-[#555]">Fornecedor</span>
                {escolhido ? (
                  <div className="mt-1 flex items-center justify-between rounded-lg border border-black/[0.12] px-3 py-2 text-sm">
                    <span><b>{escolhido.nome}</b>{escolhido.email ? <span className="text-[#757575]"> · {escolhido.email}</span> : null}</span>
                    <button type="button" className="text-xs font-semibold text-primary" onClick={() => { setEscolhido(null); setBusca(''); }}>Trocar</button>
                  </div>
                ) : (
                  <>
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Busque no cadastro ou digite o nome" className="mt-1 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" />
                    {opcoes.length > 0 && (
                      <div className="mt-1 rounded-lg border border-black/[0.08] divide-y divide-black/[0.06]">
                        {opcoes.map((o) => <button key={o.id} type="button" onClick={() => setEscolhido(o)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"><b>{o.nome}</b>{o.email ? <span className="text-[#757575]"> · {o.email}</span> : null}</button>)}
                      </div>
                    )}
                    {busca.trim().length >= 2 && !opcoes.length && <p className="mt-1 text-xs text-[#757575]">Fora do cadastro: o link sai com este nome.</p>}
                  </>
                )}
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-[#555]">Validade do link</span>
                <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm">
                  {[3, 5, 7, 10, 15].map((d) => <option key={d} value={d}>{d} dias</option>)}
                </select>
              </label>
              {erro && <p className="text-xs font-semibold text-red-600" role="alert">{erro}</p>}
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><Check size={16} /> Link gerado para {gerado.fornecedor}, válido até {validade}.</p>
              <div>
                <span className="text-xs font-semibold text-[#555]">Link</span>
                <div className="mt-1 flex gap-2">
                  <input readOnly value={gerado.link} onFocus={(e) => e.target.select()} className="w-full rounded-lg border border-black/[0.12] bg-slate-50 px-3 py-2 text-xs font-mono" aria-label="Link da cotação" />
                  <button type="button" onClick={() => void copiar(gerado.link, 'link')} className="flex shrink-0 items-center gap-1 rounded-lg border border-black/[0.12] px-3 text-xs font-semibold text-[#212121] hover:bg-slate-50"><Copy size={14} />{copiado === 'link' ? 'Copiado' : 'Copiar'}</button>
                </div>
              </div>
              <div>
                <span className="text-xs font-semibold text-[#555]">Mensagem pronta (e-mail ou WhatsApp)</span>
                <textarea readOnly rows={4} value={mensagem} onFocus={(e) => e.target.select()} className="mt-1 w-full rounded-lg border border-black/[0.12] bg-slate-50 px-3 py-2 text-xs" aria-label="Mensagem para o fornecedor" />
                <button type="button" onClick={() => void copiar(mensagem, 'mensagem')} className="mt-1 flex items-center gap-1 rounded-lg border border-black/[0.12] px-3 py-1.5 text-xs font-semibold text-[#212121] hover:bg-slate-50"><Copy size={14} />{copiado === 'mensagem' ? 'Copiada' : 'Copiar mensagem'}</button>
              </div>
              <p className="text-xs text-[#757575]">Guarde agora: por segurança o link não fica salvo. Se perder, gere outro (o anterior deste fornecedor é cancelado).</p>
              {erro && <p className="text-xs font-semibold text-red-600" role="alert">{erro}</p>}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-black/[0.08]">
          <button type="button" onClick={() => onClose(Boolean(gerado))} className="rounded-lg px-4 py-2 text-sm font-semibold text-[#555] hover:bg-slate-100">{gerado ? 'Concluir' : 'Cancelar'}</button>
          {!gerado && <button type="button" onClick={() => void gerar()} disabled={ocupado || (!escolhido && busca.trim().length < 2)} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"><Link2 size={15} />{ocupado ? 'Gerando…' : 'Gerar link'}</button>}
        </div>
      </div>
    </div>
  );
}
