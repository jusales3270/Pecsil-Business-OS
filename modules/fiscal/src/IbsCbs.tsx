"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status, type StatusTone } from "../../../packages/design-system";
import { api, cnpjFormatado, date, money, nomeMes } from "./comum";

/**
 * Fiscal › IBS e CBS (N-03): a apuração informativa de 2026, nota a nota, a partir dos XMLs guardados na
 * plataforma. Saída gera débito, entrada gera crédito; devolução inverte. Em 2026 o recolhimento é dispensado
 * para quem cumpre as obrigações acessórias: o que importa é cada nota trazer o grupo certo. Cada nota vem
 * conferida pelo servidor contra a alíquota legal da data dela (a base é refeita item a item); o crédito continua
 * sendo o valor destacado, e a diferença é só um alerta para o Fiscal tratar com quem emitiu.
 */

type Nota = {
  id: string; chave: string | null; numero: string | null; lado: "entrada" | "saida" | "outra"; finalidade: string | null; emissao: string | null; competencia: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; emitente_crt: number | null; destinatario_cnpj: string | null; tem_grupo: boolean; v_bc: number; v_ibs_uf: number; v_ibs_mun: number; v_ibs: number; v_cbs: number; v_nf: number;
  itens: { cst: string; cClassTrib: string }[];
  conferencia: Conferencia;
};
type Conferencia = {
  situacao: "confere" | "diverge" | "sem_regra" | "sem_grupo" | "simples" | "manual"; diferenca: number; motivos: string[];
  aliquotas: { cbs: number; ibsUF: number; ibsMun: number; norma: string; vigenteDe: string; aConferir: boolean } | null;
  itens: { nItem: number; cst: string; baseDestacada: number; baseCalculada: number; destacado: { ibsUF: number; ibsMun: number; cbs: number; pIBSUF: number; pIBSMun: number; pCBS: number }; esperado: { ibsUF: number; ibsMun: number; cbs: number } | null; diferenca: number; motivos: string[] }[];
};
type Linha = { competencia: string; debitoIBS: number; debitoCBS: number; creditoIBS: number; creditoCBS: number; saldoIBS: number; saldoCBS: number; notasSaida: number; notasEntrada: number; semGrupo: number; simplesSemGrupo: number };
type Regra = { valor: { cbs?: number; ibs?: number; recolhimento?: string; rejeicao?: string; leiaute?: string; conformidade?: string }; fonte: { norma: string; url: string }; situacao: string } | null;
type Dados = { notas: Nota[]; apuracao: Linha[]; sincronizacao: { lidas: number; aviso: string | null; pendentes?: number; repetidas?: number }; regra: Regra };
type Filtro = "todas" | "entrada" | "saida" | "sem" | "diverge";

const LADO: Record<Nota["lado"], string> = { entrada: "Entrada (crédito)", saida: "Saída (débito)", outra: "Fora da empresa" };
const LADO_CURTO: Record<Nota["lado"], string> = { entrada: "Entrada", saida: "Saída", outra: "Fora" };
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const pctXml = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const CONFERENCIA: Record<Conferencia["situacao"], { rotulo: string; tom: StatusTone }> = {
  confere: { rotulo: "Confere", tom: "success" }, diverge: { rotulo: "Diverge", tom: "attention" }, sem_grupo: { rotulo: "Sem IBS/CBS", tom: "danger" },
  sem_regra: { rotulo: "Sem alíquota legal", tom: "neutral" }, manual: { rotulo: "Conferir à mão", tom: "neutral" },
  simples: { rotulo: "Simples", tom: "info" },
};

