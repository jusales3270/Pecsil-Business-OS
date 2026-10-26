"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Segmented, Status } from "../../../packages/design-system";
import { api, cnpjFormatado, date, money, nomeMes } from "./comum";

/**
 * Fiscal › IBS e CBS (N-03): a apuração informativa de 2026, nota a nota, a partir dos XMLs guardados na
 * plataforma. Saída gera débito, entrada gera crédito; devolução inverte. Em 2026 o recolhimento é dispensado
 * para quem cumpre as obrigações acessórias: o que importa é cada nota trazer o grupo certo.
 */

type Nota = {
  id: string; chave: string | null; numero: string | null; lado: "entrada" | "saida" | "outra"; finalidade: string | null; emissao: string | null; competencia: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; destinatario_cnpj: string | null; tem_grupo: boolean; v_bc: number; v_ibs_uf: number; v_ibs_mun: number; v_ibs: number; v_cbs: number; v_nf: number;
  itens: { cst: string; cClassTrib: string }[];
};
type Linha = { competencia: string; debitoIBS: number; debitoCBS: number; creditoIBS: number; creditoCBS: number; saldoIBS: number; saldoCBS: number; notasSaida: number; notasEntrada: number; semGrupo: number };
type Regra = { valor: { cbs?: number; ibs?: number; recolhimento?: string; rejeicao?: string; leiaute?: string; conformidade?: string }; fonte: { norma: string; url: string }; situacao: string } | null;
type Dados = { notas: Nota[]; apuracao: Linha[]; sincronizacao: { lidas: number; aviso: string | null; pendentes?: number }; regra: Regra };
type Filtro = "todas" | "entrada" | "saida" | "sem";

