"use client";

import { useCallback, useState } from "react";
import { Donut, seriesColor } from "../../packages/design-system";
import type { Celula, Formato, Visual } from "../../lib/sara/visual";
import { LINHAS_SEM_FILTRO, campoDaSelecao, ehOutros, filtrarTabela, tabelaLigada, type Selecao } from "../../lib/sara/visual-ligado";

/**
 * Visual de uma resposta da SARA (indicadores, tabela, barras, linha, rosca, lista de datas). Os números
 * vêm do resultado da consulta, montados pela plataforma — o modelo só escolheu o componente e os campos.
 * Cada visual diz de qual consulta vieram os dados e leva o link da tela.
 */

const moeda = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (a >= 1e4) return `${s}R$ ${Math.round(a / 1e3).toLocaleString("pt-BR")} mil`;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
const dataBR = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split("-").reverse().join("/") : s);
function fmt(v: Celula, f: Formato): string {
  if (v == null) return "—";
  if (typeof v === "number") return f === "moeda" ? moeda(v) : f === "dias" ? `${v.toLocaleString("pt-BR")} d` : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return f === "data" || /^\d{4}-\d{2}-\d{2}/.test(v) ? dataBR(v) : v;
}
/** Valor da tabela: moeda por extenso (sem "mil"), para conferir com a tela. */
const fmtTabela = (v: Celula, f: Formato) => (typeof v === "number" && f === "moeda" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : fmt(v, f));

function Linha({ pontos, formato }: { pontos: { rotulo: string; valor: number }[]; formato: Formato }) {
  const W = 360, H = 140, vals = pontos.map((p) => p.valor);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const x = (i: number) => (pontos.length === 1 ? W / 2 : 6 + (i * (W - 12)) / (pontos.length - 1));
  const y = (v: number) => 8 + (H - 16) * (1 - (v - min) / (max - min || 1));
  const d = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const passo = Math.max(1, Math.ceil(pontos.length / 5));
  const maior = pontos.reduce((a, b) => (b.valor > a.valor ? b : a)), menor = pontos.reduce((a, b) => (b.valor < a.valor ? b : a));
  return (
    <>
      <svg className="sv-linha" viewBox={`0 0 ${W} ${H + 18}`} width={W} height={H + 18} role="img" aria-label="Gráfico de linha">
        {min < 0 && max > 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="zero" />}
        <path d={d} className="traco" />
        {pontos.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.valor)} r="2.6" className={p.valor < 0 ? "neg" : ""}><title>{`${dataBR(p.rotulo)}: ${fmt(p.valor, formato)}`}</title></circle>)}
        {pontos.map((p, i) => {
          if (i % passo !== 0 && i !== pontos.length - 1) return null;
          if (i !== pontos.length - 1 && pontos.length - 1 - i < passo / 2) return null;
          return <text key={`t${i}`} x={x(i)} y={H + 14} textAnchor={i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle"}>{dataBR(p.rotulo).slice(0, 5)}</text>;
        })}
      </svg>
      <div className="sv-escala">
        <span>Maior: <b>{fmt(maior.valor, formato)}</b> <span className="sv-d">em {dataBR(maior.rotulo).slice(0, 5)}</span></span>
        <span>Menor: <b className={menor.valor < 0 ? "neg" : ""}>{fmt(menor.valor, formato)}</b> <span className="sv-d">em {dataBR(menor.rotulo).slice(0, 5)}</span></span>
      </div>
    </>
  );
}

/** O que liga os visuais de um painel: a seleção vale para todos da mesma consulta. */
export type Ligados = { selecionado: string | null; aoTocar?: (rotulo: string) => void; filtro?: { campo: string; rotulo: string }; limpar?: () => void };

/** Quem desenha o painel guarda a seleção. Trocou o conjunto de visuais, ela deixa de valer. */
export function useVisuaisLigados(visuais: Visual[]) {
  const [estado, setEstado] = useState<{ de: Visual[]; selecao: Selecao } | null>(null);
  const selecao = estado?.de === visuais ? estado.selecao : null;
  const selecionar = useCallback((s: Selecao | null) => setEstado(s ? { de: visuais, selecao: s } : null), [visuais]);
  const ligados = (v: Visual): Ligados => {
    const limpar = () => selecionar(null);
    if (v.componente === "tabela") {
      const campo = campoDaSelecao(v, selecao, visuais);
      return campo && selecao ? { selecionado: null, filtro: { campo, rotulo: selecao.rotulo }, limpar } : { selecionado: null };
    }
    const doGrafico = selecao && v.ligacao?.consulta === selecao.consulta ? selecao.rotulo : null;
    const ligacao = v.ligacao;
    if (!ligacao || !tabelaLigada(v, visuais)) return { selecionado: doGrafico };
    return { selecionado: doGrafico, aoTocar: (rotulo) => { if (!ehOutros(rotulo)) selecionar(doGrafico === rotulo ? null : { consulta: ligacao.consulta, rotulo }); } };
  };
  return { ligados, selecionar };
}

