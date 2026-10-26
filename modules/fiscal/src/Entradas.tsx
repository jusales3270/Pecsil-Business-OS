"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status, type StatusTone } from "../../../packages/design-system";
import { cfopEntradaPara, TIPOS_ITEM, type Achado, type Classificacao, type ItemEntrada } from "../../../lib/fiscal/entradas/checagem";
import { api, cnpjFormatado, date, money, nomeMes } from "./comum";

/**
 * Fiscal › Conferência de entradas (N-09): cada nota recebida do mês, o que não confere nela e a classificação
 * proposta de cada item (tipo do item do SPED, CFOP de entrada e o crédito de ICMS que cabe), com o porquê.
 * A plataforma propõe; quem opera o ICMS confirma, item por item.
 */

type Item = ItemEntrada & { proposta: Classificacao; confirmada: { nItem: number; tipo: string; cfopEntrada: string } | null };
type Nota = {
  id: string; chave: string | null; numero: string | null; emissao: string | null; competencia: string | null; finalidade: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; emitente_uf: string | null; emitente_crt: number | null; v_nf: number;
  itens: Item[]; achados: Achado[]; situacao: "ok" | "atencao" | "erro"; conferida: boolean; conferida_por_nome: string | null; conferida_em: string | null;
};
type Dados = { notas: Nota[]; repetidas: number; uf: string; sincronizacao: { lidas: number; aviso: string | null }; podeOperar: boolean };
type Filtro = "todas" | "conferir" | "achados";

const SITUACAO: Record<Nota["situacao"], { rotulo: string; tom: StatusTone }> = { ok: { rotulo: "Confere", tom: "success" }, atencao: { rotulo: "Atenção", tom: "attention" }, erro: { rotulo: "Erro", tom: "danger" } };
const TIPOS_ESCOLHA = ["01", "02", "06", "10", "00", "07", "08", "09", "RI", "DV", "BO"];
const tipoDe = (i: Item) => i.confirmada?.tipo ?? i.proposta.tipo;
const resumoTipos = (n: Nota) => { const t = [...new Set(n.itens.map(tipoDe))]; return t.length === 1 ? TIPOS_ITEM[t[0]] ?? t[0] : `Misto (${t.map((x) => TIPOS_ITEM[x] ?? x).join(", ")})`; };