export function IbsCbs({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [mes, setMes] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [vendo, setVendo] = useState<Nota | null>(null);

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
    .filter((n) => filtro === "todas" || (filtro === "sem" ? n.conferencia.situacao === "sem_grupo" : filtro === "diverge" ? n.conferencia.situacao === "diverge" : n.lado === filtro)), [dados, atual, filtro]);
  const divergentes = useMemo(() => (dados?.notas ?? []).filter((n) => n.competencia === atual && n.lado !== "outra" && n.conferencia.situacao === "diverge"), [dados, atual]);
  const diferencaTotal = divergentes.reduce((a, n) => a + n.conferencia.diferenca, 0);

  const exportar = () => {
    const cab = ["emissao", "lado", "numero", "chave", "emitente_cnpj", "emitente", "base", "ibs_uf", "ibs_mun", "ibs", "cbs", "valor_nota", "tem_grupo", "cst", "cclasstrib", "conferencia", "diferenca"];
    const linhas = (dados?.notas ?? []).filter((n) => n.competencia === atual).map((n) => [n.emissao?.slice(0, 10) ?? "", n.lado, n.numero ?? "", n.chave ?? "", n.emitente_cnpj ?? "", (n.emitente_nome ?? "").replace(/;/g, ","), n.v_bc, n.v_ibs_uf, n.v_ibs_mun, n.v_ibs, n.v_cbs, n.v_nf, n.tem_grupo ? "sim" : "não", [...new Set(n.itens.map((i) => i.cst))].join("/"), [...new Set(n.itens.map((i) => i.cClassTrib))].join("/"), CONFERENCIA[n.conferencia.situacao].rotulo, n.conferencia.diferenca]);
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
          {Boolean(dados.sincronizacao.repetidas) && <Callout variant="info" title={`${dados.sincronizacao.repetidas} nota(s) chegaram por dois caminhos`}>A mesma chave de acesso foi enviada mais de uma vez (por exemplo, no Fiscal e no recebimento do Almoxarifado). Ela conta uma vez só.</Callout>}
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
                <div className="ibs-kpis"><KpiGrid>
                  <Kpi label="Débitos (saídas)" value={money(linha.debitoIBS + linha.debitoCBS)} caption={`CBS ${money(linha.debitoCBS)} · IBS ${money(linha.debitoIBS)} · ${linha.notasSaida} nota(s)`} tone="neutral" onOpen={() => setFiltro("saida")} />
                  <Kpi label="Créditos (entradas)" value={money(linha.creditoIBS + linha.creditoCBS)} caption={`CBS ${money(linha.creditoCBS)} · IBS ${money(linha.creditoIBS)} · ${linha.notasEntrada} nota(s)`} tone="green" onOpen={() => setFiltro("entrada")} />
                  <Kpi label="Saldo informativo" value={money(linha.saldoIBS + linha.saldoCBS)} caption={linha.saldoIBS + linha.saldoCBS < 0 ? "Crédito a favor (informativo em 2026)" : "Débito (informativo em 2026)"} tone="amber" />
                  <Kpi label="Notas sem o grupo" value={String(linha.semGrupo)} caption={`Sem IBS/CBS no XML: conferir com o fornecedor${linha.simplesSemGrupo ? `. Fora ${linha.simplesSemGrupo} do Simples Nacional, dispensado(s) em 2026` : ""}`} tone={linha.semGrupo ? "red" : "green"} onOpen={() => setFiltro("sem")} />
                  <Kpi label="Valor divergente" value={String(divergentes.length)} caption={divergentes.length ? `Destacado − esperado: ${money(diferencaTotal)}. Base ou alíquota fora da lei da data` : "Todas conferem com a lei da data"} tone={divergentes.length ? "amber" : "green"} onOpen={() => setFiltro("diverge")} />
                </KpiGrid></div>
              )}
              <div className="almox-filtros">
                <Segmented<Filtro> options={[{ value: "todas", label: "Todas" }, { value: "entrada", label: "Entradas" }, { value: "saida", label: "Saídas" }, { value: "sem", label: "Sem o grupo" }, { value: "diverge", label: "Divergentes" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
              </div>
              {notas.length ? (
                <div className="vnd-tabela ibs-tabela" role="table" aria-label="Notas da competência">
                  <div className="cabeca" role="row"><span>Emissão</span><span>Emitente</span><span>Lado</span><span className="r">Base</span><span className="r">IBS</span><span className="r">CBS</span><span>Grupo</span><span>Conferência</span></div>
                  {notas.map((n) => (
                    <button type="button" role="row" key={n.id} onClick={() => setVendo(n)} aria-label={`Ver a conferência da nota ${n.numero ?? ""} de ${n.emitente_nome ?? "emitente"}`}>
                      <span>{date(n.emissao)}</span>
                      <span className="nome">{n.emitente_nome ?? "—"}<small>{cnpjFormatado(n.emitente_cnpj)}{n.numero ? ` · NF ${n.numero}` : ""}{n.finalidade === "4" ? " · devolução" : ""}</small></span>
                      <span>{LADO_CURTO[n.lado]}</span>
                      <span className="r">{money(n.v_bc)}</span>
                      <span className="r">{money(n.v_ibs)}</span>
                      <span className="r">{money(n.v_cbs)}</span>
                      <span>{n.tem_grupo ? <Status tone="success">{[...new Set(n.itens.map((i) => `${i.cst}/${i.cClassTrib}`))].join(", ")}</Status> : n.conferencia.situacao === "simples" ? <Status tone="neutral">Sem grupo</Status> : <Status tone="danger">Sem IBS/CBS</Status>}</span>
                      <span>{n.tem_grupo || n.conferencia.situacao === "simples" ? <Status tone={CONFERENCIA[n.conferencia.situacao].tom}>{CONFERENCIA[n.conferencia.situacao].rotulo}{n.conferencia.situacao === "diverge" && n.conferencia.diferenca ? ` ${money(n.conferencia.diferenca)}` : ""}</Status> : "—"}</span>
                    </button>
                  ))}
                </div>
              ) : <div className="finance-empty"><b>Nada com esse filtro</b></div>}
            </>
          )}
        </>
      )}
      {vendo && <DetalheNota nota={vendo} onClose={() => setVendo(null)} />}
    </div>
  );
}

