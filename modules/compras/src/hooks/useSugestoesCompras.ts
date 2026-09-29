import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStore, formatDate, formatUnitPrice } from '@/store';
import { normalizeName } from '../../../../lib/compras/fornecedores-core';
import { productCatalog, type ProductEntry, type ProductSuggestionMeta, type Suggestion } from '../../../../lib/compras/sugestoes-core';

type SupplierRow = { id: string; name: string; merged_into: string | null; active: boolean };

/**
 * Sugestões para os campos de fornecedor e produto do Compras.
 * - Fornecedores: o cadastro (todos da organização podem ler), com os apelidos
 *   unificados apontando para o nome principal.
 * - Produtos: o histórico de itens de cotação e de compras já carregado.
 */
export function useSugestoesCompras() {
  const { cotacoes, compras } = useStore();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  useEffect(() => {
    let ativo = true;
    supabase
      .from('suppliers')
      .select('id, name, merged_into, active')
      .then(({ data }) => {
        if (ativo && data) setSuppliers(data as SupplierRow[]);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const fornecedores = useMemo<Suggestion[]>(() => {
    const aliases = new Map<string, string[]>();
    for (const s of suppliers) if (s.merged_into) aliases.set(s.merged_into, [...(aliases.get(s.merged_into) ?? []), s.name]);
    const uso = new Map<string, { n: number; ultima: string }>();
    for (const c of compras) {
      if (!c.supplierId) continue;
      const cur = uso.get(c.supplierId) ?? { n: 0, ultima: '' };
      uso.set(c.supplierId, { n: cur.n + 1, ultima: (c.dataCompra ?? '') > cur.ultima ? c.dataCompra ?? '' : cur.ultima });
    }
    return suppliers
      .filter((s) => !s.merged_into && s.active)
      .map((s) => {
        const u = uso.get(s.id);
        return {
          value: s.name,
          alsoMatches: aliases.get(s.id),
          weight: (u?.n ?? 0) * 1000 + (u?.ultima ? Date.parse(u.ultima) / 1e10 : 0),
          hint: u ? `${u.n} compra${u.n === 1 ? '' : 's'} · última em ${formatDate(u.ultima)}` : 'Cadastrado, sem compras ainda',
          meta: { supplierId: s.id },
        };
      });
  }, [suppliers, compras]);

  /** Id do fornecedor pelo nome digitado (principal ou apelido). */
  const supplierIdPorNome = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suppliers) map.set(normalizeName(s.name), s.merged_into ?? s.id);
    return (nome: string) => map.get(normalizeName(nome)) ?? null;
  }, [suppliers]);

  const catalogo = useMemo(() => {
    const entries: ProductEntry[] = [];
    for (const c of cotacoes) {
      if (c.deletedAt) continue;
      const itens = c.produtos?.length ? c.produtos : c.produto ? [{ produto: c.produto, unidade: c.unidade ?? null, valorUnit: c.valorUnit ?? null }] : [];
      for (const p of itens) {
        entries.push({ produto: p.produto, unidade: p.unidade, valorUnit: p.valorUnit, fornecedor: c.fornecedor, supplierId: c.supplierId ?? null, data: c.createdAt ?? '' });
      }
    }
    for (const x of compras) {
      entries.push({ produto: x.produto, unidade: x.unidade, valorUnit: x.valorUnit, fornecedor: x.fornecedor, supplierId: x.supplierId ?? null, data: x.dataCompra ?? x.createdAt ?? '' });
    }
    return productCatalog(entries);
  }, [cotacoes, compras]);

  /**
   * Produtos para sugerir; com o fornecedor da cotação conhecido, os que já
   * vieram dele sobem na lista e dizem isso.
   */
  const produtosPara = useCallback((supplierId: string | null): Suggestion[] =>
    catalogo.map((p) => {
      const m = p.meta as ProductSuggestionMeta;
      const doFornecedor = !!supplierId && m.fornecedores.includes(supplierId);
      const preco = m.ultimoValor ? `último ${formatUnitPrice(m.ultimoValor)}${m.unidade ? `/${m.unidade}` : ''}` : null;
      const origem = m.ultimoFornecedor ? `${doFornecedor ? 'já veio deste fornecedor' : m.ultimoFornecedor}` : null;
      return {
        ...p,
        weight: p.weight + (doFornecedor ? 1e9 : 0),
        hint: [`${m.usos}× no histórico`, preco, origem, m.ultimaData ? formatDate(m.ultimaData) : null].filter(Boolean).join(' · '),
      };
    }), [catalogo]);

  return { fornecedores, supplierIdPorNome, produtosPara };
}
