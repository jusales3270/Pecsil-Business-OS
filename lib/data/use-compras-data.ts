"use client";

import { useCallback, useEffect, useState } from "react";
import {
  demoComprasSnapshot,
  type ComprasSnapshot,
  type Cotacao,
  type CotacaoProduto,
  type Compra,
  type Divisao,
} from "./compras";

type ComprasDataState = {
  snapshot: ComprasSnapshot;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createCotacao: (payload: {
    fornecedor: string;
    divisao: Divisao;
    obs?: string;
    produtos: Omit<CotacaoProduto, "id" | "status">[];
  }) => Promise<Cotacao>;
  decideProduto: (
    produtoId: number | string,
    decision: "APROVADO" | "REJEITADO",
    motivo?: string,
  ) => Promise<void>;
  registerCompra: (payload: {
    cotacaoId: number;
    nf: string;
    dataCompra: string;
    obs?: string;
  }) => Promise<Compra>;
};

export function useComprasData(): ComprasDataState {
  const [snapshot, setSnapshot] = useState<ComprasSnapshot>(demoComprasSnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/compras", { cache: "no-store" });
      if (response.status === 401) {
        setSnapshot(demoComprasSnapshot);
        setLoading(false);
        setError("Sessão não autorizada para o módulo de Compras; exibindo dados demonstrativos.");
        return;
      }
      if (!response.ok) throw new Error("COMPRAS_UNAVAILABLE");
      const data = (await response.json()) as ComprasSnapshot;
      setSnapshot(data);
      setLoading(false);
      setError(null);
    } catch {
      setSnapshot(demoComprasSnapshot);
      setLoading(false);
      setError("Banco de dados indisponível; exibindo base demonstrativa de Compras.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createCotacao = useCallback(
    async (payload: {
      fornecedor: string;
      divisao: Divisao;
      obs?: string;
      produtos: Omit<CotacaoProduto, "id" | "status">[];
    }) => {
      try {
        const res = await fetch("/api/compras", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create_cotacao", ...payload }),
        });
        if (res.ok) {
          const created = (await res.json()) as Cotacao;
          await reload();
          return created;
        }
      } catch {
        // Fallback abaixo
      }

      // Salva otimista caso ocorra erro ou timeout no backend
      const newId = Date.now();
      const created: Cotacao = {
        id: newId,
        fornecedor: payload.fornecedor,
        divisao: payload.divisao,
        obs: payload.obs || "",
        status: "PENDENTE",
        userId: "local-user",
        aprovadoPor: null,
        motivoRejeicao: null,
        dataDecisao: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        produtos: payload.produtos.map((p, idx) => ({
          id: newId + idx + 1,
          cotacaoId: newId,
          produto: p.produto,
          valorUnit: Number(p.valorUnit) || 0,
          quantidade: Number(p.quantidade) || 1,
          unidade: p.unidade || "UN",
          icms: Number(p.icms) || 0,
          ipi: Number(p.ipi) || 0,
          prazo: p.prazo || "",
          obs: p.obs || "",
          status: "PENDENTE",
        })),
      };

      setSnapshot((prev) => {
        const cotacoes = [created, ...prev.cotacoes];
        const summary = {
          ...prev.summary,
          totalCotacoes: cotacoes.length,
          pendentes: prev.summary.pendentes + 1,
        };
        return { ...prev, cotacoes, summary };
      });

      return created;
    },
    [reload],
  );

  const decideProduto = useCallback(
    async (
      produtoId: number | string,
      decision: "APROVADO" | "REJEITADO",
      motivo?: string,
    ) => {
      try {
        const res = await fetch("/api/compras", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ produtoId, decision, motivo }),
        });
        if (res.ok) {
          await reload();
          return;
        }
      } catch {
        // Fallback
      }

      // Atualização otimista local
      setSnapshot((prev) => {
        const cotacoes = prev.cotacoes.map((c) => {
          const produtos = c.produtos.map((p) =>
            p.id === produtoId ? { ...p, status: decision, motivoRejeicao: motivo } : p,
          );
          const temPendente = produtos.some((p) => p.status === "PENDENTE");
          const temAprovado = produtos.some((p) => p.status === "APROVADO");
          const todosRejeitados = produtos.every((p) => p.status === "REJEITADO");
          let status = c.status;
          if (todosRejeitados) status = "REJEITADO";
          else if (!temPendente && temAprovado) status = "APROVADO";
          else if (temAprovado) status = "APROVADO";
          return { ...c, produtos, status };
        });
        return { ...prev, cotacoes };
      });
    },
    [reload],
  );

  const registerCompra = useCallback(
    async (payload: {
      cotacaoId: number;
      nf: string;
      dataCompra: string;
      obs?: string;
    }) => {
      try {
        const res = await fetch("/api/compras", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const created = (await res.json()) as Compra;
          await reload();
          return created;
        }
      } catch {
        // Fallback
      }

      const comp: Compra = {
        id: Date.now(),
        cotacaoId: payload.cotacaoId,
        fornecedor: "Fornecedor",
        produto: "Compra Faturada",
        quantidade: 1,
        unidade: "UN",
        valorUnit: 0,
        total: 0,
        nf: payload.nf,
        dataCompra: payload.dataCompra,
        obs: payload.obs || "",
        createdAt: new Date().toISOString(),
      };

      setSnapshot((prev) => ({
        ...prev,
        compras: [comp, ...prev.compras],
      }));

      return comp;
    },
    [reload],
  );

  return {
    snapshot,
    loading,
    error,
    reload,
    createCotacao,
    decideProduto,
    registerCompra,
  };
}