function DetalheNota({ nota, onClose }: { nota: Nota; onClose: () => void }) {
  const c = nota.conferencia;
  const a = c.aliquotas;
  return (
    <Modal eyebrow={`FISCAL · IBS E CBS · ${LADO[nota.lado].toUpperCase()}`} title={`${nota.emitente_nome ?? "Emitente"}${nota.numero ? ` · NF ${nota.numero}` : ""}`}
      subtitle={<>{date(nota.emissao)} · {cnpjFormatado(nota.emitente_cnpj)} · <Status tone={CONFERENCIA[c.situacao].tom}>{CONFERENCIA[c.situacao].rotulo}</Status></>} onClose={onClose}>
      <div className="almox-form ibs-detalhe">
        {a && <p className="ibs-regra">Lei da data da nota: CBS {pctXml(a.cbs)}, IBS da UF {pctXml(a.ibsUF)} e IBS do município {pctXml(a.ibsMun)} ({a.norma}, desde {date(a.vigenteDe)}){a.aConferir ? " · parâmetro ainda a conferir" : ""}.</p>}
        {c.motivos.length > 0 && <Callout variant={c.situacao === "diverge" ? "warning" : "info"} title={c.situacao === "diverge" ? "O que não confere" : "Conferência"}>{c.motivos.map((m) => <span key={m} className="ibs-motivo">{m}</span>)}</Callout>}
        {c.situacao === "diverge" && <p className="ibs-regra">O crédito segue sendo o valor destacado na nota. A diferença é um alerta para tratar com quem emitiu (carta de correção não serve para valor: pede nota complementar ou de ajuste).</p>}
        {c.itens.length > 0 && (
          <div className="vnd-tabela ibs-itens" role="table" aria-label="Conferência por item">
            <div className="cabeca" role="row"><span>Item</span><span className="r">Base na nota</span><span className="r">Base pela conta</span><span className="r">IBS na nota</span><span className="r">IBS esperado</span><span className="r">CBS na nota</span><span className="r">CBS esperada</span></div>
            {c.itens.map((i) => (
              <div role="row" key={i.nItem}>
                <span>{i.nItem} · CST {i.cst}</span>
                <span className="r">{money(i.baseDestacada)}</span>
                <span className={`r${Math.abs(i.baseDestacada - i.baseCalculada) > 0.01 ? " ibs-difere" : ""}`}>{money(i.baseCalculada)}</span>
                <span className="r">{money(i.destacado.ibsUF + i.destacado.ibsMun)}<small>{pctXml(i.destacado.pIBSUF + i.destacado.pIBSMun)}</small></span>
                <span className={`r${i.esperado && Math.abs(i.destacado.ibsUF + i.destacado.ibsMun - i.esperado.ibsUF - i.esperado.ibsMun) > 0.01 ? " ibs-difere" : ""}`}>{i.esperado ? money(i.esperado.ibsUF + i.esperado.ibsMun) : "—"}</span>
                <span className="r">{money(i.destacado.cbs)}<small>{pctXml(i.destacado.pCBS)}</small></span>
                <span className={`r${i.esperado && Math.abs(i.destacado.cbs - i.esperado.cbs) > 0.01 ? " ibs-difere" : ""}`}>{i.esperado ? money(i.esperado.cbs) : "—"}</span>
              </div>
            ))}
          </div>
        )}
        <p className="ibs-regra">Base pela conta: produto − desconto + frete + seguro + outras despesas − ICMS − PIS − COFINS (o IPI fica fora; LC 214, art. 12).</p>
        <footer><Button type="button" variant="secondary" onClick={onClose}>Fechar</Button></footer>
      </div>
    </Modal>
  );
}
