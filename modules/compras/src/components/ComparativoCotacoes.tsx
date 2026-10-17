import { useEffect, useMemo, useState } from 'react';
import { Award, Clock, CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatAmount, formatDate } from '@/store';
import type { Cotacao } from '@/types';
import { comparar, type Proposta } from '../../../../lib/compras/comparativo';

/** Cotação do store no formato da regra do comparativo (lib/compras/comparativo). */
export function propostaDe(c: Cotacao): Proposta {
  const itens = (c.produtos?.length ? c.produtos : c.produto ? [{ produto: c.produto, valorUnit: c.valorUnit ?? 0, quantidade: c.quantidade ?? 0, ipi: c.ipi ?? 0, prazo: c.prazo ?? '', material: null }] : [])
    .filter((p) => !('status' in p) || p.status !== 'REJEITADO')
    .map((p) => ({ produto: p.produto, materialId: p.material?.id ?? null, quantidade: p.quantidade, valorUnit: p.valorUnit, ipi: p.ipi, prazo: p.prazo || null }));
  return { cotacaoId: c.id, fornecedor: c.fornecedor, prazoEntrega: c.prazoEntrega ?? null, itens };
}

const SELO = {
  preco: { label: 'Melhor preço', icon: Award },
  entrega: { label: 'Melhor entrega', icon: Clock },
  pagamento: { label: 'Melhor pagamento', icon: CreditCard },
} as const;

/**
 * Comparativo das cotações do mesmo pedido de material (A-07): selos de melhor preço, entrega e
 * pagamento, e a indicação pela regra "primeiro quem entrega no prazo, depois o menor custo". Só
 * mostra: quem decide é o gestor.
 */
export default function ComparativoCotacoes({ cotacao, cotacoes }: { cotacao: Cotacao; cotacoes: Cotacao[] }) {
  const [precisaAte, setPrecisaAte] = useState<string | null>(null);
  const concorrentes = useMemo(
    () => (cotacao.materialRequestId ? cotacoes.filter((c) => c.materialRequestId === cotacao.materialRequestId && !c.deletedAt && c.status !== 'REJEITADO') : []),
    [cotacao.materialRequestId, cotacoes],
  );
  useEffect(() => {
    if (!cotacao.materialRequestId) return;
    let vivo = true;
    void supabase.from('material_requests').select('precisa_ate').eq('id', cotacao.materialRequestId).maybeSingle()
      .then(({ data }) => { if (vivo) setPrecisaAte((data?.precisa_ate as string | null) ?? null); });
    return () => { vivo = false; };
  }, [cotacao.materialRequestId]);

  if (concorrentes.length < 2) return null;
  const { linhas, ninguemNoPrazo } = comparar(concorrentes.map(propostaDe), precisaAte);

  return (
    <div className="space-y-2 border-t border-black/[0.06] pt-4">
      <h3 className="text-xs font-semibold text-[#757575] uppercase tracking-wider">
        Comparativo do pedido ({linhas.length} cotações){precisaAte ? ` · a produção precisa até ${formatDate(precisaAte)}` : ''}
      </h3>
      <p className="text-[11px] text-[#757575]">
        Regra: primeiro quem entrega no prazo, depois o menor custo.{ninguemNoPrazo ? ' Nenhuma cotação entrega até a data pedida: a indicada é a que chega primeiro.' : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[#757575]">
              <th className="py-1.5 pr-3 font-medium">Fornecedor</th>
              <th className="py-1.5 pr-3 font-medium text-right">Total</th>
              <th className="py-1.5 pr-3 font-medium">Entrega</th>
              <th className="py-1.5 pr-3 font-medium">Pagamento</th>
              <th className="py-1.5 font-medium">Selos</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.cotacaoId} className={`border-t border-black/[0.06] ${l.cotacaoId === cotacao.id ? 'bg-primary/5' : ''}`}>
                <td className="py-2 pr-3">
                  <span className="font-semibold text-[#212121]">{l.fornecedor}</span>
                  <span className="text-[#757575]"> · nº {l.cotacaoId}{l.cotacaoId === cotacao.id ? ' (esta)' : ''}</span>
                  {l.recomendada && <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Indicada pela regra</span>}
                </td>
                <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">{formatAmount(l.total)}</td>
                <td className={`py-2 pr-3 ${l.noPrazo === false ? 'text-red-600 font-semibold' : 'text-[#212121]'}`}>
                  {l.prazoEntrega ? formatDate(l.prazoEntrega) : '—'}{l.noPrazo === false ? ' (fora do prazo)' : ''}
                </td>
                <td className="py-2 pr-3 text-[#212121]">{l.diasPagamento === null ? '—' : l.diasPagamento === 0 ? 'à vista' : `${l.diasPagamento} dias`}</td>
                <td className="py-2">
                  <span className="flex flex-wrap gap-1">
                    {l.selos.map((s) => {
                      const S = SELO[s];
                      return <span key={s} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"><S.icon size={11} />{S.label}</span>;
                    })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
