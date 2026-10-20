import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * Fornecedor do cadastro: busca pelo nome e, se não estiver lá, cadastra na hora (nome, CNPJ,
 * telefone e e-mail; o resto do cadastro se completa depois em Fornecedores).
 */
export type FornecedorEscolhido = { id: string; nome: string };

export default function EscolherFornecedor({ valor, onEscolher, podeCadastrar }: {
  valor: FornecedorEscolhido | null; onEscolher: (f: FornecedorEscolhido | null) => void; podeCadastrar: boolean;
}) {
  const [busca, setBusca] = useState('');
  const [opcoes, setOpcoes] = useState<FornecedorEscolhido[]>([]);
  const [cadastrando, setCadastrando] = useState(false);
  const [novo, setNovo] = useState({ name: '', taxId: '', phone: '', email: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const termo = busca.trim().replace(/[%,()]/g, ' ');
    if (valor || termo.length < 2) { const t = setTimeout(() => setOpcoes([]), 0); return () => clearTimeout(t); }
    let vivo = true;
    const t = setTimeout(() => {
      void supabase.from('suppliers').select('id, name, trade_name').eq('active', true).is('merged_into', null)
        .or(`name.ilike.%${termo}%,trade_name.ilike.%${termo}%`).order('name').limit(8)
        .then(({ data }) => { if (vivo) setOpcoes((data ?? []).map((s) => ({ id: s.id, nome: s.trade_name || s.name }))); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, valor]);

  const cadastrar = async () => {
    setSalvando(true); setErro('');
    const r = await fetch('/api/compras/fornecedores', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: novo.name.trim(), taxId: novo.taxId || null, phone: novo.phone.trim() || null, email: novo.email.trim() || null }) })
      .then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) })).catch(() => ({ status: 0, body: null }));
    setSalvando(false);
    // Já existia com esse nome: usa o do cadastro.
    if ((r.status === 201 || r.status === 409) && r.body?.id) {
      const { data } = await supabase.from('suppliers').select('name, trade_name').eq('id', r.body.id).maybeSingle();
      onEscolher({ id: r.body.id, nome: data?.trade_name || data?.name || novo.name.trim() });
      setCadastrando(false); setNovo({ name: '', taxId: '', phone: '', email: '' }); setBusca('');
      return;
    }
    setErro(r.body?.error ?? 'Não foi possível cadastrar o fornecedor.');
  };

  if (valor) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-sm">
        <b className="text-[#212121]">{valor.nome}</b>
        <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => { onEscolher(null); setBusca(''); }}>Trocar</button>
      </div>
    );
  }
  if (cadastrando) {
    return (
      <div className="space-y-2 rounded-lg border border-primary/30 bg-blue-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[#212121]">Cadastrar fornecedor</p>
          <button type="button" aria-label="Fechar o cadastro" onClick={() => setCadastrando(false)} className="text-[#757575] hover:text-[#212121]"><X size={15} /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs text-[#555]">Nome *<input autoFocus value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" /></label>
          <label className="text-xs text-[#555]">CNPJ<input value={novo.taxId} inputMode="numeric" onChange={(e) => setNovo({ ...novo, taxId: e.target.value })} placeholder="Só os números" className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" /></label>
          <label className="text-xs text-[#555]">Telefone<input value={novo.phone} onChange={(e) => setNovo({ ...novo, phone: e.target.value })} className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" /></label>
          <label className="sm:col-span-2 text-xs text-[#555]">E-mail<input value={novo.email} type="email" onChange={(e) => setNovo({ ...novo, email: e.target.value })} className="mt-0.5 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-sm" /></label>
        </div>
        {erro && <p className="text-xs font-semibold text-red-600" role="alert">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setCadastrando(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#555] hover:bg-slate-100">Cancelar</button>
          <button type="button" disabled={salvando || novo.name.trim().length < 2} onClick={() => void cadastrar()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{salvando ? 'Cadastrando…' : 'Cadastrar e usar'}</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Busque o fornecedor no cadastro" aria-label="Buscar fornecedor" className="w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-sm" />
        {podeCadastrar && (
          <button type="button" onClick={() => { setCadastrando(true); setNovo({ name: busca.trim(), taxId: '', phone: '', email: '' }); }} className="flex shrink-0 items-center gap-1 rounded-lg border border-primary px-3 text-xs font-semibold text-primary hover:bg-primary/5">
            <Plus size={14} /> Cadastrar fornecedor
          </button>
        )}
      </div>
      {opcoes.length > 0 && (
        <div className="mt-1 divide-y divide-black/[0.06] rounded-lg border border-black/[0.08] bg-white" role="listbox" aria-label="Fornecedores do cadastro">
          {opcoes.map((o) => <button key={o.id} type="button" role="option" aria-selected={false} onClick={() => onEscolher(o)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{o.nome}</button>)}
        </div>
      )}
      {busca.trim().length >= 2 && !opcoes.length && (
        <p className="mt-1 text-xs text-[#757575]">Não está no cadastro.{podeCadastrar ? ' Use “Cadastrar fornecedor”.' : ' Peça a quem cuida do cadastro de fornecedores.'}</p>
      )}
    </div>
  );
}