export function SaraVisual({ v, ligados }: { v: Visual; ligados?: Ligados }) {
  const toque = (rotulo: string) => (ligados?.aoTocar && !ehOutros(rotulo) ? () => ligados.aoTocar?.(rotulo) : undefined);
  const aceso = (rotulo: string) => (ligados?.selecionado === rotulo ? " sv-aceso" : "");
  let corpo: React.ReactNode = null;
  if (v.componente === "indicadores") {
    corpo = <div className="sv-kpis">{v.itens.map((i, k) => <div key={k}><small>{i.rotulo}</small><b>{fmt(i.valor, i.formato)}</b></div>)}</div>;
  } else if (v.componente === "tabela") {
    const filtro = ligados?.filtro;
    const linhas = filtro ? filtrarTabela(v, filtro.campo, filtro.rotulo) : v.linhas.slice(0, LINHAS_SEM_FILTRO);
    corpo = (
      <>
        {filtro && <p className="sv-filtro">Filtrado por <b>{filtro.rotulo}</b> · {linhas.length} {linhas.length === 1 ? "linha" : "linhas"}{v.total > v.linhas.length ? ` entre as ${v.linhas.length} carregadas` : ""} · <button type="button" onClick={ligados?.limpar}>limpar</button></p>}
        <div className="sara-tabela"><table>
          <thead><tr>{v.colunas.map((c, k) => <th key={k}>{c.rotulo}</th>)}</tr></thead>
          <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((c, k) => <td key={k}>{fmtTabela(c, v.colunas[k].formato)}</td>)}</tr>)}</tbody>
        </table></div>
      </>
    );
  } else if (v.componente === "barras") {
    const max = Math.max(...v.pontos.map((p) => Math.abs(p.valor)), 1);
    corpo = <div className="sv-barras">{v.pontos.map((p, k) => {
      const conteudo = <><span title={p.rotulo}>{p.rotulo}</span><i style={{ width: `${(Math.abs(p.valor) / max) * 100}%` }} /><b>{fmt(p.valor, v.formato)}</b></>;
      const tocar = toque(p.rotulo);
      return tocar ? <button key={k} type="button" className={`sv-bar sv-tocavel${aceso(p.rotulo)}`} aria-pressed={ligados?.selecionado === p.rotulo} onClick={tocar}>{conteudo}</button>
        : <div key={k} className={`sv-bar${aceso(p.rotulo)}`}>{conteudo}</div>;
    })}</div>;
  } else if (v.componente === "linha") {
    corpo = <Linha pontos={v.pontos} formato={v.formato} />;
  } else if (v.componente === "rosca") {
    const total = v.pontos.reduce((s, p) => s + p.valor, 0);
    corpo = (
      <div className="sv-rosca">
        <Donut slices={v.pontos.map((p) => ({ label: p.rotulo, value: p.valor }))} total={total} centro={v.formato === "moeda" ? moeda(total) : undefined} caption="total" size={136} thickness={18} aoTocar={ligados?.aoTocar} />
        <ul>{v.pontos.map((p, k) => {
          const conteudo = <><i style={{ background: seriesColor(k) }} />{p.rotulo}<b>{fmt(p.valor, v.formato)} <small>({total ? Math.round((p.valor / total) * 100) : 0}%)</small></b></>;
          const tocar = toque(p.rotulo);
          return <li key={k} className={aceso(p.rotulo).trim() || undefined}>{tocar ? <button type="button" aria-pressed={ligados?.selecionado === p.rotulo} onClick={tocar}>{conteudo}</button> : conteudo}</li>;
        })}</ul>
      </div>
    );
  } else if (v.componente === "lista_de_datas") {
    corpo = <ol className="sv-datas">{v.itens.map((i, k) => <li key={k}><time>{dataBR(i.data)}</time><span>{i.rotulo}</span>{i.valor != null && <b>{fmt(i.valor, v.formato)}</b>}</li>)}</ol>;
  }
  const mais = "total" in v && typeof v.total === "number" && (v.componente === "tabela" ? Math.min(v.linhas.length, LINHAS_SEM_FILTRO) : v.componente === "lista_de_datas" ? v.itens.length : v.pontos.length) < v.total;
  return (
    <figure className="sara-visual">
      <figcaption>{v.titulo}</figcaption>
      {corpo}
      <footer>Dados da consulta: <b>{v.origem}</b>{mais ? ` · mostrando parte de ${v.total}` : ""}{v.fonte ? <> · <a href={v.fonte.link}>{v.fonte.rotulo}</a></> : null}</footer>
    </figure>
  );
}