const LADO: Record<Nota["lado"], string> = { entrada: "Entrada (crédito)", saida: "Saída (débito)", outra: "Fora da empresa" };
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export function IbsCbs({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [mes, setMes] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/fiscal/ibs-cbs");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
    if (r.data.sincronizacao.lidas) notify(`${r.data.sincronizacao.lidas} nota(s) nova(s) lida(s) para o IBS e a CBS.`);
  }, [notify]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const meses = useMemo(() => (dados?.apuracao ?? []).map((l) => l.competencia), [dados]);
  const atual = mes ?? meses[0] ?? null;
  const linha = (dados?.apuracao ?? []).find((l) => l.competencia === atual) ?? null;
  const notas = useMemo(() => (dados?.notas ?? []).filter((n) => n.competencia === atual && n.lado !== "outra")
    .filter((n) => filtro === "todas" || (filtro === "sem" ? !n.tem_grupo : n.lado === filtro)), [dados, atual, filtro]);

  const exportar = () => {
    const cab = ["emissao", "lado", "numero", "chave", "emitente_cnpj", "emitente", "base", "ibs_uf", "ibs_mun", "ibs", "cbs", "valor_nota", "tem_grupo", "cst", "cclasstrib"];
    const linhas = (dados?.notas ?? []).filter((n) => n.competencia === atual).map((n) => [n.emissao?.slice(0, 10) ?? "", n.lado, n.numero ?? "", n.chave ?? "", n.emitente_cnpj ?? "", (n.emitente_nome ?? "").replace(/;/g, ","), n.v_bc, n.v_ibs_uf, n.v_ibs_mun, n.v_ibs, n.v_cbs, n.v_nf, n.tem_grupo ? "sim" : "não", [...new Set(n.itens.map((i) => i.cst))].join("/"), [...new Set(n.itens.map((i) => i.cClassTrib))].join("/")]);
    const csv = [cab, ...linhas].map((l) => l.map((c) => (typeof c === "number" ? c.toFixed(2).replace(".", ",") : String(c))).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `ibs-cbs-${atual}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · IBS E CBS</p><h1>IBS e CBS</h1><p>A apuração informativa da reforma, nota a nota, a partir das NF-e guardadas na plataforma (Enviar arquivos, recebimento do Almoxarifado, notas da SEFAZ). Saída gera débito; entrada gera crédito.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Lendo as notas…</small></div>}
      {dados && (
        <>
          {dados.regra && (
            <Callout variant="info" title={`2026: fase de teste · CBS ${pct(dados.regra.valor.cbs ?? 0)} e IBS ${pct(dados.regra.valor.ibs ?? 0)}`}>
              {dados.regra.valor.recolhimento ? `Recolhimento ${dados.regra.valor.recolhimento}.` : ""} {dados.regra.valor.conformidade ? `Conformidade: ${dados.regra.valor.conformidade}.` : ""} Fonte: {dados.regra.fonte.norma}{dados.regra.situacao !== "conferido" ? " (parâmetro ainda a conferir)" : ""}.
            </Callout>
          )}
          {dados.sincronizacao.aviso && <Callout variant="warning" title="Atenção">{dados.sincronizacao.aviso}</Callout>}
          {!meses.length ? (
            <div className="finance-empty almox-vazio"><b>Nenhuma NF-e lida ainda</b><small>Envie os XMLs das notas em Fiscal › Escritório contábil ou pelo recebimento do Almoxarifado.</small></div>
          ) : (
            <>
              <div className="almox-filtros">
                <label className="pcf-mes"><span>Competência</span>
                  <select value={atual ?? ""} onChange={(e) => setMes(e.target.value)}>{meses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}</select>
                </label>
                <Button compact variant="secondary" onClick={exportar}>Baixar planilha (CSV)</Button>
              </div>
              {linha && (
                <KpiGrid>
                  <Kpi label="Débitos (saídas)" value={money(linha.debitoIBS + linha.debitoCBS)} caption={`CBS ${money(linha.debitoCBS)} · IBS ${money(linha.debitoIBS)} · ${linha.notasSaida} nota(s)`} tone="neutral" onOpen={() => setFiltro("saida")} />
                  <Kpi label="Créditos (entradas)" value={money(linha.creditoIBS + linha.creditoCBS)} caption={`CBS ${money(linha.creditoCBS)} · IBS ${money(linha.creditoIBS)} · ${linha.notasEntrada} nota(s)`} tone="green" onOpen={() => setFiltro("entrada")} />
                  <Kpi label="Saldo informativo" value={money(linha.saldoIBS + linha.saldoCBS)} caption={linha.saldoIBS + linha.saldoCBS < 0 ? "Crédito a favor (informativo em 2026)" : "Débito (informativo em 2026)"} tone="amber" />
                  <Kpi label="Notas sem o grupo" value={String(linha.semGrupo)} caption="Sem IBS/CBS no XML: conferir com o fornecedor" tone={linha.semGrupo ? "red" : "green"} onOpen={() => setFiltro("sem")} />
                </KpiGrid>
              )}
              <div className="almox-filtros">
                <Segmented<Filtro> options={[{ value: "todas", label: "Todas" }, { value: "entrada", label: "Entradas" }, { value: "saida", label: "Saídas" }, { value: "sem", label: "Sem o grupo" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
              </div>
              {notas.length ? (
                <div className="vnd-tabela ibs-tabela" role="table" aria-label="Notas da competência">
                  <div className="cabeca" role="row"><span>Emissão</span><span>Emitente</span><span>Lado</span><span className="r">Base</span><span className="r">IBS</span><span className="r">CBS</span><span>Grupo</span></div>
                  {notas.map((n) => (
                    <div role="row" key={n.id}>
                      <span>{date(n.emissao)}</span>
                      <span className="nome">{n.emitente_nome ?? "—"}<small>{cnpjFormatado(n.emitente_cnpj)}{n.numero ? ` · NF ${n.numero}` : ""}{n.finalidade === "4" ? " · devolução" : ""}</small></span>
                      <span>{LADO[n.lado]}</span>
                      <span className="r">{money(n.v_bc)}</span>
                      <span className="r">{money(n.v_ibs)}</span>
                      <span className="r">{money(n.v_cbs)}</span>
                      <span>{n.tem_grupo ? <Status tone="success">{[...new Set(n.itens.map((i) => `${i.cst}/${i.cClassTrib}`))].join(", ")}</Status> : <Status tone="danger">Sem IBS/CBS</Status>}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="finance-empty"><b>Nada com esse filtro</b></div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