export function Entradas({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [mes, setMes] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [aberta, setAberta] = useState<Nota | null>(null);
  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/fiscal/entradas");
    if (!r.ok) { setErro(r.error); return; }
    setErro(""); setDados(r.data);
    if (r.data.sincronizacao.lidas) notify(`${r.data.sincronizacao.lidas} nota(s) nova(s) checada(s).`);
  }, [notify]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const meses = useMemo(() => [...new Set((dados?.notas ?? []).map((n) => n.competencia!))].sort().reverse(), [dados]);
  const atual = mes ?? meses[0] ?? null;
  const doMes = useMemo(() => (dados?.notas ?? []).filter((n) => n.competencia === atual), [dados, atual]);
  const visiveis = doMes.filter((n) => filtro === "todas" || (filtro === "conferir" ? !n.conferida : n.situacao !== "ok"));
  const aClassificar = doMes.reduce((s, n) => s + n.itens.filter((i) => !i.confirmada && i.proposta.tipo === "??").length, 0);

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · ENTRADAS</p><h1>Conferência de entradas</h1><p>Cada nota recebida é checada (CFOP × origem, CST × regime do emitente, alíquota interestadual, NCM, grupo do IBS/CBS, devolução e totais) e cada item ganha uma classificação proposta, com o porquê. Quem opera o ICMS confirma.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Lendo as notas…</small></div>}
      {dados && (
        <>
          {dados.sincronizacao.aviso && <Callout variant="warning" title="Atenção">{dados.sincronizacao.aviso}</Callout>}
          {dados.repetidas > 0 && <Callout variant="info" title={`${dados.repetidas} nota(s) chegaram por dois caminhos`}>A mesma chave de acesso foi enviada mais de uma vez. Ela aparece uma vez só.</Callout>}
          {!meses.length ? <div className="finance-empty almox-vazio"><b>Nenhuma nota recebida ainda</b><small>Envie os XMLs no Fiscal ou pelo recebimento do Almoxarifado.</small></div> : (
            <>
              <div className="almox-filtros">
                <label className="pcf-mes"><span>Competência</span><select value={atual ?? ""} onChange={(e) => setMes(e.target.value)}>{meses.map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}</select></label>
              </div>
              <KpiGrid>
                <Kpi label="Notas do mês" value={String(doMes.length)} caption={money(doMes.reduce((s, n) => s + n.v_nf, 0))} tone="neutral" onOpen={() => setFiltro("todas")} />
                <Kpi label="Conferidas" value={`${doMes.filter((n) => n.conferida).length} de ${doMes.length}`} caption="Classificação confirmada pelo Fiscal" tone={doMes.every((n) => n.conferida) ? "green" : "amber"} onOpen={() => setFiltro("conferir")} />
                <Kpi label="Com achados" value={String(doMes.filter((n) => n.situacao !== "ok").length)} caption={`${doMes.filter((n) => n.situacao === "erro").length} com erro`} tone={doMes.some((n) => n.situacao === "erro") ? "red" : doMes.some((n) => n.situacao !== "ok") ? "amber" : "green"} onOpen={() => setFiltro("achados")} />
                <Kpi label="Itens a classificar" value={String(aClassificar)} caption="Sem cadastro do material nem classificação no Painel do ICMS" tone={aClassificar ? "amber" : "green"} onOpen={() => setFiltro("conferir")} />
              </KpiGrid>
              <div className="almox-filtros">
                <Segmented<Filtro> options={[{ value: "todas", label: "Todas" }, { value: "conferir", label: "A conferir" }, { value: "achados", label: "Com achados" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
              </div>
              {visiveis.length ? (
                <div className="vnd-tabela ent-tabela" role="table" aria-label="Notas de entrada">
                  <div className="cabeca" role="row"><span>Emissão</span><span>Emitente</span><span className="r">Valor</span><span>Classificação</span><span>Checagem</span><span>Conferência</span></div>
                  {visiveis.map((n) => (
                    <button type="button" role="row" key={n.id} onClick={() => setAberta(n)} aria-label={`Abrir a NF ${n.numero ?? ""} de ${n.emitente_nome ?? "emitente"}`}>
                      <span>{date(n.emissao)}</span>
                      <span className="nome">{n.emitente_nome ?? "—"}<small>{cnpjFormatado(n.emitente_cnpj)} · {n.emitente_uf ?? "—"}{n.numero ? ` · NF ${n.numero}` : ""} · {n.itens.length} {n.itens.length === 1 ? "item" : "itens"}</small></span>
                      <span className="r">{money(n.v_nf)}</span>
                      <span>{resumoTipos(n)}</span>
                      <span><Status tone={SITUACAO[n.situacao].tom}>{SITUACAO[n.situacao].rotulo}{n.achados.length ? ` · ${n.achados.length}` : ""}</Status></span>
                      <span>{n.conferida ? <Status tone="success">Conferida</Status> : <Status tone="neutral">A conferir</Status>}</span>
                    </button>
                  ))}
                </div>
              ) : <div className="finance-empty"><b>Nada com esse filtro</b></div>}
            </>
          )}
        </>
      )}
      {aberta && dados && <DetalheEntrada nota={aberta} uf={dados.uf} podeOperar={dados.podeOperar} onClose={() => setAberta(null)} onFeito={() => { setAberta(null); notify("Classificação conferida."); void carregar(); }} />}
    </div>
  );
}

function DetalheEntrada({ nota, uf, podeOperar, onClose, onFeito }: { nota: Nota; uf: string; podeOperar: boolean; onClose: () => void; onFeito: () => void }) {
  const prefixo: "1" | "2" = (nota.emitente_uf ?? "").toUpperCase() === uf.toUpperCase() ? "1" : "2";
  const [escolha, setEscolha] = useState(() => nota.itens.map((i) => ({ nItem: i.nItem, tipo: tipoDe(i), cfopEntrada: i.confirmada?.cfopEntrada ?? i.proposta.cfopEntrada ?? "" })));
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const pronto = escolha.every((e) => e.tipo !== "??" && /^[123]\d{3}$/.test(e.cfopEntrada));
  const mudarTipo = (k: number, tipo: string) => setEscolha((l) => l.map((e, j) => (j === k ? { ...e, tipo, cfopEntrada: cfopEntradaPara(tipo, prefixo, nota.itens[k].cfop, nota.itens[k].vICMSST > 0) ?? e.cfopEntrada } : e)));
  const confirmar = async () => {
    setEnviando(true);
    const r = await api("/api/fiscal/entradas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "confirmar", id: nota.id, classificacao: escolha }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito();
  };
  return (
    <Modal eyebrow={`FISCAL · ENTRADA · ${nota.emitente_uf ?? ""}`} title={`${nota.emitente_nome ?? "Emitente"}${nota.numero ? ` · NF ${nota.numero}` : ""}`}
      subtitle={<>{date(nota.emissao)} · {cnpjFormatado(nota.emitente_cnpj)} · {money(nota.v_nf)} · <Status tone={SITUACAO[nota.situacao].tom}>{SITUACAO[nota.situacao].rotulo}</Status>{nota.conferida ? <> · conferida por {nota.conferida_por_nome ?? "—"}</> : null}</>} onClose={onClose}>
      <div className="almox-form ent-detalhe">
        {nota.achados.length > 0 && <Callout variant={nota.situacao === "erro" ? "warning" : "info"} title="O que não confere">{nota.achados.map((a, k) => <span key={k} className="ibs-motivo">{a.nivel === "erro" ? "Erro" : "Atenção"}: {a.mensagem}</span>)}</Callout>}
        <div className="vnd-tabela ent-itens" role="table" aria-label="Itens da nota">
          <div className="cabeca" role="row"><span>Item</span><span>Do emitente</span><span className="r">Valor</span><span>Tipo do item</span><span>CFOP entrada</span></div>
          {nota.itens.map((i, k) => (
            <div role="row" key={i.nItem}>
              <span className="nome">{i.nItem} · {i.xProd}<small>NCM {i.ncm} · {i.cProd}</small></span>
              <span className="nome">CFOP {i.cfop}<small>{i.csosn ? `CSOSN ${i.csosn}` : `CST ${i.cst}`}{i.pICMS ? ` · ICMS ${i.pICMS}%` : ""}{i.vIPI ? ` · IPI ${money(i.vIPI)}` : ""}{i.vICMSST ? ` · ST ${money(i.vICMSST)}` : ""}</small></span>
              <span className="r">{money(i.vProd)}</span>
              <span className="nome">
                <select className="ctb-seletor" aria-label={`Tipo do item ${i.nItem}`} value={escolha[k].tipo} disabled={!podeOperar} onChange={(e) => mudarTipo(k, e.target.value)}>
                  {escolha[k].tipo === "??" && <option value="??">A classificar</option>}
                  {TIPOS_ESCOLHA.map((t) => <option key={t} value={t}>{TIPOS_ITEM[t]}</option>)}
                </select>
                <small>{i.confirmada ? "Confirmado" : `Proposta: ${i.proposta.porque}`} · {i.proposta.tipo === escolha[k].tipo ? i.proposta.credito : "Crédito conforme o tipo escolhido"}</small>
              </span>
              <span><input className="ent-cfop" aria-label={`CFOP de entrada do item ${i.nItem}`} inputMode="numeric" maxLength={4} value={escolha[k].cfopEntrada} disabled={!podeOperar} onChange={(e) => setEscolha((l) => l.map((x, j) => (j === k ? { ...x, cfopEntrada: e.target.value.replace(/\D/g, "").slice(0, 4) } : x)))} /></span>
            </div>
          ))}
        </div>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          {podeOperar && <Button type="button" disabled={!pronto || enviando} onClick={() => void confirmar()}>{enviando ? "Gravando…" : nota.conferida ? "Conferir de novo" : "Confirmar classificação"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}
